# Outer-corner reference path

Race results compare the runner's retained lane with **lane 0 on the same game
path**, over declared corner ranges. They show conditional extra metres and
equivalent seconds at observed actual speed. Neither value is a recovered
engine path-length field or a causal finish-time loss. The baseline is the
zero-lane reference curve; runner body clearance and whether its center can
physically occupy that line have not been established.

## Scale and path evidence

The retained installed IL2CPP metadata has `RaceSimulateHorseFrameData.LaneAccuracy`
= 10000 at field-default data offset 18134773. The replay decoder independently
uses raw packed lane /10000 in `src/data/binary.ts`. `RaceDefine.COURSE_WIDTH`
= 11.25 has field index 60357, declaration offset 17373428 and default data
offset 18137534. `HorseLane2DistanceCoef` is approximately 1/18 at default data
offset 18137461; `COURSE_SCALE` is 0.625 at 18137530. Full artifact identity and
the declaration-versus-native-code distinction are documented in
[course geometry](course-geometry.md#replay-lanes-and-world-width).

The supplied mechanics states one course-width unit = 11.25 m and lane0 at the
inner reference. The pinned Hachimi-Edge source `d5fd93de3f0b04d08ceeed4977141cf32d608fa9`,
`src/core/gui.rs:1681–1685`, labels `_laneDistance × 11.25` as metres; line 2353
reads that field. This corroborates a **reference interpretation**, without
proving that the replay serializer and world renderer use exactly that mapping.
We use decoded lane ×11.25 directly, without dividing by course lane maximum
or borrowing a display width. The lane maximum only rejects out-of-bounds data.

The distance-specific `CourseLaneAnim` path is selected by the existing course
binding, not by a generic lap or a similar venue. Its 1001 XYZ points use the
canonical declared race-distance parameter: point i is at
`i × courseDistance/(pointCount−1)`. The asset's coordinate direction supplies
XZ heading; no SVG projection, map scaling or arc-length renormalization enters
the formula. This provisional distance mapping, exact source assets/hashes and
the original `Distance2Time` evidence boundary are documented in
[course geometry](course-geometry.md#declared-distance-to-position-interface).
The actual native lane/world transform and any role of `COURSE_SCALE` remain
unrecovered; a uniform world-coordinate scaling would not change heading angles.

## Calculation

For a constant outward offset u on a corner turning through θ, a parallel path
has extra length `u × θ`. The implementation integrates this curvature term
piecewise with `u = decodedLane ×11.25`, interpolated between adjacent retained
samples. Right/left course direction determines the outward sign. Centered
path tangents reduce rounded-coordinate noise; signed heading changes retain
small reverse bends instead of inflating total turn with absolute jitter.
Only intersections with the course's union of corner ranges contribute, so
straight-line heading noise and double-listed corner boundaries add nothing.
Each independent model uses canonical course distance, not measured asset
arc length, for the integration parameter.

Equivalent seconds integrate each extra-length contribution divided by
interpolated recorded actual speed; the implementation uses three-point Simpson
quadrature within each geometry/sample intersection. It does not divide the
whole distance by a race-wide mean speed. Lateral lane-change length, curve
banking, body clearance, changed blocking/strategy and counterfactual racing
decisions are outside this curvature-only comparison. The modeled offset may
vary across a corner; this does not reconstruct the separate weaving component.

Complete totals require lane coverage of every declared corner and, for time,
positive speed coverage too. Adjacent observations more than 2 seconds apart,
missing/nonfinite lane or speed, invalid lane bounds, non-increasing distance,
missing game paths, conflicting course direction or missing simulation finish
withhold affected totals. Two seconds is an explicit interpolation policy, not
a game constant. Assessed portions and coverage use the full declared corner
distance as denominator; missing prefixes/suffixes cannot become zero cost.
No corners establishes zero extra corner path without requiring geometry.
The original race and portable lane values remain unchanged.

## Functional checks

`node --import tsx tests/corner-path-workflow.ts <temporary-folder>` invokes the
actual offline import/analysis CLI using a synthetic quarter-circle course.
It checks one and two horse-lane offsets, lane0, both turn directions,
straight-only exclusion, lane-bound changes without renormalization, uniform
world-coordinate scaling, straight noise, missing/zero velocity, missing lane,
large observation gaps, out-of-bounds lane, missing start/end history/path and
portable reimport. These validate the stated reference formula and coverage
rules; they do not validate the unknown native transform or causal finish loss.
