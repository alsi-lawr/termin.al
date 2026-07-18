export const themeNames = [
  "gruber-dark-muted",
  "gruber-dark",
  "gruber-darker",
  "gruber-light-muted",
  "gruber-light",
  "gruber-lighter",
] as const;

export type ThemeName = (typeof themeNames)[number];
export type SystemThemeAppearance = "dark" | "light";
export type ThemePreference =
  | Readonly<{ kind: "system" }>
  | Readonly<{ kind: "explicit"; theme: ThemeName }>;
export type ThemeState = Readonly<{
  preference: ThemePreference;
  persistedPreference: ThemePreference;
  systemAppearance: SystemThemeAppearance;
  revision: number;
}>;
export type ThemeStatus = Readonly<{ theme: ThemeName; preference: ThemePreference }>;
export type ThemeChange = Readonly<{ status: ThemeStatus; storageFailed: boolean }>;
export type ThemeController = Readonly<{
  list: () => ReadonlyArray<ThemeName>;
  current: () => ThemeStatus;
  state: () => ThemeState;
  set: (theme: ThemeName) => ThemeChange;
  followSystem: () => ThemeChange;
  preview: (preference: ThemePreference) => ThemeState;
  restore: (preference: ThemePreference, revision: number) => void;
  takeStorageFailure: () => boolean;
}>;

const systemThemeDefaults = {
  dark: "gruber-dark-muted",
  light: "gruber-light-muted",
} as const satisfies Readonly<Record<SystemThemeAppearance, ThemeName>>;

export const systemThemePreference: ThemePreference = { kind: "system" };
export const themeStorageUnavailableMessage =
  "Theme storage is unavailable; the active theme remains usable.";
export const themeSelectorChoices = [
  systemThemePreference,
  ...themeNames.map((theme): ThemePreference => ({ kind: "explicit", theme })),
] satisfies ReadonlyArray<ThemePreference>;

export type ThemeSelectorState = Readonly<{
  openingPreference: ThemePreference;
  selectedPreference: ThemePreference;
  previewRevision: number | undefined;
}>;
export type ThemeSelectorMotion = "previous" | "next" | "first" | "last";
export type ThemeSelectorKeyResult =
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "move"; motion: ThemeSelectorMotion }>
  | Readonly<{ kind: "accept" | "cancel" }>;

export function themeNameFrom(value: string): ThemeName | undefined {
  return themeNames.find((theme) => theme === value);
}

export function createThemeState(
  preference: ThemePreference,
  systemAppearance: SystemThemeAppearance,
): ThemeState {
  return {
    preference,
    persistedPreference: preference,
    systemAppearance,
    revision: 0,
  };
}

export function themeStatus(state: ThemeState): ThemeStatus {
  return state.preference.kind === "system"
    ? {
        theme: systemThemeDefaults[state.systemAppearance],
        preference: state.preference,
      }
    : { theme: state.preference.theme, preference: state.preference };
}

export function themePreferenceEquals(
  first: ThemePreference,
  second: ThemePreference,
): boolean {
  return first.kind === "system" || second.kind === "system"
    ? first.kind === second.kind
    : first.theme === second.theme;
}

export function withThemePreference(
  state: ThemeState,
  preference: ThemePreference,
): ThemeState {
  return {
    ...state,
    preference,
    persistedPreference: preference,
    revision: state.revision + 1,
  };
}

export function withThemePreview(
  state: ThemeState,
  preference: ThemePreference,
): ThemeState {
  return { ...state, preference, revision: state.revision + 1 };
}

export function restoreThemePreview(
  state: ThemeState,
  preference: ThemePreference,
  previewRevision: number,
): ThemeState {
  return state.revision === previewRevision
    ? withThemePreview(state, preference)
    : state;
}

export function withSystemThemeAppearance(
  state: ThemeState,
  systemAppearance: SystemThemeAppearance,
): ThemeState {
  return state.systemAppearance === systemAppearance
    ? state
    : {
        ...state,
        systemAppearance,
        revision: state.revision + 1,
      };
}

export function createThemeSelectorState(
  openingPreference: ThemePreference,
): ThemeSelectorState {
  return { openingPreference, selectedPreference: openingPreference, previewRevision: undefined };
}

export function moveThemeSelector(
  state: ThemeSelectorState,
  motion: ThemeSelectorMotion,
): ThemeSelectorState {
  const current = themeSelectorChoices.findIndex((choice) =>
    themePreferenceEquals(choice, state.selectedPreference)
  );
  const last = themeSelectorChoices.length - 1;
  let next: number;

  switch (motion) {
    case "first":
      next = 0;
      break;
    case "last":
      next = last;
      break;
    case "previous":
      next = Math.max(0, current - 1);
      break;
    case "next":
      next = Math.min(last, current + 1);
      break;
  }
  const selectedPreference = themeSelectorChoices[next];

  if (selectedPreference === undefined) {
    throw new Error("Theme selector movement must resolve a preference.");
  }

  return selectedPreference === state.selectedPreference
    ? state
    : { ...state, selectedPreference };
}

export function themeSelectorKeyResult(input: Readonly<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>): ThemeSelectorKeyResult {
  if (input.ctrlKey && input.key.toLowerCase() === "c") {
    return { kind: "cancel" };
  }
  if (input.altKey || input.ctrlKey || input.metaKey) {
    return { kind: "ignored" };
  }

  switch (input.key) {
    case "ArrowUp":
    case "k":
      return { kind: "move", motion: "previous" };
    case "ArrowDown":
    case "j":
      return { kind: "move", motion: "next" };
    case "Home":
    case "g":
      return { kind: "move", motion: "first" };
    case "End":
    case "G":
      return { kind: "move", motion: "last" };
    case "Enter":
      return { kind: "accept" };
    case "Escape":
    case "q":
      return { kind: "cancel" };
    default:
      return { kind: "ignored" };
  }
}
