import assert from "node:assert/strict";
import test from "node:test";

import {
  appendManualZone,
  createManualZone,
  createTrackProjection,
  isExpiredInspectionError,
  removeInspectionSessions,
  updateManualZone,
  validateManualZones,
} from "../frontend/lib/driverComparison.ts";

test("manual comparison zones support immutable entry and exit editing", () => {
  const initial = [createManualZone(0)];
  const updated = updateManualZone(initial, initial[0].id, {
    name: "Turn 4",
    entry_distance_m: 412.5,
    exit_distance_m: 468.2,
  });

  assert.equal(initial[0].entry_distance_m, 0);
  assert.deepEqual(updated[0], {
    id: "manual-zone-1",
    name: "Turn 4",
    entry_distance_m: 412.5,
    exit_distance_m: 468.2,
  });
  assert.equal(validateManualZones(updated, 800), null);

  const withSecond = appendManualZone(updated);
  const afterRemoval = withSecond.filter((zone) => zone.id !== "manual-zone-1");
  assert.equal(appendManualZone(afterRemoval).at(-1)?.id, "manual-zone-3");
});

test("manual comparison zones reject invalid and out-of-range boundaries", () => {
  const reversed = [{
    id: "z1",
    name: "Turn 1",
    entry_distance_m: 100,
    exit_distance_m: 90,
  }];
  assert.match(validateManualZones(reversed) ?? "", /greater than/);

  const tooLong = [{ ...reversed[0], exit_distance_m: 900 }];
  assert.match(validateManualZones(tooLong, 800) ?? "", /shared track distance/);
});

test("track projection applies one metre-to-pixel scale on both axes", () => {
  const projection = createTrackProjection([
    { local_x_m: 0, local_y_m: 0 },
    { local_x_m: 200, local_y_m: 100 },
  ]);
  assert.ok(projection);

  const origin = projection.project({ local_x_m: 0, local_y_m: 0 });
  const oneMetreX = projection.project({ local_x_m: 1, local_y_m: 0 });
  const oneMetreY = projection.project({ local_x_m: 0, local_y_m: 1 });
  assert.ok(Math.abs((oneMetreX.x - origin.x) - projection.scale) < 1e-9);
  assert.ok(Math.abs((origin.y - oneMetreY.y) - projection.scale) < 1e-9);
});

test("expired inspection state recognizes both public error code and HTTP 410", () => {
  assert.equal(isExpiredInspectionError({ code: "XRK_INSPECTION_EXPIRED" }), true);
  assert.equal(isExpiredInspectionError({ status: 410 }), true);
  assert.equal(isExpiredInspectionError({ code: "CROSS_SESSION_DATA_INCOMPATIBLE", status: 422 }), false);
  assert.deepEqual(
    removeInspectionSessions(
      [{ inspection_id: "active" }, { inspection_id: "expired" }],
      ["expired"]
    ),
    [{ inspection_id: "active" }]
  );
});
