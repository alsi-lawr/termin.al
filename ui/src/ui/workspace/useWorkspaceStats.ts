import { useEffect, useRef, useState } from "react";
import type { ApplicationMode } from "../../ApplicationComposition.ts";
import type { ContentId } from "../../api/ContentContracts.ts";
import type { PortfolioStatsReader } from "../../application/commands/PortfolioCommands.ts";
import type {
  StatsClient,
  StatsLoadResult,
  StatsRecordResult,
  StatsStreamEvent,
} from "../../api/StatsClient.ts";
import {
  formatPortfolioStats,
  workspaceStatsAfterDisconnect,
  workspaceStatsAfterInvalidEvent,
  workspaceStatsFromSnapshot,
  workspaceStatsStatus,
  type WorkspaceStatsState,
  type WorkspaceStatsStatus,
} from "./WorkspaceStats.ts";

export type WorkspaceStatsController = Readonly<{
  status: WorkspaceStatsStatus;
  readStats: PortfolioStatsReader;
  recordAcceptedOpen: (contentId: ContentId) => void;
}>;

type WorkspaceStatsTransition = (
  state: WorkspaceStatsState,
) => WorkspaceStatsState;

type WorkspaceStatsDispatch = (transition: WorkspaceStatsTransition) => void;

function applyLoadResult(
  state: WorkspaceStatsState,
  result: StatsLoadResult,
): WorkspaceStatsState {
  if (result.kind !== "available") {
    return state.kind === "loading" ? { kind: "unavailable" } : state;
  }

  switch (state.kind) {
    case "loading":
    case "unavailable":
    case "reconnecting":
      return { kind: "reconnecting", snapshot: result.snapshot };
    case "stale":
      return { kind: "stale", snapshot: result.snapshot };
    case "live":
    case "no-data":
      return state;
  }
}

function applyStreamEvent(
  state: WorkspaceStatsState,
  event: StatsStreamEvent,
): WorkspaceStatsState {
  switch (event.kind) {
    case "snapshot":
      return workspaceStatsFromSnapshot(event.snapshot);
    case "disconnected":
      return workspaceStatsAfterDisconnect(state);
    case "invalid":
      return workspaceStatsAfterInvalidEvent(state);
  }
}

export function connectWorkspaceStats(
  statsClient: StatsClient,
  dispatch: WorkspaceStatsDispatch,
): () => void {
  const controller = new AbortController();
  let connected = true;
  const subscription = statsClient.subscribe((event) => {
    if (connected) {
      dispatch((state) => applyStreamEvent(state, event));
    }
  });

  void statsClient.loadSnapshot(controller.signal).then((result) => {
    if (connected) {
      dispatch((state) => applyLoadResult(state, result));
    }
  }).catch(() => {
    if (connected) {
      dispatch((state) => state.kind === "loading" ? { kind: "unavailable" } : state);
    }
  });

  return () => {
    connected = false;
    controller.abort();
    subscription.close();
  };
}

function applyRecordResult(
  state: WorkspaceStatsState,
  result: StatsRecordResult,
): WorkspaceStatsState {
  if (result.kind !== "recorded") {
    return state;
  }

  switch (state.kind) {
    case "loading":
    case "unavailable":
    case "reconnecting":
      return { kind: "reconnecting", snapshot: result.snapshot };
    case "stale":
      return { kind: "stale", snapshot: result.snapshot };
    case "live":
    case "no-data":
      return workspaceStatsFromSnapshot(result.snapshot);
  }
}

export function createWorkspaceAcceptedOpenRecorder(
  statsClient: StatsClient,
  signal: () => AbortSignal,
  dispatch: WorkspaceStatsDispatch,
): (contentId: ContentId) => void {
  const submittedContentIds = new Set<string>();

  return (contentId): void => {
    if (submittedContentIds.has(contentId.value)) {
      return;
    }

    submittedContentIds.add(contentId.value);
    const requestSignal = signal();

    void statsClient.recordView(contentId, requestSignal).then((result) => {
      if (!requestSignal.aborted) {
        dispatch((current) => applyRecordResult(current, result));
      }
    }).catch(() => {
      if (!requestSignal.aborted) {
        dispatch(workspaceStatsAfterInvalidEvent);
      }
    });
  };
}

export function useWorkspaceStats(
  statsClient: StatsClient,
  applicationMode: ApplicationMode,
): WorkspaceStatsController {
  const [state, setState] = useState<WorkspaceStatsState>({ kind: "loading" });
  const stateRef = useRef<WorkspaceStatsState>(state);
  const applicationModeRef = useRef(applicationMode);
  const lifecycleController = useRef(new AbortController());
  applicationModeRef.current = applicationMode;

  const [dispatch] = useState<WorkspaceStatsDispatch>(() =>
    (transition: WorkspaceStatsTransition): void => {
      const next = transition(stateRef.current);
      stateRef.current = next;
      setState(next);
    }
  );

  useEffect(() => {
    lifecycleController.current = new AbortController();
    const disconnect = connectWorkspaceStats(statsClient, dispatch);

    return () => {
      lifecycleController.current.abort();
      disconnect();
    };
  }, [dispatch, statsClient]);

  const [recordAcceptedOpen] = useState(() =>
    createWorkspaceAcceptedOpenRecorder(
      statsClient,
      () => lifecycleController.current.signal,
      dispatch,
    )
  );

  const [readStats] = useState<PortfolioStatsReader>(() =>
    (): string => {
      const snapshotState = stateRef.current;
      const currentUtcDate = applicationModeRef.current === "demo" && "snapshot" in snapshotState
        ? snapshotState.snapshot.daily.at(-1)?.date ?? new Date().toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      return formatPortfolioStats(snapshotState, currentUtcDate);
    }
  );

  return {
    status: workspaceStatsStatus(state),
    readStats,
    recordAcceptedOpen,
  };
}
