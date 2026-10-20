import { I18nProvider } from "../../frontend/lib/i18n";
import { SelectedCornerPanel } from "../../frontend/components/SelectedCornerPanel";
import type { XrkAnalysis } from "../../frontend/lib/xrkAnalysisApi";

export function CornerTest({ locale, available = false }: { locale: "zh" | "en"; available?: boolean }) {
  const file = available ? new File(["test"], "fixture.mp4", { type: "video/mp4", lastModified: 1 }) : null;
  const analysis = { file_fingerprint: "test", inspection_id: "a".repeat(32), lap_quality: { laps: [{ lap: 1, analysis_eligible: true }] },
    video_sync: { lap_video_ranges: [{ lap: 1, telemetry_start_s: 0, telemetry_end_s: 40 }] } } as XrkAnalysis;
  return <I18nProvider initialLocale={locale}><SelectedCornerPanel analysis={analysis} file={file} url={available ? "blob:local" : ""} duration={50}
    anchors={available ? [{ version: 1, target_lap: 1, offset_ms: 0, telemetry_distance_m: 0, telemetry_session_time_s: 0,
      video_time_s: 0, calibrated_at: "test", video: { size_bytes: 4, last_modified_ms: 1, duration_s: 50, mime_type: "video/mp4" } }] : []} onSync={() => {}} /></I18nProvider>;
}
