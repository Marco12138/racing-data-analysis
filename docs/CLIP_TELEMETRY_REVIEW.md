# Clip telemetry below paired video

The guided and free-workspace coach review now shows speed and RPM directly
below each local video. Both panels use a shared distance domain and identical
channel scales. Each cursor follows its own video's confirmed manual mapping;
video is neither stretched nor frame-locked to the other lap.

## Timing contract

- Both sides need their own accepted calibration or explicitly confirmed manual
  clip. A cross-lap timing candidate alone is insufficient.
- Resolve each clip's endpoints on its own real lap, then intersect their
  distance intervals. Compare crossing times at those shared boundaries.
- Cumulative delta is `(target time - target entry time) - (reference time -
  reference entry time)`. Positive means the target is slower. Two five-second
  clips can therefore have a nonzero shared-interval delta.
- The three subintervals are equal-distance thirds, not inferred braking,
  apex or exit phases. No new phase detector or causal claim is introduced.
- Existing 10m distance and 1s timestamp gap limits remain unchanged. Missing
  timestamps, nonmonotonic spans, extrapolation and missing shared coverage
  produce unavailable, not a shortened successful result. Null channel samples
  break curves; incomplete channels cannot provide a minimum metric.
- Entry/minimum/exit speed describe the common clip interval, which need not
  contain the complete corner. They do not replace full-sector/zone metrics.

## Evidence and privacy

Speed is the existing AiM GPS speed and RPM is the existing AiM channel. Values
are display-interpolated on real lap distance, not generated driving targets.
GoPro GPS remains a separate, labelled video overlay. No raw IMU body axes are
substituted for calibrated lateral/longitudinal signals.

Manual anchors and their +/-0.5 second picking uncertainty are not edited by
these charts. GPS disagreement notices remain visible and are not converted
to passes. No GPS pass, statistical significance, brake efficiency, or causal
gain is inferred from the curves. In particular, falling RPM alone does not
confirm braking. All video remains in the browser; no new endpoint or upload
is introduced.

## Verification and release

Run `pnpm run test:clip-telemetry`, the existing manual/coach review tests, and
all release checks in `DEPLOYMENT.md`. Private GH010681 / 0514 acceptance runs
locally only; do not commit the video, XRK, extracted traces or screenshots
containing private data. Check play/pause/seek, manual corrections, unavailable
channels, GPS warnings, bilingual text and desktop/mobile layout.

This frontend-only change branches from main, separately from PR #44. It uses
the current backend contract and does not require the pending dual-driver API.
Use the fixed public domain `https://ai-racing-telemetry-platform.vercel.app`
for every externally shared website link, never a protected deployment URL.
