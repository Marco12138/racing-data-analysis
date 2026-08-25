# Coaching Knowledge Policy

The coach layer uses telemetry evidence first. Driving literature supplies
terminology, review structure, and candidate hypotheses; it does not override
measured outcomes or create missing pedal, steering, or vehicle-dynamics data.

## Source status

| Source | Access used by the project | Current use |
| --- | --- | --- |
| Terence Dove, *Learn How to Master the Art of Kart Driving* | Author's official book description and the complete 18-page legally published free braking chapter | Phase-based coaching language, one-input drills, late pressure-increase detection, release-shape detection, and braking hypotheses that still require direct channels or video confirmation |
| Jim Hall and Steve Smith, *Kart Driving Techniques* | Bibliographic record and publisher/retailer description only | Topic index for line, braking, trail braking, racecraft, and mental preparation; no full-text ingestion |
| Karting Handbook, *Driving Dynamics* | Official public course outline only | Topic index for fundamentals, pedal/steering interaction, rotation, conditions, and track notes; no paid lesson ingestion |

Official references:

- https://www.evenflow.co.uk/learn-how-to-master-the-art-of-kart-driving-book/
- https://www.evenflow.co.uk/wp-content/uploads/2017/09/Braking-Chapter-Free-Master-the-Art-of-Kart-Driving.pdf
- https://openlibrary.org/books/OL8414013M/Kart_Driving_Techniques
- https://kartinghandbook.com/buy-driving-dynamics

## Rule admission gate

A literature-derived idea can enter the product only when all of the following
are true:

1. Its required signals are named explicitly.
2. The detector reports an observed pattern rather than declaring the action
   correct or incorrect.
3. The result is checked against a real completed lap and downstream outcome.
4. Missing brake, throttle, or steering channels reduce the conclusion instead
   of being replaced by an estimate.
5. A human-reviewed video label can be collected for later precision and recall
   evaluation.

The first candidate detectors remain late brake-pressure increase, brake-pressure
release shape, brake and steering overlap when both channels exist, and
within-zone repeatability. Lock-up style, stable braking, and trail braking must
not be inferred without the channels needed to separate them. No candidate may
be presented as a production coaching rule before labelled validation.

## Driver-facing language

- Name a corner or suggested zone, not a distance in metres.
- Describe phases: corner-entry preparation, deceleration and release,
  minimum-speed phase, and exit recovery.
- Change one input per drill.
- Pair every instruction with a measured result and a stop condition.
- Use a calibrated 3-5 second local video clip as the driver's location cue.
- Keep metre-based coordinates in engineering charts and internal evidence.
