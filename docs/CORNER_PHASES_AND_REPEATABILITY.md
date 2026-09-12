# GPS Corner Phases And Repeatability

## Incremental Scope

`corner_dynamics.py` consumes existing GPS curvature, speed, time and eligible
real laps. Existing quality gates, Top 3 consensus and reference selection are
unchanged. The response adds `corner_dynamics`; Sector / Zones shows the new
results. No IMU calibration, learned model or A/B causal analysis is introduced.

## Kinematic Labels

The five candidate points are deceleration onset, curvature build-up, minimum
speed, acceleration onset and corner exit. They do NOT confirm brake application,
steering input or throttle. A five-sample median, time-based speed derivative,
adaptive thresholds and sustained runs are used in a +/-30m context around each
existing zone. Missing phases stay null; missing/gapped/nonmonotonic inputs cause
an unavailable result. Phase confidence remains low until human labels exist.
The minimum-speed event is localized using smoothed speed; its displayed value
is the actual sample. The zone's minimum-speed metric uses observed raw speed.

Coverage reports attempted lap-zone pairs, calculable pairs and complete
five-phase pairs separately. Session coverage is NOT event accuracy; 20/20 must
never be manufactured by filling missing phases or bypassing quality gates.

## Statistical Meaning

Use one corner metric per quality-eligible lap, ordered by lap, not thousands of
telemetry samples as independent replicates. With at least five laps, report
mean, sample standard deviation and an exploratory 95% CI for the mean via
moving-block bootstrap (block length 2, 1000 replicates, fixed seed 0).
Selection, serial drift and driver variation limit this interval; it is not a
causal effect CI or a confidence interval for a single target-reference pair.

An empirical 95th percentile of absolute between-lap differences is reported
separately. Being outside that band is descriptive, not a significance test.
Reference and target may contribute to that band; it is not independent validation.
Fewer than five laps yield no interval. An ineligible target has no new comparison.

Driver variability cannot identify sensor noise without additional assumptions
or independent calibration. `distinguishable_from_sensor_noise` is therefore
null, not true/false. No universal 0.35 km/h floor is applied. Before enabling a
noise decision, record the source, units, speed range and whether a supplied
bound is per reading, per difference, a standard deviation or a confidence bound.

## Local Verification

```bash
python -m pytest backend/tests/test_corner_dynamics.py -q
pnpm run test:corner-dynamics
python scripts/audit_xrk_channels.py --data-dir /private/session-directory --xrk-only --output tmp/corner-audit
```

Keep private reports outside Git. Run all DEPLOYMENT.md release checks before
publishing. Manual S7 video alignment is still a human task: verify early and
late anchors, use an independent middle anchor, record residuals and reviewer.
An audio correlation candidate alone is not confirmed synchronization.

## Session Record

Copy one record per session; unknown fields stay blank rather than zero.

| Field | Value / convention |
|---|---|
| Session ID / date / driver / vehicle / track | |
| XRK fingerprint / source | |
| Tire make / compound / set ID | |
| Tire prior laps / session laps | |
| Cold pressure FL / FR / RL / RR | kPa; record before running |
| Hot pressure FL / FR / RL / RR | kPa; record delay after stopping |
| Pressure gauge ID | |
| Front / rear track width | mm; state measurement convention |
| Caster / camber / toe | units and measurement convention |
| Axle / hubs / ride height / seat supports | |
| Primary change / other changes | |
| Air temperature / track temperature | Celsius, measured or estimated |
| Weather / wind / wetness / grip notes | |
| Fuel / tire warm-up procedure / traffic | |
| Driver feedback | |
| Recorder / video / synchronization reviewer | |

Future A/B experiments need same day, tire set and driver, one primary change,
at least five eligible laps per side, explicit confounders and effect intervals.
This table does not itself make the experiment controlled or causal.
