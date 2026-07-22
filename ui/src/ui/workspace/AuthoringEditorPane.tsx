import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { AuthoringService } from "../../authoring/AuthoringService.ts";
import {
  browserAssetPreviewUrlApi,
  StagedAssetPreviewUrls,
  type StagedAssetPreview,
} from "../../authoring/StagedAssetPreviewUrls.ts";
import {
  publicationBodyFromSource,
  publicationConflictSource,
  validatePublicationSource,
  type StagedAssetMetadata,
} from "../../authoring/PublicationDraft.ts";
import { createDocumentViewerContent } from "../../content/ViewerContent.ts";
import {
  applyVimTextReplacement,
  vimBufferCursorOffset,
  vimBufferText,
  type VimBuffer,
  type VimCommandEffect,
} from "../../domain/vim/VimBuffer.ts";
import type { PaneContent, PaneId, PaneOperation, PaneOperationResult } from "../../domain/workspace/PaneTree.ts";
import type { InputCapturePaneKeyInput, InputCapturePaneKeyResult } from "../terminal/InputCapture.ts";
import type { MobileCtrlInputResolution } from "./MobileCtrlModifier.ts";
import { VimEditorPane } from "./VimEditorPane.tsx";
import type { VimSessionBinding } from "./VimSessionState.ts";

type PreviewState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "available"; previews: ReadonlyArray<StagedAssetPreview> }>
  | Readonly<{ kind: "failed" }>;

type AuthoringEditorPaneProps = Readonly<{
  paneId: PaneId;
  content: Extract<PaneContent, { kind: "authoring-editor" }>;
  authoring: AuthoringService;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onOperation: (operation: PaneOperation) => PaneOperationResult;
  onPaneKeyInput: (input: InputCapturePaneKeyInput) => InputCapturePaneKeyResult;
  mobileCtrlPressed: boolean;
  vimSession: VimSessionBinding;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (input: InputCapturePaneKeyInput) => MobileCtrlInputResolution;
}>;

function fileLabel(metadata: StagedAssetMetadata): string {
  return metadata.destinationPath.split("/").at(-1) ?? metadata.destinationPath;
}

