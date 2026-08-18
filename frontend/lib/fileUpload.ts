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

/** Return the original browser File without copying or slicing its file handle. */
export async function materializeUploadBlob(file: File): Promise<Blob> {
  return file;
}

export function exceedsUploadLimit(file: File, maxBytes?: number | null): boolean {
  return Boolean(
    maxBytes
      && Number.isFinite(maxBytes)
      && maxBytes > 0
      && file.size > maxBytes
  );
}
