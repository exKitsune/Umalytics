# Replay workspace

The workspace keeps the results beside a compact course map, followed by the
race replay and telemetry. The selected runner stays in a side panel.

## Replay

The camera follows the selected runner or the field along the available course
path. Smooth rotation keeps corners readable. Distance ticks, phase changes,
course sections and elevation help locate events. Portraits use the recorded
outfit, and skill cards use the runner's color and gate number.

Playback controls include seek, pause, speed, runner focus and clip export.
Skill cards show remaining duration; instant effects get a short display time.
Recorded targeting masks identify debuff recipients. Vision guides show a
modeled field of view, not a recovered hit calculation.

## Telemetry

Speed, HP and lead gap share the time cursor. HP recovery jumps at its event
time. Elevation sits at the bottom of the graph; course sections, phases and
skill bars sit below it. Short skill bars retain a readable name prefix and
expand on hover. Selecting a skill can seek to its start.

## Evidence and formats

Observed samples remain separate from inferred modes and modeled contributions.
Unknown values stay unknown. Discrete states are held between samples rather
than interpolated as numbers. Course geometry uses extracted numeric paths
when available; a missing path falls back to a labeled schematic.

The importer accepts the supported shared replay layouts. Exports preserve
recorded facts and identify manual or inferred course choices. See
[race format](race-format.md), [analysis](race-analytics.md),
[course geometry](course-geometry.md) and [clips](replay-clips.md).

Code and data retain their [license notices](../src/data/THIRD_PARTY_LICENSE.txt).
