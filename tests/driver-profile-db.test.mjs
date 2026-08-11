import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import test from "node:test";

globalThis.indexedDB = new IDBFactory();

const {
  clearAllSummaries,
  deleteSessionSummary,
  exportSummariesJson,
  getAllSessionSummaries,
  importSummaries,
  saveSessionSummary,
} = await import("../frontend/lib/driverProfileDb.ts");

function summary(inspectionId, lapTime) {
  return {
    inspection_id: inspectionId,
    track_id: "track-a",
    track_name: "Track A",
    driver_name: "Driver",
    vehicle_name: "Kart",
    fastest_lap: { lap: 13, lap_time: lapTime },
    corner_improvements: [{ corner: "Zone 4", net_gain: 0.24 }],
    training_priorities: ["Recovery near 282.0 m"],
    analyzed_at: Date.now(),
  };
}

test("driver profile IndexedDB round-trips sessions", async () => {
  await clearAllSummaries();
  await saveSessionSummary(summary("s1", 40.5));
  await saveSessionSummary(summary("s2", 40.2));
  const rows = await getAllSessionSummaries();
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.inspection_id === "s1"));
  assert.ok(rows.some((row) => row.inspection_id === "s2"));

  await deleteSessionSummary("s1");
  const afterDelete = await getAllSessionSummaries();
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].inspection_id, "s2");

  const imported = await importSummaries([summary("s3", 39.9)]);
  assert.equal(imported, 1);
  const afterImport = await getAllSessionSummaries();
  assert.equal(afterImport.length, 2);

  const exported = await exportSummariesJson();
  const parsed = JSON.parse(exported);
  assert.equal(parsed.sessions.length, 2);

  await clearAllSummaries();
  assert.equal((await getAllSessionSummaries()).length, 0);
});
