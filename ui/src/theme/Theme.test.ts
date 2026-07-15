import assert from "node:assert/strict";
import test from "node:test";
import {
  createThemeState,
  systemThemePreference,
  themeNameFrom,
  themeNames,
  themeStatus,
  withSystemThemeAppearance,
  withThemePreference,
} from "./Theme.ts";

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
