export type InputCapturePromptKind = "command" | "secret";

export type InputCaptureControl =
  | Readonly<{
      element: "textarea";
      accessibleName: "Terminal command input";
    }>
  | Readonly<{
      element: "input";
      inputType: "password";
      accessibleName: "Secret terminal input";
    }>;

export function selectInputCaptureControl(
  promptKind: InputCapturePromptKind,
): InputCaptureControl {
  if (promptKind === "secret") {
    return {
      element: "input",
      inputType: "password",
      accessibleName: "Secret terminal input",
    };
  }

  return {
    element: "textarea",
    accessibleName: "Terminal command input",
  };
}
