import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type { RpcMetadata, RpcTransport } from "@protobuf-ts/runtime-rpc";

export type CsrfToken = string & { readonly __brand: "CsrfToken" };

export function csrfToken(value: string): CsrfToken | undefined {
  return value.length >= 16 && value.length <= 4096
    ? value as CsrfToken
    : undefined;
}

export class BrowserGrpcContext {
  private token: CsrfToken | undefined;

  recordCsrfToken(token: CsrfToken): void {
    this.token = token;
  }

  metadata(): RpcMetadata {
    return this.token === undefined
      ? {}
      : { "X-CSRF-TOKEN": this.token };
  }
}

export function createBrowserGrpcTransport(fetchImplementation: typeof fetch = globalThis.fetch): RpcTransport {
  return new GrpcWebFetchTransport({
    baseUrl: "",
    format: "binary",
    fetch: fetchImplementation,
    fetchInit: { credentials: "include" },
  });
}
