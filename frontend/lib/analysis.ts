export type CsvRow = Record<string, string | number | null | undefined>;

export type LapRow = CsvRow & {
  lap: number;
  lap_time: number;
};

export type TelemetryRow = CsvRow & {
  time?: number;
  lap: number;
  distance?: number;
  speed?: number;
  throttle?: number;
  brake?: number;
  steering_angle?: number;
  lateral_g?: number;
};

export type HandlingFlag = {
  lap: number;
  sector: string;
  eventType: "Possible Understeer" | "Possible Oversteer";
  confidence: "Low" | "Medium" | "High";
  reason: string;
};

export function parseCsv(text: string): CsvRow[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return headers.reduce<CsvRow>((row, header, index) => {
      const raw = values[index]?.trim() ?? "";
      const numeric = Number(raw);
      row[header] = raw === "" ? null : Number.isFinite(numeric) ? numeric : raw;
      return row;
    }, {});
  });
}

export function normalizeLapRows(rows: CsvRow[]): LapRow[] {
  return rows
    .filter((row) => row.lap !== null && row.lap_time !== null)
    .map((row) => ({ ...row, lap: Number(row.lap), lap_time: Number(row.lap_time) }))
    .filter((row) => Number.isFinite(row.lap) && Number.isFinite(row.lap_time))
    .sort((a, b) => a.lap - b.lap);
}

export function normalizeTelemetryRows(rows: CsvRow[]): TelemetryRow[] {
  return rows
    .filter((row) => row.lap !== null)
    .map((row) => ({
      ...row,
      lap: Number(row.lap),
      time: toOptionalNumber(row.time),
      distance: toOptionalNumber(row.distance),
      speed: toOptionalNumber(row.speed),
      throttle: toOptionalNumber(row.throttle),
      brake: toOptionalNumber(row.brake),
      steering_angle: toOptionalNumber(row.steering_angle),
      lateral_g: toOptionalNumber(row.lateral_g),
    }))
    .filter((row) => Number.isFinite(row.lap))
    .sort((a, b) => a.lap - b.lap || (a.distance ?? 0) - (b.distance ?? 0));
}

function toOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function getSectorColumns(rows: LapRow[]): string[] {
  const first = rows[0] ?? {};
  return Object.keys(first).filter((key) => key.startsWith("sector_"));
}

export function analyzeLaps(rows: LapRow[]) {
  const sectors = getSectorColumns(rows);
  const fastestLap = rows.reduce((best, row) => (row.lap_time < best.lap_time ? row : best), rows[0]);
  const sectorBest = Object.fromEntries(
    sectors.map((sector) => [sector, Math.min(...rows.map((row) => Number(row[sector])))])
  );
  const theoreticalBest = Object.values(sectorBest).reduce((sum, value) => sum + value, 0);
  const averageLap = rows.reduce((sum, row) => sum + row.lap_time, 0) / rows.length;
  const lapDeltas = rows.map((row) => ({
    ...row,
    delta_to_best: row.lap_time - fastestLap.lap_time,
  }));
  const sectorLossRows: Array<Record<string, number | string>> = rows.map((row) => {
    const losses: Record<string, number> = Object.fromEntries(
      sectors.map((sector) => [`${sector}_loss`, Number(row[sector]) - sectorBest[sector]])
    );
    const maxLossSector = sectors.reduce((current, sector) => {
      const currentLoss = Number(losses[`${current}_loss`]);
      const sectorLoss = Number(losses[`${sector}_loss`]);
      return sectorLoss > currentLoss ? sector : current;
    }, sectors[0]);
    return {
      lap: row.lap,
      ...losses,
      total_loss: sectors.reduce((sum, sector) => sum + Number(losses[`${sector}_loss`]), 0),
      max_loss_sector: maxLossSector,
    };
  });
  const sectorRanking = sectors.map((sector) => {
    const values = rows.map((row) => Number(row[sector]));
    const losses = sectorLossRows.map((row) => Number(row[`${sector}_loss`]));
    return {
      sector,
      best: Math.min(...values),
      average: average(values),
      averageLoss: average(losses),
      range: Math.max(...values) - Math.min(...values),
    };
  });
  const bestSector = [...sectorRanking].sort((a, b) => a.averageLoss - b.averageLoss)[0]?.sector ?? "N/A";
  const mainLossSector = [...sectorRanking].sort((a, b) => b.averageLoss - a.averageLoss)[0]?.sector ?? "N/A";
  const consistencyScore = Math.max(0, 100 - standardDeviation(rows.map((row) => row.lap_time)) * 18);
  return {
    sectors,
    fastestLap,
    theoreticalBest,
    averageLap,
    lapDeltas,
    sectorLossRows,
    sectorRanking,
    bestSector,
    mainLossSector,
    consistencyScore,
    potentialGain: fastestLap.lap_time - theoreticalBest,
  };
}

export function summarizeTelemetry(rows: TelemetryRow[]) {
  const speeds = rows.map((row) => row.speed).filter(isNumber);
  const throttle = rows.map((row) => row.throttle).filter(isNumber);
  const brake = rows.map((row) => row.brake).filter(isNumber);
  const lateralG = rows.map((row) => row.lateral_g).filter(isNumber);
  return {
    maxSpeed: speeds.length ? Math.max(...speeds) : null,
    averageSpeed: speeds.length ? average(speeds) : null,
    averageThrottle: throttle.length ? average(throttle) : null,
    fullThrottlePercentage: throttle.length ? (throttle.filter((value) => value >= 95).length / throttle.length) * 100 : null,
    maxBrake: brake.length ? Math.max(...brake) : null,
    brakingDuration: brake.length ? (brake.filter((value) => value > 5).length / brake.length) * 100 : null,
    minimumCornerSpeed: speeds.length ? Math.min(...speeds) : null,
    maxLateralG: lateralG.length ? Math.max(...lateralG.map(Math.abs)) : null,
  };
}

