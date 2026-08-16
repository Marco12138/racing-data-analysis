/** Keep a browser-selected File alive until its async consumer has settled. */
export async function consumeSelectedFile(
  file: File,
  onFile: (file: File) => void | Promise<unknown>,
  resetInput: () => void,
): Promise<void> {
  try {
    await onFile(file);
  } finally {
    resetInput();
  }
}

/**
 * Create a stable Blob view without copying the entire XRK into browser memory.
 * The file input remains mounted until the async upload settles, so Safari keeps
 * the selected file alive while large logs can stream through FormData.
 */
export async function materializeUploadBlob(file: File): Promise<Blob> {
  if (file.size <= 0) return file;
  return file.slice(0, file.size, file.type || "application/octet-stream");
}

export function exceedsUploadLimit(file: File, maxBytes?: number | null): boolean {
  return Boolean(
    maxBytes
      && Number.isFinite(maxBytes)
      && maxBytes > 0
      && file.size > maxBytes
  );
}
