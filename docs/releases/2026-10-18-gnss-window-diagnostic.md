# Failed GNSS window diagnosis

- Add bounded common-sample speed traces, before/after local-shift residuals,
  position disagreement, sample spacing and camera clock span to failed checks.
- Explain in Chinese and English that a matching offset discrepancy is not a
  measured video delay. Keep the failed window, original thresholds, selected
  offset, manual-anchor policy and weak status unchanged.
- Add private original-packet audit tooling and reproduction instructions in
  `docs/GNSS_WINDOW_AUDIT.md`. No private media or GPS audit results are committed.
- Fresh original-file audit reproduces the failure without the browser boxcar.
  Removing only the additive diagnostic fields gives exact equality with the
  previous production algorithm's real-file result.
- Local browser acceptance uses real private files with public requests blocked:
  three speed curves, bilingual/mobile layout, no page errors and unchanged
  manually entered offset. This is not new human synchronization ground truth.
- Checks: backend 274 passed (private XRK configured), frontend 143,
  GNSS 22, RPM 27, coach debrief 12, proxy 6, rendered HTML 11; lint,
  Sites build, Vercel build and proxy dry-run build passed.
- Local `docker compose config` could not run because Docker is not installed.
  Railway container build/health must be checked during publication.
