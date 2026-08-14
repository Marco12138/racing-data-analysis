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
 * Copy the selected file's bytes into a detached Blob before any awaits in the
 * upload path. Safari can release a File's backing data after the input event
 * settles; a materialized Blob is immune to that, so the multipart body always
 * carries the file part.
 */
export async function materializeUploadBlob(file: File): Promise<Blob> {
  if (file.size <= 0) return file;
  const bytes = await file.arrayBuffer();
  return new Blob([bytes], { type: file.type || "application/octet-stream" });
}
