import type { XrkInspection } from "./xrkAnalysisApi";

export const MAX_TEMPORARY_SESSIONS = 4;
export const SESSION_STORAGE_KEY = "racing-temporary-xrk-sessions:v1";
export const EXPERIMENT_STORAGE_KEY = "racing-setup-experiments:v1";

export type StoredSession = Pick<
  XrkInspection,
  "inspection_id" | "expires_at" | "filename" | "metadata" | "laps" | "valid_laps" | "session_summary"
>;

export type SetupChangeDraft = {
  category: string;
  parameter: string;
  before: string;
  after: string;
  unit: string;
};

export type SetupExperimentDraft = {
  id: string;
  name: string;
  baselineInspectionId: string;
  modifiedInspectionId: string;
  primaryChange: SetupChangeDraft;
  secondaryChanges: SetupChangeDraft[];
  conditions: Record<string, string | number | null>;
  driverFeedback: Record<string, string>;
  updatedAt: string;
};

export function toStoredSession(inspection: XrkInspection): StoredSession {
  return {
    inspection_id: inspection.inspection_id,
    expires_at: inspection.expires_at,
    filename: inspection.filename,
    metadata: inspection.metadata,
    laps: inspection.laps,
    valid_laps: inspection.valid_laps,
    session_summary: inspection.session_summary,
  };
}

export function addStoredSession(
  sessions: StoredSession[],
  inspection: XrkInspection
): StoredSession[] {
  const active = pruneExpiredSessions(sessions).filter(
    (session) => session.inspection_id !== inspection.inspection_id
  );
  if (active.length >= MAX_TEMPORARY_SESSIONS) {
    throw new Error("Temporary Session Workspace is full. Remove one session before importing another XRK.");
  }
  return [...active, toStoredSession(inspection)];
}

export function pruneExpiredSessions(
  sessions: StoredSession[],
  nowMs = Date.now()
): StoredSession[] {
  return sessions.filter((session) => {
    const expiry = Date.parse(session.expires_at);
    return Number.isFinite(expiry) && expiry > nowMs;
  });
}

export function parseStoredSessions(value: string | null, nowMs = Date.now()): StoredSession[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as StoredSession[];
    return Array.isArray(parsed)
      ? pruneExpiredSessions(parsed, nowMs).slice(-MAX_TEMPORARY_SESSIONS)
      : [];
  } catch {
    return [];
  }
}

export function parseStoredExperiments(value: string | null): SetupExperimentDraft[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as SetupExperimentDraft[];
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function metadataLabel(
  metadata: Record<string, string | number | null>,
  key: string,
  fallback: string
): string {
  const value = metadata[key];
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback
    : String(value);
}