export function compareSpeedByDistance(rows: TelemetryRow[], referenceLap: number, targetLap: number) {
  const reference = rows.filter((row) => row.lap === referenceLap && isNumber(row.distance) && isNumber(row.speed));
  const target = rows.filter((row) => row.lap === targetLap && isNumber(row.distance) && isNumber(row.speed));
  return target.map((targetRow) => {
    const nearest = reference.reduce((best, row) =>
      Math.abs((row.distance ?? 0) - (targetRow.distance ?? 0)) < Math.abs((best.distance ?? 0) - (targetRow.distance ?? 0))
        ? row
        : best
    , reference[0]);
    return {
      distance: targetRow.distance ?? 0,
      referenceSpeed: nearest?.speed ?? 0,
      targetSpeed: targetRow.speed ?? 0,
      speedDiff: (targetRow.speed ?? 0) - (nearest?.speed ?? 0),
    };
  });
}

export function generateHandlingFlags(rows: TelemetryRow[]): HandlingFlag[] {
  const flags: HandlingFlag[] = [];
  rows.forEach((row, index) => {
    const steering = Math.abs(row.steering_angle ?? 0);
    const lateral = Math.abs(row.lateral_g ?? 0);
    if (steering >= 28 && lateral >= 0.85 && (row.brake ?? 0) < 35) {
      flags.push({
        lap: row.lap,
        sector: inferSector(row.distance),
        eventType: "Possible Understeer",
        confidence: "Medium",
        reason: "Large steering input with high lateral G and limited speed reduction.",
      });
    }
    const previous = rows[index - 1];
    if (previous?.lap === row.lap) {
      const steeringChange = Math.abs((row.steering_angle ?? 0) - (previous.steering_angle ?? 0));
      const lateralChange = Math.abs((row.lateral_g ?? 0) - (previous.lateral_g ?? 0));
      if (steeringChange >= 18 && lateralChange >= 0.35 && (row.throttle ?? 0) >= 55) {
        flags.push({
          lap: row.lap,
          sector: inferSector(row.distance),
          eventType: "Possible Oversteer",
          confidence: "Low",
          reason: "Counter-steering pattern after throttle application; yaw_rate is unavailable.",
        });
      }
    }
  });
  return flags;
}

export function validateFiles(lapRows: LapRow[], telemetryRows: TelemetryRow[]) {
  const lapRequired = ["lap", "lap_time"];
  const lapMissing = lapRequired.filter((key) => !Object.prototype.hasOwnProperty.call(lapRows[0] ?? {}, key));
  const sectors = getSectorColumns(lapRows);
  const telemetryRecommended = ["time", "lap", "distance", "speed", "throttle", "brake", "steering_angle", "rpm", "gear", "lateral_g", "gps_lat", "gps_lon"];
  const telemetryMissing = telemetryRecommended.filter((key) => !Object.prototype.hasOwnProperty.call(telemetryRows[0] ?? {}, key));
  return {
    lapStatus: lapRows.length && !lapMissing.length && sectors.length ? "Valid lap file" : "Lap file needs lap, lap_time, and sector columns",
    telemetryStatus: telemetryRows.length ? "Telemetry file loaded" : "Telemetry file not loaded",
    telemetryMissing,
    advancedWarning: telemetryMissing.length > 0,
  };
}

export function generateDriverReport(
  laps: ReturnType<typeof analyzeLaps>,
  telemetry: ReturnType<typeof summarizeTelemetry> | null,
  flags: HandlingFlag[]
) {
  const understeer = flags.filter((flag) => flag.eventType === "Possible Understeer");
  const oversteer = flags.filter((flag) => flag.eventType === "Possible Oversteer");
  return [
    `Session Summary: The driver completed ${laps.lapDeltas.length} laps.`,
    `The fastest lap was Lap ${laps.fastestLap.lap} at ${formatSeconds(laps.fastestLap.lap_time)}.`,
    `The theoretical best lap is ${formatSeconds(laps.theoreticalBest)}, leaving ${formatSeconds(laps.potentialGain)} of potential gain.`,
    `The largest performance loss comes from ${formatSector(laps.mainLossSector)}.`,
    telemetry?.maxSpeed ? `Maximum speed reached ${telemetry.maxSpeed.toFixed(1)} km/h with average speed ${telemetry.averageSpeed?.toFixed(1)} km/h.` : "Telemetry channel unavailable. Lap and sector findings remain valid.",
    understeer.length ? `Driving Behavior Assistant flagged ${understeer.length} possible understeer event(s), mainly around ${understeer[0].sector}.` : "No possible understeer events were flagged by the current heuristic.",
    oversteer.length ? `Possible oversteer appeared ${oversteer.length} time(s). Confidence remains low without yaw_rate or richer trajectory data.` : "No possible oversteer events were flagged by the current heuristic.",
    `Recommended focus: review ${formatSector(laps.mainLossSector)} braking point, entry speed consistency, and corner exit throttle application.`,
  ].join("\n\n");
}

export function formatSeconds(value: number | null | undefined) {
  if (!isNumber(value)) return "N/A";
  return `${value.toFixed(3)}s`;
}

export function formatSector(value: string) {
  return value.replace("sector_", "Sector ");
}

function inferSector(distance?: number) {
  if (!isNumber(distance)) return "Unknown sector";
  if (distance < 260) return "Sector 1";
  if (distance < 560) return "Sector 2";
  return "Sector 3";
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
