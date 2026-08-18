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

/** Detach the upload from the browser file-picker handle before network I/O. */
export async function materializeUploadBlob(file: File): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) {
    throw new Error("The selected file could not be read completely.");
  }
  return new Blob([bytes], { type: "application/octet-stream" });
}

/** Build a binary upload that does not depend on browser multipart handling. */
export function binaryFileUploadRequest(
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-XRK-Filename": encodeURIComponent(filename),
    },
    body: blob,
    signal,
  };
}

export function exceedsUploadLimit(file: File, maxBytes?: number | null): boolean {
  return Boolean(
    maxBytes
      && Number.isFinite(maxBytes)
      && maxBytes > 0
      && file.size > maxBytes
  );
}
