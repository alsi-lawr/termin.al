import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import {
  PublicationOperation,
  type PublicationRequest as GrpcPublicationRequest,
  type PublicationResponse,
} from "../generated/browser/browser.ts";
import { PublicationApiClient } from "../generated/browser/browser.client.ts";
import type { PublicationDraft, StagedAsset } from "../authoring/PublicationDraft.ts";
import { BrowserGrpcContext, createBrowserGrpcTransport } from "./BrowserGrpcContext.ts";
import type { SessionClient } from "./SessionClient.ts";

export type PublicationMutation = "publish" | "remove";

export type PublicationResult =
  | Readonly<{
      kind: "published";
      sha: string;
      url: string;
      defaultBranch: string;
      documentBlobSha: string;
    }>
  | Readonly<{
      kind: "conflict";
      localMarkdown: string;
      upstreamMarkdown: string;
      defaultBranch: string;
      headSha: string;
      blobSha: string;
    }>
  | Readonly<{ kind: "failed"; message: "Publication failed." }>;

export interface PublicationClient {
  mutate(
    mutation: PublicationMutation,
    draft: PublicationDraft,
    markdown: string,
    assets: ReadonlyArray<StagedAsset>,
    removalConfirmation: string,
    signal: AbortSignal,
  ): Promise<PublicationResult>;
}

type PublicationRpcClient = Readonly<{
  publish: (
    request: GrpcPublicationRequest,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<PublicationResponse> }>;
}>;

const publicationFailed = {
  kind: "failed",
  message: "Publication failed.",
} as const satisfies PublicationResult;

function grpcOperation(mutation: PublicationMutation, draft: PublicationDraft): PublicationOperation {
  if (mutation === "remove") return PublicationOperation.REMOVE;
  return draft.base.kind === "new" ? PublicationOperation.ADD : PublicationOperation.UPDATE;
}

async function grpcRequest(
  mutation: PublicationMutation,
  draft: PublicationDraft,
  markdown: string,
  assets: ReadonlyArray<StagedAsset>,
  removalConfirmation: string,
): Promise<GrpcPublicationRequest> {
  const expectedBlobSha = draft.base.kind === "existing" ? draft.base.blobSha : "";
  const grpcAssets = mutation === "remove"
    ? []
    : await Promise.all(assets.map(async (asset) => ({
        destinationPath: asset.metadata.destinationPath,
        declaredMediaType: asset.metadata.mediaType,
        content: new Uint8Array(await asset.blob.arrayBuffer()),
      })));

  return {
    operation: grpcOperation(mutation, draft),
    repositoryPath: draft.repositoryPath,
    virtualPath: draft.virtualPath,
    markdown,
    expectedDefaultBranch: draft.base.defaultBranch,
    expectedHeadSha: draft.base.headSha,
    expectedBlobSha,
    assets: grpcAssets,
    removalConfirmation,
  };
}

export class GrpcPublicationClient implements PublicationClient {
  readonly #context: BrowserGrpcContext;
  readonly #sessionClient: SessionClient;
  readonly #client: PublicationRpcClient;

  constructor(
    context: BrowserGrpcContext,
    sessionClient: SessionClient,
    client: PublicationRpcClient = new PublicationApiClient(createBrowserGrpcTransport()),
  ) {
    this.#context = context;
    this.#sessionClient = sessionClient;
    this.#client = client;
  }

  async mutate(
    mutation: PublicationMutation,
    draft: PublicationDraft,
    markdown: string,
    assets: ReadonlyArray<StagedAsset>,
    removalConfirmation: string,
    signal: AbortSignal,
  ): Promise<PublicationResult> {
    const session = await this.#sessionClient.read(signal);
    if (session.kind !== "available" || session.session.kind !== "owner") return publicationFailed;

    try {
      const request = await grpcRequest(mutation, draft, markdown, assets, removalConfirmation);
      const response = await this.#client.publish(
        request,
        { meta: this.#context.metadata(), abort: signal },
      ).response;

      return response.conflict
        ? {
            kind: "conflict",
            localMarkdown: response.localMarkdown,
            upstreamMarkdown: response.upstreamMarkdown,
            defaultBranch: response.defaultBranch,
            headSha: response.headSha,
            blobSha: response.blobSha,
          }
        : {
            kind: "published",
            sha: response.sha,
            url: response.url,
            defaultBranch: response.defaultBranch,
            documentBlobSha: response.documentBlobSha,
          };
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return publicationFailed;
    }
  }
}
