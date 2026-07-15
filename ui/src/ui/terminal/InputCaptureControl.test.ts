import assert from "node:assert/strict";
import test from "node:test";
import { selectInputCaptureControl } from "./InputCaptureControl.ts";

test("keeps command prompts in the accessible textarea control", () => {
  assert.deepEqual(selectInputCaptureControl("command"), {
    element: "textarea",
    accessibleName: "Terminal command input",
  });
});

test("uses an accessible native password input for secret prompts", () => {
  assert.deepEqual(selectInputCaptureControl("secret"), {
    element: "input",
    inputType: "password",
    accessibleName: "Secret terminal input",
  });
});
