# Names, courses and simulator transfer

Umalytics resolves IDs with offline reference files. `metadata.json` was generated
from the explicitly selected installed Global master SQLite, opened with
`mode=ro&immutable=1`: 107 character names, 139 outfit labels, 1,122 skill names
and 734 skill definition records. `scripts/extract-reference-metadata.py` selects
only public master tables, never saves, account rows or intercepted responses.
The source SHA-256 and modification timestamp travel with the data. Unknown IDs
remain visible as IDs. Inherited unique names are explicitly labeled inherited.

The October 15 refresh includes both Free from the Ashes definitions (`110161`
and inherited `910161`) from the updated Global master. Both unique branches
retain their own conditions and speed values; the replay's branch index picks
the applicable effect. The master SHA-256 is
`4ff8f53b4446adc922f74dadd14a238ac6fef430425be40776da8331f5ecae6c`.

Missing entries use the public [GameTora catalog](https://gametora.com/%75%6D%61%6D%75%73%75%6D%65/skills).
The priority is installed Global, GameTora's Global variant, then JP. Whole skill
definitions are selected together; JP branches never patch an existing Global
skill. Localized objects patch the catalog's base object, including nested
inherited definitions, while branch arrays replace the base arrays. Missing
group IDs stay absent. Unrecognized condition/effect codes remain unsupported.
JP skill details show **JP fallback**; this is reference coverage, not a claim
that every later JP mechanic is implemented for Global.

`scripts/fetch-gametora-fallback.py` fetches only the public manifest and three
JSON catalogs (skills, characters, character cards). It keeps the missing names,
outfits and skill definitions inside `metadata.json`, along with immutable source
URLs and hashes. The current fallback adds 276 Global and 1,187 JP definitions,
66 character names and 134 outfit names. It does not replace a runner's recorded
stats, outfit, skills or activation events. No extra runtime download is needed.
Run it after extracting a new Global master, then regenerate the reference
manifest with `python desktop/generate_manifest.py`. `--catalog-dir` supports
reproducible offline refreshes and functional tests.

The snapshot also includes public skill descriptions, icon IDs, activation-lottery
flags, preconditions and target/scaling fields, plus 1,817 public race-instance
mappings. A compact import lookup maps race-instance definitions to course IDs.
These are game definitions, not player, account or saved-race identifiers.

The 119 courses use the pinned [Moomoolator source snapshot](https://github.com/TheCing/uma-tools/tree/5ce95905fef753a33f7519b5559a86e92f5d56cc).
`scripts/fetch-reference-data.mjs` downloads only course JSON, a skill-ID projection
and the upstream license. It never executes upstream code. `reference-source.json`
records the revision, URLs and SHA-256 hashes. The GPL-3.0-or-later course-data
license and contributor attribution are shipped in `public/data`; game materials
retain their original copyrights. The course-data notice covers that dataset, separately from the
130 generic character portraits documented in [portrait provenance](portrait-provenance.md).
This intentionally supersedes the older
course-data non-inclusion note in `docs/visualization-reference.md` for this new
feature: it does not claim that the GPL notice grants rights to third-party art.

The old Kachi snapshot `4401e259...` and the current Moomoolator snapshot disagree:
Tokyo turf 2,400 m course `10606` begins its final straight at 1,900 m in the old
snapshot and 1,875 m in this dataset. This implementation consistently uses the
current pinned snapshot and exposes that provenance. It does not blend revisions.
Local SQLite supplies base course attributes; the installed cache supplies the
serialized event ranges. Independent offline extraction now matches all 119
bundled course definitions, including every corner, straight and slope, as
described below. [GameTora's Tokyo page](https://gametora.com/%75%6D%61%6D%75%73%75%6D%65/racetracks/tokyo)
was independently inspected in the live UI on October 14, 2026. Its Global turf
2,400 m course `10606` agrees with this snapshot on all four corner ranges, three
straight ranges and four slope ranges/grades. In particular, the final straight
starts at 1,875 m. This is a bounded spot check, not validation of all 119 courses.
No GameTora bulk data or images were copied into the runtime dataset.

## Geometry and graph overlays

The map now uses serialized `CourseLaneAnim` coordinates from the installed
Steam Global cache. The dataset binds all 119 reference courses to their own
normal-race paths, preserving 1,001 XYZ samples per path. It covers the fourteen
Global venues and one additional cached Longchamp course; cached files do not
prove that a course is currently playable. Each route keeps its asset name,
catalog hash and source-file SHA-256.

The SVG uses a uniform scale on both axes. Distance selects a point along the
race-specific path; it never wraps distance around a generic lap. A separate
lap is shown only when the variant matches. Missing geometry falls back to a
clearly labeled schematic. Start and finish come from the route endpoints.
Inner/outer course labels follow the extracted game enum.

[The extraction notes](course-geometry.md) explain the format, source identity,
method and remaining uncertainty. [Fourteen-venue validation](global-geometry-validation.md)
compares one selected route per Global venue with GameTora; [Tokyo 2,400 m](tokyo-geometry-validation.md)
has a detailed independent check. These are visual cross-checks, not calibration
of game units against screenshot pixels.

Lane spacing on the map is still a display estimate. The separate Corner loss
result uses a declared reference conversion of decoded lane × 11.25 m and game
path heading changes; it never uses map width or pixel spacing. The metadata
confirms `LaneAccuracy = 10000` and `COURSE_WIDTH = 11.25`, with corroborating
mechanics/HUD interpretations, but the complete replay-to-world transform has
not been recovered. These are conditional reference-path extra metres and
equivalent seconds, not measured outer-lane loss or exact finish-time cost.
[Corner path evidence and limits](corner-path.md) give the method and locators.
Mesh height also differs from the simulation slope table, so graph elevation
continues to use the latter.

Slopes convert the reference integer grade using `slope / 10000` percent.
`elevationProfile` integrates that grade from a zero-metre starting datum. The
output is derived relative elevation, not measured altitude. Phase references
are 1/6, 2/3 and 5/6 of course distance; the final sixth is not a claim about a
runner's separately recorded spurt start. Skill records retain raw duration,
condition branches and effect fields. Supported replay events can report the
branch and actual timed duration, separately from reference base times. Missing
duration and unresolved conditional/level scaling remain unknown; reference
effects do not prove measured skill efficacy. [Race analysis](race-analytics.md)
documents the evidence labels and modeled status formulas.

## Moomoolator import

The native JSON exporter targets Moomoolator's pinned Global v2
[validator](https://github.com/TheCing/uma-tools/blob/5ce95905fef753a33f7519b5559a86e92f5d56cc/umalator-global/v2/storage.ts)
and [game field mapper](https://github.com/TheCing/uma-tools/blob/5ce95905fef753a33f7519b5559a86e92f5d56cc/components/gameExportParser.ts).
Ranks 1–8 map to G–S; game motivation 1–5 maps to -2–2. The exported distance and
surface grades are selected for the known recorded course, and strategy grade
for the recorded running style. This does not choose an unrelated highest grade.
All five stats, card ID, stars, owned skills and the outfit unique's recorded
level must be available. Missing inputs produce an explicit missing-field list
and no simulator payload. Stats outside 1–2,000 also block native export because
the target would silently clamp them. Unknown owned skills stay in the output,
with a warning that the target's Global import filters them. No forced skill
positions are derived from the replay.

Use Moomoolator's native **Paste from clipboard** or **Import JSON** action to
load the native Uma JSON. Configure course and race conditions separately: the
format imports a build, not a replay. A portable `umatrace-uma` JSON also retains
all known aptitude grades and individual skill levels, along with explicit nulls
for missing build groups. It excludes trainer/account identity. The portable
format is for lossless transfer/archive; use the native exporter for the simulator.

The live Moomoolator **Paste from clipboard** action was tested on October 14,
2026 with a synthetic Special Week build, not the user's race. The resulting UI
showed the exact five stats (1,100 / 950 / 800 / 400 / 500), A/S/A grades, Great
mood, Pace Chaser, Shooting Star at level 4 and Wet Conditions ○. Proof is saved
at `artifacts/umalator-synthetic-import.png`; no private capture was submitted.

System checks exercise file import and transfer. The manifest check validates
the bundled data sizes and hashes.

## Offline regeneration from installed game files

`scripts/extract-game-reference.py` generates reference JSON from explicitly
selected installed files without running the game or contacting a server. This
is a command-line workflow; automatic extraction inside the viewer is not
implemented. Its default output is `research/generated-reference`, and custom
outputs also keep their compact course lookup beside the generated metadata.
They do not silently replace `src/data/course-identities.json` or bundled data.

The source master SHA-256 checked on 2026-10-14 is
`a866b847996fd773c918a7b5192bbac3874d56fc84b3a44a6f4912e92b9ef426`.
The extraction selects these definitions:

| Source | Generated content |
| --- | --- |
| `text_data` categories 6, 5, 35, 47, 48 | Character, outfit, venue and skill names; skill descriptions. These are the installed Global English texts, not a new translation. |
| `skill_data` | 734 definitions with up to two branches and three effects each; raw conditions, preconditions, duration, cooldown, lottery, target and scaling fields. |
| `race_instance JOIN race` | 1,817 public instance-to-course mappings. |
| `race_course_set`, `race_course_set_status` | Distance, surface, turn, inner/outer variant, lane maximum, finish-time bounds and threshold stats. |
| Cached `CourseParamTable.courseParams` | Type 0 corner start/length, type 2 paired straight boundaries/front type, type 11 slope start/length/grade. |

Course assets are selected by the exact catalog name
`race/courseeventparam/<courseId>/pfb_prm_race<courseId>`. Catalog and bundle
transforms reuse the documented geometry extractor. The cache has 122 course
event entries; the selected master has 121 courses. The production set remains
119: incomplete Longchamp 1000 (`11201`) and missing Longchamp 1400 (`11202`)
are explicitly excluded. Extra cached definitions do not establish playability.

The direct extraction matches the shipped metadata and identity files byte for
byte, and all 119 course objects structurally across the ten base/status fields
and every corner, straight and slope. Serialized `_distance` values are rounded
to two decimals. Only two courses need this normalization: `10301` straight 0
end, `649.9000244140625 → 649.9`; and `11102` straight 1 end,
`1100.22998046875 → 1100.23`. Event ranges beyond the finish remain intact.

The source pipeline was cross-checked against the cached Kachi course generator
at `4401e25987d9c78707f2d3f8a9dcd02c1c56529c`, distinct from the pinned
Moomoolator revision above. Its simulator skill transformations are not applied:
the generated file preserves game coefficients. `skill_level_value` coefficients
and conditional effect usages still require runtime interpretation. Reference
generation does not create observed race frames or a simulator compatibility
list; the pinned simulator skill-ID projection remains separate.

Observed race JSON is generated separately by Umalytics' sanitizer and replay
decoder from an available game response's `race_scenario` plus co-located
allowlisted context. The app can generate this normalized JSON itself from a
supported response, or export an imported replay. Master and asset definitions
alone cannot regenerate an actual race, its RNG outcomes or missing context.
See [race import](race-format.md) and [capture projection](collection-format.md).

Create a separate extraction environment, then explicitly select both inputs:

```powershell
python -m venv .cache/reference-venv
.\.cache\reference-venv\Scripts\python.exe -m pip install apsw-sqlite3mc==3.54.0.0 UnityPy==1.25.4
.\.cache\reference-venv\Scripts\python.exe scripts/extract-game-reference.py --master C:/path/to/GameData/master/master.mdb --cache C:/path/to/GameData --output research/generated-reference
.\.cache\reference-venv\Scripts\python.exe scripts/extract-portraits.py --cache C:/path/to/GameData --output research/generated-portraits
node --import tsx scripts/analyze-race.ts C:/path/to/race.json research/analysis.json --reference-dir research/generated-reference
```

Outputs are `metadata.json`, `course-identities.json`, `courses.json`,
`reference-source.json` and `course-event-source.json`. They contain selected
definitions and source hashes, not source databases, bundles or account data.
Output inside either source directory is rejected. Already decoded event JSON
can be supplied with `--course-events <directory>` instead of `--cache`; this
path needs only standard-library Python and is exercised in CI with synthetic
SQLite and event fixtures. The whole-process check repeats extraction, compares
all output bytes, checks privacy sentinels and consumes the result in the real
analysis command. [Geometry extraction](course-geometry.md) and
[portrait extraction](portrait-provenance.md) use the same explicit cache and separate
output policy.

The installed cache generated 107 portraits with no missing or unsupported
selected assets. Of 93 with an upstream counterpart, 42 matched all RGBA pixels
and 51 differed; direct extraction therefore does not claim byte or pixel parity
with all 130 shipped upstream portraits. The portrait notes preserve this
version/decoder distinction and the reproducible pixel check.
