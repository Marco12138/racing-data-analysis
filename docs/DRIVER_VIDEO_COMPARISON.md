# Local Two-Driver Video Review

`/video-coach` opens the two-driver workspace. The existing single-lap experiment
remains in its own tab. No video upload, backend route, analysis-core change or
new model is introduced.
The single-lap tab also exposes the same local landmark editor/search for the
selected video range; its original motion/audio experiments remain separate.

## Workflow

1. Select each driver's local video and optionally enter display names.
2. Seek to the same fixed trackside landmark in each video. Confirm each start.
   Each excerpt is exactly `t..t+5s`, with the existing manual +/-0.5s uncertainty.
   Marks with fewer than five seconds remaining are rejected, not shortened.
3. Confirm the same track, direction and passing location, then play both.
   Playback waits for both seeks and uses real elapsed time without speed warping.
4. Run the boundary check. It reuses the telemetry workspace's two-background
   NCC search around the target start and advisory endpoint review. Thresholds
   remain 0.72 correlation, 0.06 ambiguity margin and 0.25s regional agreement.
   Suggestions only seek the player; confirming a new start is an explicit action.
5. Mark a fixed landmark in either clip, name it, and search for it in the other
   clip. Reuses the existing bounded, same-view template matcher, not semantic
   recognition or a trained cross-camera model. Sightings require human approval.
6. Name and save a comparison locally. Reselect both files after a refresh to
   restore saved marks. Up to ten comparisons are retained per ordered file pair.

## Evidence And Privacy

- Files and decoded frames stay in the browser. No comparison requests or coach
  votes are submitted. Local saved entries contain bounded names/start metadata,
  not file names, video bytes or telemetry. Landmark crops remain browser-local.
- File identity hashes the first/last 64 KiB plus file size; it is a sampled local
  identity, not a whole-file integrity guarantee. Different files cannot inherit
  marks solely by sharing a filename. Landmarks are scoped to file pair and review.
- Manual location confirmation is not telemetry synchronization. No GPS, speed,
  RPM, braking or driving-performance numbers are invented for video-only review.
- Similarity is not accuracy. Camera angle, track repetition, occlusion and line
  changes can defeat template matching. Weak results keep manual playback usable.
- Different five-second endpoint positions can reflect different speeds, not
  necessarily a bad start. Neither endpoint checking nor searching changes marks.
- No automatic cross-driver ranking, braking recommendation or precision claim.
- Changing tabs releases the video players. Save a comparison before leaving;
  saved marks return only after the matching local files are selected again.
- Server-rendered file pickers stay disabled until browser handlers are ready,
  including after refresh, so selecting a file cannot be lost before hydration.

## Verification

Run `pnpm run test:video-comparison` plus the deployment release checks.
Browser acceptance covers two local files, confirmed starts, five-second stop,
start-only suggestions, template search, save/restore, file replacement and
English/Chinese mobile layouts. Public acceptance uses only approved demo clips;
private source videos must never be uploaded.
