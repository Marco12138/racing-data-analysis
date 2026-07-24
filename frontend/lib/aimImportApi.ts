import type { CsvRow } from "./analysis";
import { resolveApiUrl } from "./config";

export type AimChannel = {
  name: string;
  units: string | null;
  samples: number;
  status: "used" | "available_not_exported" | "excluded_all_zero" | "unavailable";
};

export type AimImportResponse = {
  format: "aim_xrk";
  source: {
    name: string;
    size_bytes: number;
    sha256: string;
    original_modified: boolean;
  };
  metadata: Record<string, string | number | null>;
  lap_selection: {
    valid_laps: number[];
    excluded_laps: Array<{
      lap: number;
      duration_s: number;
      distance_m: number;
      reasons: string[];
    }>;
  };
  virtual_sectors: {
    method: "equal_distance_thirds";
    derived_not_official: boolean;
    median_track_distance_m: number;
    boundaries_m: number[];
  };
  channels: AimChannel[];
  warnings: string[];
  lap_rows: CsvRow[];
  telemetry_rows: CsvRow[];
  telemetry_rows_total: number;
  telemetry_downsampled: boolean;
  lap_analysis: {
    fastest_lap: { lap: number; lap_time: number };
  };
  report: string;
};

export async function importAimSession(file: File): Promise<AimImportResponse> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetch(await resolveApiUrl("/imports/aim"), {
      method: "POST",
      body: form,
    });
  } catch {
    throw new Error(
      "XRK import service is unavailable. CSV upload and Try Demo remain available."
    );
  }
  if (!response.ok) {
    let message = `XRK import failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.detail ?? message;
    } catch {
      // Keep the status-based message when the hosting proxy returns HTML.
    }
    throw new Error(message);
  }
  return response.json() as Promise<AimImportResponse>;
}
