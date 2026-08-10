export type InitialVideoState = {
  videoUrl: string;
  videoName: string;
  videoFile: File | null;
};

/** Build the workspace video state from an optional initial (never-uploaded) file. */
export function initialVideoState(
  initialVideoFile: File | null | undefined,
  createObjectUrl: (file: File) => string,
): InitialVideoState {
  return {
    videoUrl: initialVideoFile ? createObjectUrl(initialVideoFile) : "",
    videoName: initialVideoFile?.name ?? "",
    videoFile: initialVideoFile ?? null,
  };
}
