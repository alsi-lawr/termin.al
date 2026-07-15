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
  | Readonly<{
      kind: "explicit";
      theme: ThemeName;
    }>;

export type ThemeState = Readonly<{
  preference: ThemePreference;
  systemAppearance: SystemThemeAppearance;
}>;

export type ThemeStatus = Readonly<{
  theme: ThemeName;
  preference: ThemePreference;
}>;

export type ThemeController = Readonly<{
  list: () => ReadonlyArray<ThemeName>;
  current: () => ThemeStatus;
  set: (theme: ThemeName) => ThemeStatus;
  followSystem: () => ThemeStatus;
}>;

const systemThemeDefaults = {
  dark: "gruber-dark-muted",
  light: "gruber-light-muted",
} as const satisfies Readonly<Record<SystemThemeAppearance, ThemeName>>;

export const systemThemePreference: ThemePreference = { kind: "system" };

export function themeNameFrom(value: string): ThemeName | undefined {
  return themeNames.find((theme) => theme === value);
}

export function createThemeState(
  preference: ThemePreference,
  systemAppearance: SystemThemeAppearance,
): ThemeState {
  return { preference, systemAppearance };
}

export function themeStatus(state: ThemeState): ThemeStatus {
  switch (state.preference.kind) {
    case "system":
      return {
        theme: systemThemeDefaults[state.systemAppearance],
        preference: state.preference,
      };
    case "explicit":
      return { theme: state.preference.theme, preference: state.preference };
  }
}

export function withThemePreference(
  state: ThemeState,
  preference: ThemePreference,
): ThemeState {
  return { ...state, preference };
}

export function withSystemThemeAppearance(
  state: ThemeState,
  systemAppearance: SystemThemeAppearance,
): ThemeState {
  return state.systemAppearance === systemAppearance
    ? state
    : { ...state, systemAppearance };
}
