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
