import assert from "node:assert/strict";
import test from "node:test";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import type { PublicationRequest, PublicationResponse } from "../generated/browser/browser.ts";
import { PublicationOperation } from "../generated/browser/browser.ts";
import type { PublicationDraft, StagedAsset } from "../authoring/PublicationDraft.ts";
import { minimalPublicationSource, validatePublicationSource } from "../authoring/PublicationDraft.ts";
import { BrowserGrpcContext, csrfToken } from "./BrowserGrpcContext.ts";
import { GrpcPublicationClient } from "./PublicationClient.ts";
import type { AuthenticatedLogin, SessionClient } from "./SessionClient.ts";

function draft(base: PublicationDraft["base"]): PublicationDraft {
  const source = minimalPublicationSource("example");
  const parsed = validatePublicationSource(source);
  if (parsed.kind === "invalid") throw new Error(parsed.message);
  return {
    schemaVersion: 1,
    recordRevision: 2,
    kind: "blog",
    repositoryPath: "blog/engineering/interfaces/example.md",
    virtualPath: "~/blog/engineering/interfaces/example.md",
    frontMatter: parsed.value,
    source,
    base,
    dirty: true,
    unpublished: base.kind === "new",
    stagedAssets: [],
  };
}

const ownerSession: SessionClient = {
  read: () => Promise.resolve({ kind: "available", session: { kind: "owner", login: "owner" as AuthenticatedLogin } }),
  login: () => Promise.resolve({ kind: "failed", message: "Authentication failed." }),
  logout: () => Promise.resolve({ kind: "failed", message: "Authentication failed." }),
};

test("generated publication client sends binary-unary domain values with antiforgery metadata", async () => {
  const context = new BrowserGrpcContext();
  const token = csrfToken("0123456789abcdef");
  if (token === undefined) throw new Error("Test token is invalid.");
  context.recordCsrfToken(token);
  let captured: PublicationRequest | undefined;
  let metadata: RpcMetadata | undefined;
  const rpc = {
    publish: (request: PublicationRequest, options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>) => {
      captured = request;
      metadata = options.meta;
      const response: PublicationResponse = {
        conflict: false,
        sha: "d".repeat(40),
        url: "https://github.com/example/content/commit/d",
        defaultBranch: "main",
        documentBlobSha: "e".repeat(40),
        localMarkdown: "",
        upstreamMarkdown: "",
        headSha: "",
        blobSha: "",
      };
      return { response: Promise.resolve(response) };
    },
  };
  const client = new GrpcPublicationClient(context, ownerSession, rpc);
  const asset: StagedAsset = {
    metadata: {
      destinationPath: "assets/blog/engineering/interfaces/example/image.png",
      mediaType: "image/png",
    },
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  };
  const result = await client.mutate(
    "publish",
    draft({ kind: "new", defaultBranch: "main", headSha: "a".repeat(40) }),
    minimalPublicationSource("example"),
    [asset],
    "",
    new AbortController().signal,
  );
  assert.equal(result.kind, "published");
  assert.equal(captured?.operation, PublicationOperation.ADD);
  assert.equal(captured?.repositoryPath, "blog/engineering/interfaces/example.md");
  assert.deepEqual([...captured?.assets[0]?.content ?? []], [1, 2, 3]);
  assert.equal(metadata?.["X-CSRF-TOKEN"], token);
});

test("generated publication client returns direct conflict values", async () => {
  const conflictRpc = {
    publish: () => ({
      response: Promise.resolve({
        conflict: true,
        sha: "",
        url: "",
        defaultBranch: "main",
        documentBlobSha: "",
        localMarkdown: "local",
        upstreamMarkdown: "upstream",
        headSha: "b".repeat(40),
        blobSha: "c".repeat(40),
      } satisfies PublicationResponse),
    }),
  };
  const client = new GrpcPublicationClient(new BrowserGrpcContext(), ownerSession, conflictRpc);
  const result = await client.mutate(
    "publish",
    draft({ kind: "existing", defaultBranch: "main", headSha: "a".repeat(40), blobSha: "9".repeat(40) }),
    "local",
    [],
    "",
    new AbortController().signal,
  );
  assert.deepEqual(result, {
    kind: "conflict",
    localMarkdown: "local",
    upstreamMarkdown: "upstream",
    defaultBranch: "main",
    headSha: "b".repeat(40),
    blobSha: "c".repeat(40),
  });
});
