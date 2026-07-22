import { useEffect, useRef, useState } from "react";
import {
  createThemeState,
  restoreThemePreview,
  systemThemePreference,
  themeNameFrom,
  themeNames,
  themeStatus,
  withSystemThemeAppearance,
  withThemePreference,
  withThemePreview,
  type SystemThemeAppearance,
  type ThemeChange,
  type ThemeController,
  type ThemePreference,
  type ThemeState,
  type ThemeStatus,
} from "./Theme.ts";

const themeStorageKey = "termin.al.theme";
type ThemeStatePublisher = (state: ThemeState) => void;
type StoredThemePreference = Readonly<{
  preference: ThemePreference;
  storageFailed: boolean;
}>;

function systemThemeAppearance(): SystemThemeAppearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function readStoredThemePreference(
  storage: Pick<Storage, "getItem">,
): StoredThemePreference {
  try {
    const saved = storage.getItem(themeStorageKey);
    if (saved === null) {
      return { preference: systemThemePreference, storageFailed: false };
    }

    const theme = themeNameFrom(saved);
    return theme === undefined
      ? { preference: systemThemePreference, storageFailed: true }
      : { preference: { kind: "explicit", theme }, storageFailed: false };
  } catch {
    return { preference: systemThemePreference, storageFailed: true };
  }
}

export function persistStoredThemePreference(
  storage: Pick<Storage, "removeItem" | "setItem">,
  preference: ThemePreference,
): boolean {
  try {
    if (preference.kind === "system") {
      storage.removeItem(themeStorageKey);
    } else {
      storage.setItem(themeStorageKey, preference.theme);
    }
    return false;
  } catch {
    return true;
  }
}

function browserThemeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

type InitialTheme = Readonly<{
  state: ThemeState;
  storageFailed: boolean;
}>;

function initialTheme(): InitialTheme {
  const storage = browserThemeStorage();
  const stored = storage === undefined
    ? { preference: systemThemePreference, storageFailed: true }
    : readStoredThemePreference(storage);
  return {
    state: createThemeState(stored.preference, systemThemeAppearance()),
    storageFailed: stored.storageFailed,
  };
}

function createThemeController(
  stateRef: Readonly<{ current: ThemeState }>,
  publishRef: Readonly<{ current: ThemeStatePublisher }>,
  initialStorageFailure: boolean,
): ThemeController {
  let pendingStorageFailure = initialStorageFailure;
  const publish = (state: ThemeState): ThemeState => {
    publishRef.current(state);
    return state;
  };
  const commit = (preference: ThemePreference): ThemeChange => {
    const current = stateRef.current;
    const storage = browserThemeStorage();
    const storageFailed = storage === undefined ||
      persistStoredThemePreference(storage, preference);
    const state = publish(storageFailed
      ? withThemePreview(current, preference)
      : withThemePreference(current, preference));
    return { status: themeStatus(state), storageFailed };
  };

  return {
    list: () => themeNames,
    current: () => themeStatus(stateRef.current),
    state: () => stateRef.current,
    set: (theme) => commit({ kind: "explicit", theme }),
    followSystem: () => commit(systemThemePreference),
    preview: (preference) => publish(withThemePreview(
      stateRef.current,
      preference,
    )),
    restore: (preference, previewRevision) => {
      const current = stateRef.current;
      const restored = restoreThemePreview(current, preference, previewRevision);
      if (restored !== current) {
        publish(restored);
      }
    },
    takeStorageFailure: () => {
      const failed = pendingStorageFailure;
      pendingStorageFailure = false;
      return failed;
    },
  };
}

export type UseThemeResult = Readonly<{
  status: ThemeStatus;
  controller: ThemeController;
}>;

export function useTheme(): UseThemeResult {
  const [initial] = useState<InitialTheme>(initialTheme);
  const [state, setState] = useState(initial.state);
  const stateRef = useRef<ThemeState>(initial.state);
  const publishRef = useRef<ThemeStatePublisher>(() => undefined);
  const [controller] = useState<ThemeController>(() => createThemeController(
    stateRef,
    publishRef,
    initial.storageFailed,
  ));

  publishRef.current = (nextState): void => {
    stateRef.current = nextState;
    setState(nextState);
  };

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent): void => {
      publishRef.current(withSystemThemeAppearance(
        stateRef.current,
        event.matches ? "dark" : "light",
      ));
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return { status: themeStatus(state), controller };
}
