import type { LocalXrkSource } from "./xrkAnalysisApi";

export type SessionUploadSelection = {
  xrkFile: File | null;
  videoFile: File | null;
};

export function isXrkFileName(name: string): boolean {
  return /\.(xrk|xrz)$/i.test(name);
}

/** The combined entry needs telemetry; the onboard video is optional. */
export function canStartNewSession(selection: SessionUploadSelection): boolean {
  return selection.xrkFile != null && isXrkFileName(selection.xrkFile.name);
}

export function resolveLocalXrkSource(
  sources: LocalXrkSource[],
  sourceId: string | null,
): LocalXrkSource | null {
  return sources.find((source) => source.source_id === sourceId)
    ?? sources[0]
    ?? null;
}

/** After analysis completes, the pending video becomes the active workspace video. */
export function commitPendingVideo(
  pending: File | null,
  active: File | null,
): File | null {
  return pending ?? active;
}
