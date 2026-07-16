import type { RawPagerStatus } from "../../domain/viewer/RawPager.ts";

export function lessPrompt(
  filename: string,
  status: RawPagerStatus,
): string {
  if (status.kind === "empty" || status.lastLine === status.totalLines) {
    return `${filename} (END)`;
  }

  const percentage = Math.floor(
    (status.lastLine / status.totalLines) * 100,
  );

  return `${filename} ${percentage}%`;
}
