export type MobileCtrlKeyInput = Readonly<{
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export type MobileCtrlModifier =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "armed" }>;

export type MobileCtrlInputResolution = Readonly<{
  input: MobileCtrlKeyInput;
  mobileCtrlApplied: boolean;
}>;

export const initialMobileCtrlModifier: MobileCtrlModifier = { kind: "idle" };

export function toggleMobileCtrlModifier(
  modifier: MobileCtrlModifier,
): MobileCtrlModifier {
  return modifier.kind === "idle"
    ? { kind: "armed" }
    : initialMobileCtrlModifier;
}

export function consumeMobileCtrlModifier(
  modifier: MobileCtrlModifier,
  input: MobileCtrlKeyInput,
): Readonly<{
  modifier: MobileCtrlModifier;
  resolution: MobileCtrlInputResolution;
}> {
  if (modifier.kind === "idle") {
    return {
      modifier,
      resolution: { input, mobileCtrlApplied: false },
    };
  }

  return {
    modifier: initialMobileCtrlModifier,
    resolution: {
      input: { ...input, ctrlKey: true },
      mobileCtrlApplied: true,
    },
  };
}
