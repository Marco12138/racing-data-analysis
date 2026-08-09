import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeLaps,
  buildTelemetryMetricRows,
  generateDriverReport,
  getSectorColumns,
  normalizeLapRows,
  normalizeTelemetryRows,
  parseCsv,
  summarizeTelemetry,
  validateFiles,
} from "../frontend/lib/analysis.ts";

test("CSV parsing preserves quoted notes, escaped quotes, empty values, and dynamic sectors", () => {
  const rows = parseCsv(
    '\uFEFFlap,lap_time,sector_1,sector_2,sector_3,sector_4,notes\r\n' +
      '2,51.884,13.000,12.900,13.100,12.884,"late apex, clean exit"\r\n' +
      '1,52.341,13.200,13.000,13.200,12.941,"driver said ""better"""\r\n' +
      '3,not-a-time,13.000,13.000,13.000,13.000,invalid\r\n' +
      '4,53.100,13.100,13.200,13.300,13.500,\r\n'
  );
  const laps = normalizeLapRows(rows);

  assert.equal(rows[0].notes, "late apex, clean exit");
  assert.equal(rows[1].notes, 'driver said "better"');
  assert.equal(rows[3].notes, null);
  assert.deepEqual(laps.map((lap) => lap.lap), [1, 2, 4]);
  assert.deepEqual(getSectorColumns(laps), ["sector_1", "sector_2", "sector_3", "sector_4"]);
  assert.equal(analyzeLaps(laps).fastestLap.lap, 2);
});

test("missing telemetry cells remain unavailable instead of becoming synthetic zeroes", () => {
  const telemetry = normalizeTelemetryRows(
    parseCsv("lap,time,distance,speed,throttle,brake,lateral_g\n1,0.0,0,,,,")
  );
  const summary = summarizeTelemetry(telemetry);
  const metrics = Object.fromEntries(buildTelemetryMetricRows(summary));

  assert.equal(telemetry[0].speed, undefined);
  assert.equal(telemetry[0].throttle, undefined);
  assert.equal(telemetry[0].brake, undefined);
  assert.equal(summary.hasThrottle, false);
  assert.equal(summary.hasBrake, false);
  assert.deepEqual(metrics, {
    "Maximum speed": "Unavailable",
    "Average speed": "Unavailable",
    "Average throttle": "Unavailable",
    "Maximum brake": "Unavailable",
    "Maximum lateral G": "Unavailable",
  });
});

test("measured zero-valued channels are displayed as measurements, not unavailable", () => {
  const telemetry = normalizeTelemetryRows(
    parseCsv("lap,time,distance,speed,throttle,brake,lateral_g\n1,0.0,0,0,0,0,0")
  );
  const summary = summarizeTelemetry(telemetry);
  const metrics = Object.fromEntries(buildTelemetryMetricRows(summary));

  assert.equal(summary.hasThrottle, true);
  assert.equal(summary.hasBrake, true);
  assert.equal(metrics["Maximum speed"], "0.0 km/h");
  assert.equal(metrics["Average throttle"], "0.0 %");
  assert.equal(metrics["Maximum brake"], "0.0 %");
  assert.equal(metrics["Maximum lateral G"], "0.00 g");
});

test("lap-only sessions keep telemetry unavailable without inventing report metrics", () => {
  const laps = normalizeLapRows(
    parseCsv("lap,lap_time,sector_1,sector_2,sector_3\n1,51.500,17.1,17.2,17.2\n2,51.200,17.0,17.1,17.1")
  );
  const readiness = validateFiles(laps, []);
  const report = generateDriverReport(analyzeLaps(laps), null, []);

  assert.equal(readiness.lapStatus, "Valid lap file");
  assert.equal(readiness.telemetryStatus, "Telemetry file not loaded");
  assert.match(report, /Telemetry channel unavailable/);
  assert.match(report, /Driving Behavior Assistant is unavailable/);
  assert.doesNotMatch(report, /Maximum speed reached/);
});
