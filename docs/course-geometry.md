# Course geometry recovered from the installed game

Tokyo 2400 has a real sampled path in the game's downloaded assets. The relevant
asset is `race/course/10006/pos/an_pos_race10006_00_2400_00_0_0`, serialized as
`Gallop.CourseLaneAnim`. This establishes actual game coordinates for the
baseline course. It does not establish the game's complete calculation of a
runner's world position or extra distance from lane movement.

The investigation was offline. No game process was launched, attached to,
modified, or read. The asset catalog and asset bundles were decoded as files.
The installed IL2CPP metadata was parsed with bounded table readers. Native
function bodies for the relevant methods have not been recovered.

## Artifact identity and evidence boundary

The installed `global-metadata.dat` is IL2CPP version 31, 33,532,564 bytes,
SHA-256 `27b8f59d91c2be040bba33964ccb6bab37d5ae674b47dfccc32d5793f76edb5f`.
The metadata reader retains the type, field, method, parameter, and constant
records in `research/geometry/course-metadata.json`. It is supplementary offline
evidence, not REA native-function evidence.

The REA GameAssembly overview evidence is
`ev_4d88f6d78734f20730f850cbcc2468ad73bfc8bc9b1ce311da3038cf814fba5b`.
Its 27 procedures and 413 strings are limited overview coverage. That evidence
does not prove the bodies of `GetLaneTransform`, `Sample`, `Distance2Time`, or
the replay serializer. Metadata method indices and tokens below are declarations,
not recovered native addresses.

