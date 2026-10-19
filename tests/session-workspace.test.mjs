import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TEMPORARY_SESSIONS,
  addStoredSession,
  parseStoredSessions,
  pruneExpiredSessions,
  restoreSessionLabels,
  sessionMetadata,
  updateSessionLabel,
  toStoredSession,
} from "../frontend/lib/sessionWorkspace.ts";

function inspection(id, expiresAt) {
  return {
    inspection_id: id.padEnd(32, "0"),
    expires_at: expiresAt,
    filename: `${id}.xrk`,
    metadata: { Driver: id, Venue: "Test Track" },
    laps: 3,
    valid_laps: [1, 2, 3],
    session_summary: {
      lap_segments: 3,
      timed_laps: 3,
      session_duration_s: 120,
      fastest_lap: { lap: 1, lap_time_s: 40 },
    },
  };
}

test("temporary session workspace prunes fixed-expiry tokens", () => {
  const now = Date.parse("2026-08-08T00:00:00Z");
  const active = inspection("active", "2026-08-08T00:10:00Z");
  const expired = inspection("expired", "2026-08-07T23:59:00Z");
  assert.deepEqual(pruneExpiredSessions([active, expired], now), [active]);
  assert.deepEqual(
    parseStoredSessions(JSON.stringify([active, expired]), now),
    [active]
  );
});

test("edited session labels survive storage and refresh without rewriting recorder data", () => {
  const original = inspection("marco", "2099-01-01T00:00:00Z");
  const edited = updateSessionLabel(updateSessionLabel(original, "Driver", "martin"), "Venue", "New track");
  const [stored] = parseStoredSessions(JSON.stringify([toStoredSession(edited)]));
  const refreshed = restoreSessionLabels({ ...original, expires_at: "2098-01-01T00:00:00Z" }, stored);
  assert.equal(sessionMetadata(refreshed).Driver, "martin");
  assert.equal(sessionMetadata(refreshed).Venue, "New track");
  assert.equal(refreshed.metadata.Driver, "marco");
  assert.equal(original.metadata.Driver, "marco");
  assert.equal(refreshed.expires_at, "2098-01-01T00:00:00Z");
  const other = inspection("other", "2099-01-01T00:00:00Z");
  assert.equal(sessionMetadata(restoreSessionLabels(other, stored)).Driver, "other");
});

test("only supported string display labels are restored, including an intentionally empty label", () => {
  const original = inspection("marco", "2099-01-01T00:00:00Z");
  const restored = restoreSessionLabels(original, { ...original, display_metadata: {
    Driver: "", Vehicle: { invalid: true }, Venue: "Track", expires_at: "2100-01-01",
  } });
  assert.deepEqual(restored.display_metadata, { Driver: "", Venue: "Track" });
  assert.equal(sessionMetadata(restored).Driver, "");
});

test("temporary session workspace enforces the four-session limit", () => {
  const expiry = "2099-01-01T00:00:00Z";
  let sessions = [];
  for (let index = 0; index < MAX_TEMPORARY_SESSIONS; index += 1) {
    sessions = addStoredSession(sessions, inspection(`s${index}`, expiry));
  }
  assert.equal(sessions.length, 4);
  assert.throws(
    () => addStoredSession(sessions, inspection("overflow", expiry)),
    /Workspace is full/
  );
});
