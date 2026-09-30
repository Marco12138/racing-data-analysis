declare module "mp4box" {
  export function createFile(): {
    onError: (error: unknown) => void;
    onReady: (info: import("../lib/gpmfTelemetry").Movie) => void;
    appendBuffer(buffer: ArrayBuffer & { fileStart: number }): number;
    getTrackSamplesInfo(id: number): Array<{ cts: number; duration: number; timescale: number; size: number; offset: number }>;
  };
}
declare module "gopro-telemetry" {
  export default function decode(input: { rawData: Uint8Array }, options: { raw: true; stream: string[] }): Promise<Record<string, unknown>>;
}
