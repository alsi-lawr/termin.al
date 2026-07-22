import assert from "node:assert/strict";
import test from "node:test";
import { SessionApiClient } from "../generated/browser/browser.client.ts";
import { SessionKind, SessionResponse } from "../generated/browser/browser.ts";
import { createBrowserGrpcTransport } from "./BrowserGrpcContext.ts";

function grpcWebFrame(flag: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(payload.length + 5);
  frame[0] = flag;
  new DataView(frame.buffer).setUint32(1, payload.length);
  frame.set(payload, 5);
  return frame;
}

function grpcWebResponse(message: SessionResponse): ArrayBuffer {
  const data = grpcWebFrame(0, SessionResponse.toBinary(message));
  const trailers = grpcWebFrame(128, new TextEncoder().encode("grpc-status: 0\r\n"));
  const response = new Uint8Array(data.length + trailers.length);
  response.set(data);
  response.set(trailers, data.length);
  return response.buffer;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

test("sends a binary generated unary call with same-origin credentials and metadata", async () => {
  let capturedRequest: Request | undefined;
  const response = SessionResponse.create({
    kind: SessionKind.ANONYMOUS,
    csrfToken: "generated-antiforgery-token",
  });
  const fakeFetch: typeof fetch = async (input, init) => {
    const relativeUrl = requestUrl(input);
    capturedRequest = new Request(new URL(relativeUrl, "https://example.test"), init);
    return new Response(grpcWebResponse(response), {
      headers: { "Content-Type": "application/grpc-web+proto" },
    });
  };
  const client = new SessionApiClient(createBrowserGrpcTransport(fakeFetch));
  const result = await client.readSession({}, {
    meta: { "X-CSRF-TOKEN": "request-antiforgery-token" },
  }).response;

  if (capturedRequest === undefined) {
    assert.fail("Expected the generated client to issue a request.");
  }

  assert.equal(capturedRequest.credentials, "include");
  assert.equal(capturedRequest.headers.get("Content-Type"), "application/grpc-web+proto");
  assert.equal(capturedRequest.headers.get("X-CSRF-TOKEN"), "request-antiforgery-token");
  const requestBody = new Uint8Array(await capturedRequest.arrayBuffer());
  assert.equal(requestBody[0], 0);
  assert.deepEqual(result, response);
});
