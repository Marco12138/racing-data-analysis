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
  const bytes = await readFileBytes(file);
  if (bytes.byteLength !== file.size) {
    throw new Error("The selected file could not be read completely.");
  }
  return new Blob([bytes], { type: "application/octet-stream" });
}

/** Materialize an XRK file immediately so Safari cannot drop its backing data. */
export async function materializeXrkFile(file: File): Promise<File> {
  const detached = await materializeUploadBlob(file);
  return new File([detached], file.name, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  return readFileBytesWithFileReader(file);
}

function readFileBytesWithFileReader(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.onabort = () => reject(new Error("File read was cancelled."));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("FileReader returned an unsupported result."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(file);
  });
}

/** Explain a failed browser file read without exposing raw error internals. */
export function describeFileReadError(error: unknown): string {
  const name =
    typeof DOMException !== "undefined" && error instanceof DOMException
      ? error.name
      : "";
  if (name === "NotReadableError" || name === "SecurityError") {
    return "系统拒绝了浏览器读取该文件。若文件位于外置磁盘或 iCloud，请优先使用左侧“本机 XRK 文件库”直接分析；也可以先把文件完整复制到桌面或下载目录，再重新选择。";
  }
  if (error instanceof TypeError) {
    return "当前浏览器不支持直接读取 XRK 文件，请升级 Safari，或改用 Chrome / Edge 后重试。";
  }
  return "浏览器无法读取所选 XRK 文件。如果文件位于 iCloud、网盘或外置磁盘，请先确认它已完整下载并可在本机打开，然后重新选择。";
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
