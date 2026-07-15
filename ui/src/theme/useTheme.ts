import { useEffect, useRef, useState } from "react";
import {
  createThemeState,
  systemThemePreference,
  themeNameFrom,
  themeNames,
  themeStatus,
  withSystemThemeAppearance,
  withThemePreference,
  type SystemThemeAppearance,
  type ThemeController,
  type ThemeName,
  type ThemeState,
  type ThemeStatus,
} from "./Theme.ts";

const themeStorageKey = "termin.al.theme";

type ThemeStatePublisher = (state: ThemeState) => void;

function systemThemeAppearance(): SystemThemeAppearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function savedThemeName(): ThemeName | undefined {
  const saved = window.localStorage.getItem(themeStorageKey);
  return saved === null ? undefined : themeNameFrom(saved);
}

function initialThemeState(): ThemeState {
  const saved = savedThemeName();
  const preference =
    saved === undefined
      ? systemThemePreference
      : { kind: "explicit" as const, theme: saved };

  return createThemeState(preference, systemThemeAppearance());
}

function persistThemePreference(state: ThemeState): void {
  switch (state.preference.kind) {
    case "system":
      window.localStorage.removeItem(themeStorageKey);
      return;
    case "explicit":
      window.localStorage.setItem(themeStorageKey, state.preference.theme);
  }
}

function requiredThemeState(
  state: ThemeState | undefined,
): ThemeState {
  if (state === undefined) {
    throw new Error("Theme state must be initialized before commands run.");
  }

  return state;
}

function createThemeController(
  stateRef: Readonly<{ current: ThemeState | undefined }>,
  publishRef: Readonly<{ current: ThemeStatePublisher }>,
): ThemeController {
  const publish = (state: ThemeState): ThemeStatus => {
    persistThemePreference(state);
    publishRef.current(state);
    return themeStatus(state);
  };

  return {
    list: () => themeNames,
    current: () => themeStatus(requiredThemeState(stateRef.current)),
    set: (theme) => {
      const state = requiredThemeState(stateRef.current);
      return publish(withThemePreference(state, { kind: "explicit", theme }));
    },
    followSystem: () => {
      const state = requiredThemeState(stateRef.current);
      return publish(withThemePreference(state, systemThemePreference));
    },
  };
}

export type UseThemeResult = Readonly<{
  status: ThemeStatus;
  controller: ThemeController;
}>;

export function useTheme(): UseThemeResult {
  const stateRef = useRef<ThemeState | undefined>(undefined);
  const publishRef = useRef<ThemeStatePublisher>(() => undefined);
  const [state, setState] = useState<ThemeState>(() => {
    const initial = initialThemeState();
    stateRef.current = initial;
    return initial;
  });
  const [controller] = useState<ThemeController>(() =>
    createThemeController(stateRef, publishRef),
  );

  publishRef.current = (nextState: ThemeState): void => {
    stateRef.current = nextState;
    setState(nextState);
  };

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemAppearance = (event: MediaQueryListEvent): void => {
      const current = requiredThemeState(stateRef.current);
      publishRef.current(
        withSystemThemeAppearance(current, event.matches ? "dark" : "light"),
      );
    };

    query.addEventListener("change", updateSystemAppearance);

    return () => {
      query.removeEventListener("change", updateSystemAppearance);
    };
  }, []);

  return { status: themeStatus(state), controller };
}
