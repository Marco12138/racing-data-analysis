import { memo } from "react";
import { SCHEMATIC_OUTER_WIDTH_M, SCHEMATIC_ROAD_WIDTH_M } from "../lib/trajectoryCamera";

/** Width is illustrative, in metres. Each polyline ends at its own GPS gap. */
export const GpsTrackSurface = memo(function GpsTrackSurface({ segments, unitsPerMetre = 1 }: {
  segments: string[]; unitsPerMetre?: number;
}) {
  return <g aria-hidden="true" data-testid="gps-track-surface" fill="none" strokeLinejoin="round" strokeLinecap="butt">
    {segments.map((points, i) => <g key={i}>
      <polyline points={points} stroke="#859593" strokeWidth={SCHEMATIC_OUTER_WIDTH_M * unitsPerMetre}/>
      <polyline points={points} stroke="#354247" strokeWidth={SCHEMATIC_ROAD_WIDTH_M * unitsPerMetre}/>
    </g>)}
  </g>;
});
