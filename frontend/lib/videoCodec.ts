/**
 * Cheap, dependency-free MP4 video-codec detection from the file header.
 *
 * Browsers report MEDIA_ERR_SRC_NOT_SUPPORTED for HEVC/H.265 clips even when
 * the file is readable, so we inspect the sample-entry atoms ("avc1"/"avc3"
 * for H.264, "hvc1"/"hev1"/"dvh1" for HEVC) to give users an actionable hint.
 */

export type DetectedVideoCodec = "h264" | "hevc" | "unknown";

const H264_MARKERS = ["avc1", "avc3"];
const HEVC_MARKERS = ["hvc1", "hev1", "dvh1"];
const PROBE_BYTES = 1_000_000;

export async function detectVideoCodecFromFile(
  file: File,
): Promise<DetectedVideoCodec> {
  try {
    const size = Math.min(file.size, PROBE_BYTES);
    const bytes = new Uint8Array(await file.slice(0, size).arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    if (HEVC_MARKERS.some((marker) => text.includes(marker))) return "hevc";
    if (H264_MARKERS.some((marker) => text.includes(marker))) return "h264";
    return "unknown";
  } catch {
    return "unknown";
  }
}
