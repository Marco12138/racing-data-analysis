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

/** After analysis completes, the pending video becomes the active workspace video. */
export function commitPendingVideo(
  pending: File | null,
  active: File | null,
): File | null {
  return pending ?? active;
}