export function AuthoringEditorPane({
  paneId,
  content,
  authoring,
  isActive,
  focusVersion,
  onActivate,
  onOperation,
  onPaneKeyInput,
  mobileCtrlPressed,
  vimSession,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
}: AuthoringEditorPaneProps): ReactElement {
  const [previewUrls] = useState(() => new StagedAssetPreviewUrls(browserAssetPreviewUrlApi()));
  const [previews, setPreviews] = useState<PreviewState>({ kind: "loading" });
  const [pendingFiles, setPendingFiles] = useState<ReadonlyArray<File>>([]);
  const [removeConfirmation, setRemoveConfirmation] = useState<string | undefined>(undefined);
  const [publicationPending, setPublicationPending] = useState(false);
  const publicationAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => { publicationAbort.current?.abort(); }, []);

  useEffect(() => {
    let abandoned = false;
    if (content.draft.stagedAssets.length === 0) {
      previewUrls.clear();
      setPreviews({ kind: "available", previews: [] });
      return () => { previewUrls.clear(); };
    }
    setPreviews({ kind: "loading" });
    void authoring.assets(content.draft).then((assets) => {
      if (abandoned) return;
      setPreviews({ kind: "available", previews: previewUrls.replace(assets) });
    }).catch(() => {
      if (!abandoned) setPreviews({ kind: "failed" });
    });
    return () => {
      abandoned = true;
      previewUrls.clear();
    };
  }, [authoring, content.draft, previewUrls]);

  const showMessage = (message: string): void => {
    onOperation({ kind: "set-authoring-message", paneId, message });
  };

  const completeMedia = (
    submittedBuffer: VimBuffer,
    result: Extract<Awaited<ReturnType<AuthoringService["stageAssets"]>>, { kind: "written" }>,
    message: string,
  ): void => {
    onOperation({
      kind: "complete-authoring-media",
      paneId,
      draft: result.draft,
      submittedSource: vimBufferText(submittedBuffer),
      completedBuffer: applyVimTextReplacement(submittedBuffer, result.source, result.cursorOffset),
      message,
    });
  };

  const stageFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    const submittedBuffer = content.buffer;
    try {
      const result = await authoring.stageAssets(
        content.draft,
        vimBufferText(submittedBuffer),
        vimBufferCursorOffset(submittedBuffer),
        files,
      );
      if (result.kind === "invalid") { setPendingFiles([]); showMessage(result.message); return; }
      if (result.kind === "stale") {
        setPendingFiles(files);
        showMessage("A newer draft revision exists; the selected local files were retained for retry.");
        return;
      }
      setPendingFiles([]);
      completeMedia(submittedBuffer, result, `${files.length} asset${files.length === 1 ? "" : "s"} staged in draft revision ${result.draft.recordRevision}.`);
    } catch {
      setPendingFiles(files);
      showMessage("Draft storage is unavailable; the selected local files were retained for retry.");
    }
  };

  const removeAsset = async (metadata: StagedAssetMetadata): Promise<void> => {
    const submittedBuffer = content.buffer;
    try {
      const result = await authoring.removeAsset(
        content.draft,
        vimBufferText(submittedBuffer),
        vimBufferCursorOffset(submittedBuffer),
        metadata,
      );
      if (result.kind === "invalid") { showMessage(result.message); return; }
      if (result.kind === "stale") { showMessage("A newer draft revision exists; the staged asset was not removed."); return; }
      completeMedia(submittedBuffer, result, `${fileLabel(metadata)} removed in draft revision ${result.draft.recordRevision}.`);
    } catch {
      showMessage("Draft storage is unavailable; the staged asset was not removed.");
    }
  };

  const replaceAsset = async (metadata: StagedAssetMetadata, file: File): Promise<void> => {
    const submittedBuffer = content.buffer;
    try {
      const result = await authoring.replaceAsset(
        content.draft,
        vimBufferText(submittedBuffer),
        vimBufferCursorOffset(submittedBuffer),
        metadata,
        file,
      );
      if (result.kind === "invalid") { setPendingFiles([]); showMessage(result.message); return; }
      if (result.kind === "stale") {
        setPendingFiles([file]);
        showMessage("A newer draft revision exists; the selected replacement File was retained.");
        return;
      }
      setPendingFiles([]);
      completeMedia(submittedBuffer, result, `${fileLabel(metadata)} replaced in draft revision ${result.draft.recordRevision}.`);
    } catch {
      setPendingFiles([file]);
      showMessage("Draft storage is unavailable; the selected replacement File was retained.");
    }
  };

  const publish = async (mutation: "publish" | "remove", confirmation = ""): Promise<void> => {
    if (publicationPending) return;
    const submittedBuffer = content.buffer;
    const submittedSource = vimBufferText(submittedBuffer);
    const controller = new AbortController();
    publicationAbort.current?.abort();
    publicationAbort.current = controller;
    setPublicationPending(true);
    try {
      const result = await authoring.publish(
        mutation,
        content.draft,
        submittedSource,
        confirmation,
        controller.signal,
      );
      if (result.kind === "invalid" || result.kind === "failed") {
        showMessage(result.message);
        return;
      }
      if (result.kind === "conflict") {
        const conflictSource = publicationConflictSource(result.localMarkdown, result.upstreamMarkdown);
        onOperation({
          kind: "complete-authoring-conflict",
          paneId,
          draft: result.draft,
          submittedSource,
          conflictBuffer: applyVimTextReplacement(submittedBuffer, conflictSource, 0),
          upstreamMarkdown: result.upstreamMarkdown,
          message: "Publication conflict loaded with the latest upstream base; edit, save, and resubmit.",
        });
        return;
      }
      if (result.persistedState === "newer-revision-retained") {
        showMessage(`Published ${result.sha}, but a newer stored draft revision was retained. ${result.url}`);
        return;
      }
      setRemoveConfirmation(undefined);
      onOperation({
        kind: "complete-authoring-publication",
        paneId,
        draft: result.draft,
        submittedSource,
        message: `Published ${result.sha}. ${result.url}`,
        closeIfBufferMatchesSubmittedSource: false,
      });
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showMessage("Publication failed.");
      }
    } finally {
      if (publicationAbort.current === controller) {
        publicationAbort.current = undefined;
        setPublicationPending(false);
      }
    }
  };

  const confirmRemoval = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const confirmation = removeConfirmation ?? "";
    if (confirmation !== content.draft.repositoryPath) {
      showMessage("Removal confirmation must match the exact recursive document path.");
      return;
    }
    void publish("remove", confirmation);
  };

  const handleEffect = async (effect: VimCommandEffect, buffer: VimBuffer): Promise<void> => {
    const source = vimBufferText(buffer);
    if (effect.kind === "quit") {
      if (source === content.savedSource) onOperation({ kind: "close" });
      else showMessage("No write since last change; use :q! to discard.");
      return;
    }
    if (effect.kind === "force-quit") {
      try {
        const result = await authoring.discard(content.draft);
        if (result.kind === "discarded") onOperation({ kind: "discard-authoring-editor", paneId });
        else showMessage("A newer draft revision exists; this buffer was not discarded.");
      } catch {
        showMessage("Draft storage is unavailable; this buffer was not discarded.");
      }
      return;
    }
    if (effect.kind === "preview") {
      const parsed = validatePublicationSource(source);
      if (parsed.kind === "invalid") { showMessage(parsed.message); return; }
      onOperation({
        kind: "open-authoring-preview",
        paneId,
        repositoryPath: content.draft.repositoryPath,
        viewer: createDocumentViewerContent({
          title: `${content.draft.virtualPath} preview`,
          presentation: "inline",
          document: { text: publicationBodyFromSource(source), source: { path: content.draft.virtualPath } },
          statsIdentity: { kind: "uncounted" },
        }),
      });
      return;
    }
    if (effect.kind === "publish") {
      void publish("publish");
      return;
    }
    if (effect.kind === "remove") {
      setRemoveConfirmation("");
      showMessage(`Type ${content.draft.repositoryPath} below to confirm removal.`);
      return;
    }
    if (effect.kind !== "write" && effect.kind !== "write-quit") return;
    try {
      const result = await authoring.save(content.draft, source);
      if (result.kind === "invalid") { showMessage(result.message); return; }
      if (result.kind === "stale") { showMessage("A newer draft revision exists; this buffer was not saved."); return; }
      onOperation({
        kind: "complete-authoring-save",
        paneId,
        draft: result.draft,
        savedSource: source,
        message: `Draft revision ${result.draft.recordRevision} saved.`,
        closeIfBufferMatchesSavedSource: effect.kind === "write-quit",
      });
    } catch {
      showMessage("Draft storage is unavailable; this buffer was not saved.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <VimEditorPane
          title={content.title}
          buffer={content.buffer}
          syntax={{ kind: "markdown" }}
          isActive={isActive}
          focusVersion={focusVersion}
          onActivate={onActivate}
          externalMessage={content.message}
          onCommandEffect={(effect, buffer) => { void handleEffect(effect, buffer); }}
          onAssetFiles={(files) => { void stageFiles(files); }}
          onBufferChange={(buffer) => { onOperation({ kind: "replace-editor-buffer", paneId, buffer }); }}
          onPaneKeyInput={onPaneKeyInput}
          mobileCtrlPressed={mobileCtrlPressed}
          vimSession={vimSession}
          onToggleMobileCtrl={onToggleMobileCtrl}
          onConsumeMobileCtrl={onConsumeMobileCtrl}
          resolveMobileCtrlInput={resolveMobileCtrlInput}
        />
      </div>
      {removeConfirmation === undefined ? null : (
        <form className="shrink-0 border-t border-surface-border bg-surface-raised p-2" onSubmit={confirmRemoval}>
          <label className="block text-xs text-text-muted" htmlFor={`remove-${paneId}`}>
            Type the exact recursive path <span className="text-text-bright">{content.draft.repositoryPath}</span> to remove only its Markdown and catalog entry.
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id={`remove-${paneId}`}
              className="min-w-0 flex-1 rounded border border-surface-border bg-surface-deepest px-2 py-1 text-sm text-text-bright focus:border-ui-focus focus:outline-none"
              autoComplete="off"
              value={removeConfirmation}
              disabled={publicationPending}
              onChange={(event) => { setRemoveConfirmation(event.currentTarget.value); }}
            />
            <button className="rounded border border-surface-border px-2 py-1 text-sm text-text-bright hover:border-ui-focus disabled:opacity-50" type="submit" disabled={publicationPending}>
              {publicationPending ? "Removing…" : "Remove"}
            </button>
            <button className="rounded border border-surface-border px-2 py-1 text-sm text-text-bright hover:border-ui-focus disabled:opacity-50" type="button" disabled={publicationPending} onClick={() => { setRemoveConfirmation(undefined); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <section className="shrink-0 border-t border-surface-border bg-surface-raised p-2" aria-label="Staged assets">
        <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Staged assets · use :asset, paste, or drop files</span>
          {pendingFiles.length === 0 ? null : (
            <button className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-focus" type="button" onClick={() => { void stageFiles(pendingFiles); }}>
              Retry {pendingFiles.length} selected
            </button>
          )}
        </div>
        {previews.kind === "loading" ? <p className="mt-2 text-xs text-text-muted">Loading staged assets…</p> : null}
        {previews.kind === "failed" ? <p className="mt-2 text-xs text-text-muted">Staged asset previews are unavailable.</p> : null}
        {previews.kind === "available" && previews.previews.length === 0 ? <p className="mt-2 text-xs text-text-muted">No staged assets.</p> : null}
        {previews.kind === "available" && previews.previews.length > 0 ? (
          <ul className="mt-2 flex gap-2 overflow-x-auto">
            {previews.previews.map((preview) => (
              <li className="flex shrink-0 items-center gap-2 rounded border border-surface-border p-1" key={preview.asset.metadata.destinationPath}>
                <img className="h-20 w-20 object-contain" src={preview.url} alt={fileLabel(preview.asset.metadata)} />
                <div className="flex max-w-48 flex-col gap-1 text-xs">
                  <span className="truncate" title={preview.asset.metadata.destinationPath}>{fileLabel(preview.asset.metadata)}</span>
                  <label className="cursor-pointer rounded border border-surface-border px-2 py-1 text-center text-text-bright hover:border-ui-focus">
                    Replace
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                      aria-label={`Replace ${fileLabel(preview.asset.metadata)}`}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.item(0);
                        if (file !== null && file !== undefined) void replaceAsset(preview.asset.metadata, file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-focus" type="button" onClick={() => { void removeAsset(preview.asset.metadata); }}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