The metadata layouts follow the existing pinned
[Il2CppDumper metadata definitions](https://github.com/Perfare/Il2CppDumper/blob/4741d46ba9cd6159c5d853eb9d6fc48b4bfa2b1a/Il2CppDumper/Il2Cpp/MetadataClass.cs).
Version 31 integer defaults use compressed integer encoding; floating-point
defaults remain fixed-width. This is corroborated by Il2CppDumper's
[constant reader](https://github.com/Perfare/Il2CppDumper/blob/master/Il2CppDumper/Utils/Il2CppExecutor.cs)
and [compressed integer reader](https://github.com/Perfare/Il2CppDumper/blob/master/Il2CppDumper/Extensions/BinaryReaderExtensions.cs).
Reading enum defaults as four-byte integers produces incorrect values.

## Actual asset layout

The Tokyo asset has a retained Unity type tree. It confirms the serialized field
types independently of unresolved native IL2CPP field-type variants.

| Type / field | Serialized value or type | Metadata declaration file offset |
| --- | --- | ---: |
| `Gallop.CourseLaneAnim` | `UnityEngine.ScriptableObject`; type-definition index 9025 | 28572672 |
| `LANE_FRAME_NUM` | Constant `Single`, 1000.0 | 24024772 |
| `length` | Float; Tokyo 2400 value 33.333335876464844 | 24024784 |
| `Distance` | Integer; Tokyo value 2400 | 24024796 |
| `key` | Nested `CourseLaneAnim.Key` | 24024808 |
| `CourseLaneAnim.Key.valueX` | Float array, 1001 entries | 24024820 |
| `CourseLaneAnim.Key.valueY` | Float array, 1001 entries | 24024832 |
| `CourseLaneAnim.Key.valueZ` | Float array, 1001 entries | 24024844 |
| `CourseLaneAnim.Key.rotation` | Quaternion array, 1001 entries; each has x/y/z/w | 24024856 |

These are offsets of declarations in the metadata file. They are **not native
instance-memory offsets**. The latter require native registration/field-offset
tables and were not established by this investigation.

For the normal Tokyo 2400 variant, the first XYZ sample is approximately
`(95.264, -0.038, 193.040)` and the last is
`(-217.306, 0, 180.100)`. Its sampled XZ arc length is 2400.006 m-like units;
the 3D arc length is 2400.041. The first and last points differ because this
2400-distance race path covers more than a single circuit and starts at a
different point from the finish.

The separate round/overrun asset `an_pos_race10006_01_0000_00_0_0` declares a
distance of 2095 and has a sampled XZ arc length of 2095.046. It supplies the
closed full-circuit shape. These are measurements of game assets, not surveyed
real-world track dimensions. The normal `_0_1` race variant measures 2404.675
in XZ despite also declaring distance 2400; therefore selecting a variant by
its filename or declared distance alone is insufficient.

The compact decoded coordinates and measurements are retained in
`research/geometry/course-lane-curves.json` and `course-lane-summary.json`.
No textures, character artwork, or scene meshes are needed for this path.

## Reproducing the extraction

The read-only extractor is `scripts/extract-course-geometry.py`. Its dependencies
are pinned to `apsw-sqlite3mc==3.54.0.0` and `UnityPy==1.25.4`. Supply the asset
cache explicitly with `--cache`; `--output` defaults to `research/geometry` and
`--reference` to `public/data/courses.json`. Outputs are written separately from
the source cache. The extractor reads the catalog and bundles without modifying
the game cache, starting the game, or installing a plugin.

```powershell
python -m venv .cache/geometry-venv
.cache/geometry-venv/Scripts/python.exe -m pip install -r scripts/requirements-geometry.txt
.cache/geometry-venv/Scripts/python.exe scripts/extract-course-geometry.py --cache <installed-cache> --output research/geometry --reference public/data/courses.json
.cache/geometry-venv/Scripts/python.exe tests/geometry-system.py --cache <installed-cache>
```

The system check runs the real CLI as a child process against the installed
cache and compares its output with the bundled coordinate data, allowing only
the extraction timestamp to differ.

The retained extraction contains 171 assets: 153 NormalRace and 18 StoryRace.
All 119 courses in the reference dataset bind to recovered geometry, using 140
normal path/loop arrays. Every coordinate array has 1001 samples; the compact
public projection rounds XYZ to 0.001. Two additional Longchamp distances in
the installed master, 1000 and 1400, are outside this 119-course reference set.
Some authored loop endpoints differ by up to 0.323; those gaps are retained
rather than repaired with invented coordinates.
Seven additional unused assets have no Y samples and declare distance zero;
they remain in private research output and are excluded from public course maps.
Only 82 course bindings have a compatible full-circuit asset. Loops must match
the course's around variant, and straight courses with turn 3/4 have no oval
loop. The remaining 37 bindings intentionally omit a loop rather than borrow
an incompatible inner track or invent a closure.

`public/data/course-geometry.json` carries the compact path data and course
bindings. The desktop updater validates its schema, point bounds, and referenced
path IDs together with the complete snapshot hashes before activation.

## Declared distance-to-position interface

The metadata contains these methods and resolves their return/parameter types
where the type index corresponds to a declared by-value type.

| Declared method | Metadata method index | Metadata record offset | Token |
| --- | ---: | ---: | --- |
| `CourseLane.GetLaneTransform(float distance, position, rotation)` | 61847 | 10135448 | `0x060059e9` |
| `CourseLaneAnim.GetRotation(Key key, float frame) -> Quaternion` | 61849 | 10135520 | `0x06005a29` |
| `CourseLaneAnim.GetPosition(Key key, float frame) -> Vector3` | 61850 | 10135556 | `0x06005a49` |
| `CourseLaneAnim.Sample(position, rotation, float time)` | 61851 | 10135592 | `0x06005a69` |
| `CourseLaneAnim.Distance2Time(float distance) -> float` | 61852 | 10135628 | `0x06005a89` |

The position/rotation parameter indices are unresolved native type variants;
their names and void return support output/reference parameters but do not prove
their exact modifier from metadata alone.

`CourseLane.Init` takes `isCourseRight`, the normal lane animation, the overrun
animation, and `courseDistance`. Its fields include `_goalPos`, `_goalDir`,
`_goalRot`, `_rotationFix`, `_rotationFixRot`, `_invRotationFixRot`,
`_startPosition`, and `_startRotation`. This establishes that rotation correction
and a separate overrun path are part of the interface, without recovering their
implementation.

Three constants were read from the actual field-default table:

| Constant | Value | Default data file offset |
| --- | ---: | ---: |
| `CourseLaneAnim.LANE_FRAME_NUM` | 1000.0 | 18132525 |
| `CourseLane.GOAL_DIR_CALC_OFFSET` | 10.0 | 18132517 |
| `CourseLane.BANK_ANGLE_SAMPLING_DIST` | 10.0 | 18132521 |

The 1001 samples, 1000 frame constant, declared distance, and approximately
1000/30 animation length support a **provisional** mapping
`frame = distance / Distance * 1000`, followed by interpolation between samples.
This is a data-supported reconstruction choice. Native interpolation, clamping,
quaternion handling, `Distance2Time`, overrun selection, and correction order
remain unverified and must not be described as recovered engine behavior.

## Variant selection evidence

The resource templates are linked to named fields by metadata default records:

```text
ResourcePath.NormalLaneBasePath:
Race/Course/{0:0000}/pos/an_pos_race{1:0000}_00_{2:0000}_{3:00}_{4}_{5}

ResourcePath.OverRunLaneBasePath:
Race/Course/{0:0000}/pos/an_pos_race{1:0000}_01_0000_{2:00}_0_{3}
```

Their default data offsets are 18062979 and 18063052. The normal template also
appears as a length-indexed literal at 733373; the overrun template at 733444.
This links the strings to resource declarations rather than treating an isolated
string hit as a behavior claim.

`ResourcePath.GetLanePath` declares parameters `raceTrackId`, `distance`,
`ground: GroundType`, `around: CourseAround`, and `pathType: CoursePathType`.
An overload substitutes `raceType: RaceType` for `pathType`.
`GetRoundLanePath` takes `raceTrackId`, `ground`, and `pathType`, with a similar
race-type overload. The normal path method indices are 33615/33616, and the
round-path indices 33617/33618.

Actual enum defaults are:

| Enum | Values |
| --- | --- |
| `GroundType` | Turf=1, Dirt=2 |
| `CourseAround` | None=1, Inner=2, Outer=3, OuterToInner=4 |
| `CoursePathType` | NormalRace=0, StoryRace=1 |
| `Rotation` | Right=1, Left=2, StraightRight=3, StraightLeft=4 |

`CoursePathType.NormalRace` and `StoryRace` are at default data offsets 18137790
and 18137791. The last filename variant 0/1 is therefore strongly supported as
normal/story selection, rather than left/right, turf/dirt, or an extra rail.
Exact formatter argument transformations, including the apparent zero-based
ground/around filename numbers, have not been recovered from native code.
The master course table's `Ground`, `Inout`, and `Turn` fields are separate
declarations and must not be conflated.

## Replay lanes and world width

`Gallop.RaceSimulateHorseFrameData` declares `LanePosition`, `Distance`, `Speed`,
and related frame values. Its `LaneAccuracy` constant is 10000.0 at default
data offset 18134773; `SpeedAccuracy` is 100.0 at 18134769. This independently
corroborates decoding the packed lane value as `raw / 10000` and speed as
`raw / 100`. It does not prove that the decoded lane is a fraction of the full
available track width.

The installed metadata also contains:

| `RaceDefine` constant | Value | Default data offset |
| --- | ---: | ---: |
| `COURSE_WIDTH` | 11.25 | 18137534 |
| `COURSE_SCALE` | 0.625 | 18137530 |
| `HorseDistance2LaneCoef` | 18 | 18137457 |
| `HorseLane2DistanceCoef` | approximately 1/18 | 18137461 |

`HorseRaceInfo` distinguishes `_laneDistance`, `_distance`, `_laneOriginPosition`,
`_lanePosition`, `_position`, and `_rotationOnLane`. The metadata identifies
`GetLaneDistance`, `SetLaneDistance(float lanePosition)`, and `GetLanePosition`
but does not recover their bodies or the replay `Record`/`Serialize` mapping.

The retained Hachimi-Edge source at revision
`d5fd93de3f0b04d08ceeed4977141cf32d608fa9` reads `_laneDistance` as a float and
displays `_laneDistance * 11.25` as metres in its HUD. That implementation
matches `COURSE_WIDTH`, but the role of `COURSE_SCALE` in rendered world units
is not proved by the HUD label.

The retained replay reference source at revision
`8832b26818d18f13a041b868d89870f4fa6de6cc`, in
`useWorldTransformEstimate.ts`, instead clamps a raw lane position to 0..9999
and scales it by an estimated available width. Its width is either supplied
lane metadata, course `laneMax / 1000`, or the 11.25 fallback. The hook explicitly
calls its result an estimate. Its denominator and width normalization must not
be treated as proof of the game's serializer or renderer.

An honest viewer can draw the recovered baseline and label runner offsets as
estimated while retaining the original decoded lane values. It must not present
derived extra-distance totals as engine-verified. Establishing those totals
requires the replay-to-lane/world conversion, baseline semantics, scaling,
interpolation, and lane-change movement model, or equivalent independently
validated evidence.
