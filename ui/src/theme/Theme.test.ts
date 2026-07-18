import assert from "node:assert/strict";
import test from "node:test";
import {
  createThemeState,
  createThemeSelectorState,
  moveThemeSelector,
  restoreThemePreview,
  selectorStorageDiagnostic,
  systemThemePreference,
  themeNameFrom,
  themeNames,
  themePreferenceEquals,
  themeSelectorChoices,
  themeSelectorKeyResult,
  themeStatus,
  withSystemThemeAppearance,
  withThemePreference,
  withThemePreview,
} from "./Theme.ts";
import {
  persistStoredThemePreference,
  readStoredThemePreference,
} from "./useTheme.ts";

test("resolves system themes to the matching muted palette", () => {
  const dark = themeStatus(createThemeState(systemThemePreference, "dark"));
  const light = themeStatus(createThemeState(systemThemePreference, "light"));

  assert.equal(dark.theme, "gruber-dark-muted");
  assert.equal(light.theme, "gruber-light-muted");
  assert.deepEqual(dark.preference, systemThemePreference);
  assert.deepEqual(light.preference, systemThemePreference);
});

test("keeps an explicit selection while the system appearance changes", () => {
  const selected = createThemeState(
    { kind: "explicit", theme: "gruber-lighter" },
    "dark",
  );
  const changedSystem = withSystemThemeAppearance(selected, "light");

  assert.equal(themeStatus(changedSystem).theme, "gruber-lighter");
  assert.deepEqual(themeStatus(changedSystem).preference, {
    kind: "explicit",
    theme: "gruber-lighter",
  });
});

test("can clear an explicit selection and validate a named palette", () => {
  const selected = createThemeState(
    { kind: "explicit", theme: "gruber-dark" },
    "light",
  );
  const system = withThemePreference(selected, systemThemePreference);

  assert.equal(themeStatus(system).theme, "gruber-light-muted");
  assert.equal(themeNameFrom("gruber-darker"), "gruber-darker");
  assert.equal(themeNameFrom("not-a-theme"), undefined);
  assert.deepEqual(themeNames, [
    "gruber-dark-muted",
    "gruber-dark",
    "gruber-darker",
    "gruber-light-muted",
    "gruber-light",
    "gruber-lighter",
  ]);
});

test("moves through system and six named selector choices", () => {
  const initial = createThemeSelectorState(systemThemePreference);
  const previous = moveThemeSelector(initial, "previous");
  const next = moveThemeSelector(initial, "next");
  const last = moveThemeSelector(next, "last");
  const first = moveThemeSelector(last, "first");

  assert.strictEqual(previous, initial);
  assert.deepEqual(next.selectedPreference, {
    kind: "explicit",
    theme: "gruber-dark-muted",
  });
  assert.deepEqual(last.selectedPreference, {
    kind: "explicit",
    theme: "gruber-lighter",
  });
  assert.deepEqual(first.selectedPreference, systemThemePreference);
  assert.equal(themeSelectorChoices.length, 7);
});

test("maps selector movement, acceptance, and cancellation keys", () => {
  const key = (value: string, ctrlKey = false) => themeSelectorKeyResult({
    key: value,
    altKey: false,
    ctrlKey,
    metaKey: false,
  });

  assert.deepEqual(key("ArrowUp"), { kind: "move", motion: "previous" });
  assert.deepEqual(key("k"), { kind: "move", motion: "previous" });
  assert.deepEqual(key("ArrowDown"), { kind: "move", motion: "next" });
  assert.deepEqual(key("j"), { kind: "move", motion: "next" });
  assert.deepEqual(key("Home"), { kind: "move", motion: "first" });
  assert.deepEqual(key("g"), { kind: "move", motion: "first" });
  assert.deepEqual(key("End"), { kind: "move", motion: "last" });
  assert.deepEqual(key("G"), { kind: "move", motion: "last" });
  assert.deepEqual(key("Enter"), { kind: "accept" });
  assert.deepEqual(key("Escape"), { kind: "cancel" });
  assert.deepEqual(key("q"), { kind: "cancel" });
  assert.deepEqual(key("c", true), { kind: "cancel" });
  assert.deepEqual(key("x"), { kind: "ignored" });
});

test("restores only the selector that still owns the latest preview", () => {
  const opening = createThemeState(systemThemePreference, "dark");
  const previewed = withThemePreview(opening, {
    kind: "explicit",
    theme: "gruber-darker",
  });
  const restored = restoreThemePreview(
    previewed,
    opening.preference,
    previewed.revision,
  );
  const newerPaneChange = withThemePreference(previewed, {
    kind: "explicit",
    theme: "gruber-lighter",
  });
  const staleCancel = restoreThemePreview(
    newerPaneChange,
    opening.preference,
    previewed.revision,
  );

  assert.equal(
    themePreferenceEquals(previewed.persistedPreference, opening.preference),
    true,
  );
  assert.equal(themePreferenceEquals(restored.preference, opening.preference), true);
  assert.strictEqual(staleCancel, newerPaneChange);
  assert.equal(themeStatus(staleCancel).theme, "gruber-lighter");
});

test("handles corrupt or unavailable theme storage without throwing", () => {
  assert.deepEqual(readStoredThemePreference({ getItem: () => null }), {
    preference: systemThemePreference,
    storageFailed: false,
  });
  assert.deepEqual(readStoredThemePreference({ getItem: () => "gruber-light" }), {
    preference: { kind: "explicit", theme: "gruber-light" },
    storageFailed: false,
  });
  assert.equal(
    readStoredThemePreference({ getItem: () => "private-payload" }).storageFailed,
    true,
  );
  assert.equal(readStoredThemePreference({
    getItem: () => {
      throw new Error("unavailable");
    },
  }).storageFailed, true);
});

test("writes or removes a preference once and reports nonfatal failures", () => {
  let writes = 0;
  let removals = 0;
  const storage = {
    setItem: (): void => {
      writes += 1;
    },
    removeItem: (): void => {
      removals += 1;
    },
  };

  assert.equal(persistStoredThemePreference(storage, {
    kind: "explicit",
    theme: "gruber-light",
  }), false);
  assert.equal(persistStoredThemePreference(storage, systemThemePreference), false);
  assert.equal(writes, 1);
  assert.equal(removals, 1);
  assert.equal(persistStoredThemePreference({
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  }, { kind: "explicit", theme: "gruber-light" }), true);
  assert.equal(persistStoredThemePreference({
    setItem: () => undefined,
    removeItem: () => {
      throw new Error("blocked");
    },
  }, systemThemePreference), true);
});

test("coalesces selector storage diagnostics within one flow", () => {
  assert.equal(selectorStorageDiagnostic(false, false), undefined);
  assert.equal(
    selectorStorageDiagnostic(true, false),
    "Theme storage is unavailable; the active theme remains usable.",
  );
  assert.equal(selectorStorageDiagnostic(true, true), undefined);
});
