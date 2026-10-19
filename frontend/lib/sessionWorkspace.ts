import type { XrkInspection } from "./xrkAnalysisApi";

export const MAX_TEMPORARY_SESSIONS = 4;
export const SESSION_STORAGE_KEY = "racing-temporary-xrk-sessions:v1";
export const EXPERIMENT_STORAGE_KEY = "racing-setup-experiments:v1";

export type SessionDisplayMetadata = Partial<Record<"Driver" | "Vehicle" | "Venue" | "Log Date", string>>;
export type WorkspaceSession = XrkInspection & { display_metadata?: SessionDisplayMetadata };

export type StoredSession = Pick<
  XrkInspection,
  "inspection_id" | "expires_at" | "filename" | "metadata" | "laps" | "valid_laps" | "session_summary"
> & { display_metadata?: SessionDisplayMetadata };

/** Keep user labels separate from recorder metadata and analysis identity. */
export function sessionMetadata(session: Pick<WorkspaceSession, "metadata" | "display_metadata">) {
  return { ...session.metadata, ...cleanDisplayMetadata(session.display_metadata) };
}

function cleanDisplayMetadata(value: unknown): SessionDisplayMetadata {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(["Driver", "Vehicle", "Venue", "Log Date"].flatMap(key => {
    const label = (value as Record<string, unknown>)[key];
    return typeof label === "string" ? [[key, label.slice(0, 200)]] : [];
  }));
}

/** Restore labels only for the same token; the server still owns its expiry. */
export function restoreSessionLabels(inspection: XrkInspection, stored?: StoredSession): WorkspaceSession {
  const labels = inspection.inspection_id === stored?.inspection_id
    ? cleanDisplayMetadata(stored.display_metadata) : {};
  return Object.keys(labels).length ? { ...inspection, display_metadata: labels } : inspection;
}

export function updateSessionLabel(session: WorkspaceSession, key: keyof SessionDisplayMetadata, value: string): WorkspaceSession {
  return { ...session, display_metadata: { ...cleanDisplayMetadata(session.display_metadata), [key]: value.slice(0, 200) } };
}

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

export function toStoredSession(inspection: WorkspaceSession): StoredSession {
  return {
    inspection_id: inspection.inspection_id,
    expires_at: inspection.expires_at,
    filename: inspection.filename,
    metadata: inspection.metadata,
    laps: inspection.laps,
    valid_laps: inspection.valid_laps,
    session_summary: inspection.session_summary,
    ...(inspection.display_metadata ? { display_metadata: cleanDisplayMetadata(inspection.display_metadata) } : {}),
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
