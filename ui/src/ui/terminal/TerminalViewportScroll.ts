type TerminalViewportPosition = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export function synchronizeTerminalViewport(
  viewport: TerminalViewportPosition,
): void {
  viewport.scrollTop = viewport.scrollHeight < viewport.clientHeight
    ? 0
    : viewport.scrollHeight;
}
