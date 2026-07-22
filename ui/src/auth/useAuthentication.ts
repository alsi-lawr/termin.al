import { useEffect, useState, useSyncExternalStore } from "react";
import type { CvClient } from "../api/CvClient.ts";
import type { SessionClient } from "../api/SessionClient.ts";
import {
  AuthenticationController,
  type AuthenticationState,
} from "./Authentication.ts";

export type AuthenticationBinding = Readonly<{
  controller: AuthenticationController;
  state: AuthenticationState;
}>;

export function useAuthentication(
  sessionClient: SessionClient,
  cvClient: CvClient,
): AuthenticationBinding {
  const [controller] = useState(
    () => new AuthenticationController(sessionClient, cvClient),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );

  useEffect(() => {
    const abortController = new AbortController();
    void controller.refresh(abortController.signal).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      }
    });
    return () => abortController.abort();
  }, [controller]);

  return { controller, state };
}
