import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import {
  createThemeSelectorState,
  moveThemeSelector,
  themePreferenceEquals,
  themeSelectorChoices,
  themeSelectorKeyResult,
  themeStorageUnavailableMessage,
  type ThemeController,
  type ThemePreference,
  type ThemeSelectorMotion,
  type ThemeSelectorState,
} from "../../theme/Theme.ts";
import type { InputCapturePaneKeyInput, InputCapturePaneKeyResult } from "../terminal/InputCapture.tsx";
type ThemeSelectorPaneProps = Readonly<{
  transcript: ReactElement;
  controller: ThemeController;
  isActive: boolean;
  focusVersion: number;
  storageFailureReported: boolean;
  onActivate: () => void;
  onPaneKeyInput: (input: InputCapturePaneKeyInput) => InputCapturePaneKeyResult;
  onClose: (transientDiagnostic?: string) => void;
}>;
export function ThemeSelectorPane({
  transcript, controller, isActive, focusVersion, storageFailureReported,
  onActivate, onPaneKeyInput, onClose,
}: ThemeSelectorPaneProps): ReactElement {
  const selectorRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<ThemeSelectorState>(() =>
    createThemeSelectorState(controller.current().preference)
  );
  const current = controller.state();
  useEffect(() => {
    if (isActive) {
      selectorRef.current?.focus({ preventScroll: true });
    }
  }, [focusVersion, isActive]);
  const preview = (next: ThemeSelectorState): void => {
    if (next !== state) {
      const previewed = controller.preview(next.selectedPreference);
      setState({ ...next, previewRevision: previewed.revision });
    }
  };
  const move = (motion: ThemeSelectorMotion): void =>
    preview(moveThemeSelector(state, motion));
  const select = (preference: ThemePreference): void => {
    if (!themePreferenceEquals(preference, state.selectedPreference)) {
      preview({ ...state, selectedPreference: preference });
    }
  };
  const accept = (): void => {
    const changed = state.selectedPreference.kind === "system"
      ? controller.followSystem()
      : controller.set(state.selectedPreference.theme);
    onClose(changed.storageFailed && !storageFailureReported
      ? themeStorageUnavailableMessage
      : undefined);
  };
  const cancel = (): void => {
    if (state.previewRevision !== undefined) {
      controller.restore(state.openingPreference, state.previewRevision);
    }
    onClose();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const paneResult = onPaneKeyInput({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (paneResult.kind === "handled") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const result = themeSelectorKeyResult({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (result.kind === "ignored") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (result.kind === "move") {
      move(result.motion);
    } else if (result.kind === "accept") {
      accept();
    } else {
      cancel();
    }
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-deepest text-text-primary">
      <div className="min-h-0 flex-1">{transcript}</div>
      <section
        ref={selectorRef}
        tabIndex={0}
        className="flex h-1/2 min-h-48 shrink-0 flex-col overflow-hidden border-t border-surface-border bg-surface-deepest font-mono text-sm text-text-primary outline-none"
        aria-label="Theme selector"
        onFocus={onActivate}
        onKeyDown={handleKeyDown}
      >
        <ul className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-2" role="listbox" aria-label="Terminal themes">
          {themeSelectorChoices.map((preference) => {
            const label = preference.kind === "system" ? "system" : preference.theme;
            const selected = themePreferenceEquals(preference, state.selectedPreference);
            const persisted = themePreferenceEquals(preference, current.persistedPreference);
            const active = themePreferenceEquals(preference, current.preference);
            const indication = [
              persisted ? "persisted" : undefined,
              active ? "current" : undefined,
            ].filter((value) => value !== undefined).join(", ");
            return (
              <li
                key={label}
                role="option"
                aria-selected={selected}
                className={selected
                  ? "flex min-w-0 cursor-pointer items-baseline gap-2 bg-surface-selected px-1 py-1 text-text-bright"
                  : "flex min-w-0 cursor-pointer items-baseline gap-2 px-1 py-1 text-text-primary"}
                onClick={() => select(preference)}
              >
                <span className="shrink-0 whitespace-pre text-ui-accent" aria-hidden="true">
                  {selected ? ">" : " "}
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {indication.length === 0 ? null : (
                  <span className="shrink-0 text-xs text-text-muted">({indication})</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="shrink-0 border-t border-surface-border px-4 py-1 text-xs text-text-muted" role="status">
          7 themes · j/k or arrows move · g/G or Home/End jump · Enter accept · Esc/q cancel
        </p>
        <div className="grid shrink-0 grid-cols-4 gap-1 border-t border-surface-border bg-surface-raised p-2 text-xs md:hidden" aria-label="Theme selector touch controls">
          <button type="button" className="rounded border border-surface-border px-2 py-1 text-text-bright" onClick={() => move("previous")}>Up</button>
          <button type="button" className="rounded border border-surface-border px-2 py-1 text-text-bright" onClick={() => move("next")}>Down</button>
          <button type="button" className="rounded border border-ui-accent px-2 py-1 text-text-bright" onClick={accept}>Accept</button>
          <button type="button" className="rounded border border-surface-border px-2 py-1 text-text-bright" onClick={cancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
