export type ManualComparisonZone = {
  id: string;
  name: string;
  entry_distance_m: number;
  exit_distance_m: number;
};

export type LocalTrackPoint = {
  local_x_m: number | null;
  local_y_m: number | null;
};

export type TrackProjection = {
  project: (point: LocalTrackPoint) => { x: number; y: number };
  scale: number;
};

export function createManualZone(index: number): ManualComparisonZone {
  return {
    id: `manual-zone-${index + 1}`,
    name: `Manual Zone ${index + 1}`,
    entry_distance_m: 0,
    exit_distance_m: 0,
  };
}

export function appendManualZone(
  zones: ManualComparisonZone[]
): ManualComparisonZone[] {
  let index = zones.length;
  const usedIds = new Set(zones.map((zone) => zone.id));
  while (usedIds.has(`manual-zone-${index + 1}`)) index += 1;
  return [...zones, createManualZone(index)];
}

export function updateManualZone(
  zones: ManualComparisonZone[],
  id: string,
  changes: Partial<Omit<ManualComparisonZone, "id">>
): ManualComparisonZone[] {
  return zones.map((zone) => zone.id === id ? { ...zone, ...changes } : zone);
}

export function validateManualZones(
  zones: ManualComparisonZone[],
  maximumDistanceM?: number | null
): string | null {
  for (const zone of zones) {
    if (!zone.name.trim()) return "Each manual zone needs a name.";
    if (!Number.isFinite(zone.entry_distance_m) || !Number.isFinite(zone.exit_distance_m)) {
      return `${zone.name} needs finite entry and exit distances.`;
    }
    if (zone.entry_distance_m < 0 || zone.exit_distance_m <= zone.entry_distance_m) {
      return `${zone.name} exit distance must be greater than its non-negative entry distance.`;
    }
    if (
      typeof maximumDistanceM === "number"
      && Number.isFinite(maximumDistanceM)
      && zone.exit_distance_m > maximumDistanceM
    ) {
      return `${zone.name} exceeds the shared track distance of ${maximumDistanceM.toFixed(1)} m.`;
    }
  }
  return null;
}

export function createTrackProjection(
  points: LocalTrackPoint[],
  viewportWidth = 600,
  viewportHeight = 400,
  padding = 24
): TrackProjection | null {
  const usable = points.filter(
    (point): point is { local_x_m: number; local_y_m: number } =>
      typeof point.local_x_m === "number"
      && Number.isFinite(point.local_x_m)
      && typeof point.local_y_m === "number"
      && Number.isFinite(point.local_y_m)
  );
  if (!usable.length) return null;

  const xs = usable.map((point) => point.local_x_m);
  const ys = usable.map((point) => point.local_y_m);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dataWidth = Math.max(1, maxX - minX);
  const dataHeight = Math.max(1, maxY - minY);
  const drawableWidth = Math.max(1, viewportWidth - padding * 2);
  const drawableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.min(drawableWidth / dataWidth, drawableHeight / dataHeight);
  const renderedWidth = dataWidth * scale;
  const renderedHeight = dataHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;

  return {
    scale,
    project: (point) => ({
      x: offsetX + ((point.local_x_m ?? minX) - minX) * scale,
      y: viewportHeight - offsetY - ((point.local_y_m ?? minY) - minY) * scale,
    }),
  };
}

export function isExpiredInspectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "XRK_INSPECTION_EXPIRED" || candidate.status === 410;
}

export function removeInspectionSessions<T extends { inspection_id: string }>(
  sessions: T[],
  expiredIds: string[]
): T[] {
  const expired = new Set(expiredIds);
  return sessions.filter((session) => !expired.has(session.inspection_id));
}
