export function routeEditorAssetFiles(
  files: ReadonlyArray<File>,
  onFiles: ((files: ReadonlyArray<File>) => void) | undefined,
  preventDefault: () => void,
): boolean {
  if (files.length === 0 || onFiles === undefined) return false;
  preventDefault();
  onFiles(files);
  return true;
}
