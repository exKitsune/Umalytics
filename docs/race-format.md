# Race import format

Umalytics reads files locally in the browser. The schema below is an exchange format for this viewer, not the game's network protocol. The app's **Export JSON** button produces this shape. No game access, capture, TLS decryption, or proprietary envelope decryption occurs during import.

## Minimal normalized example

Save this as a `.json` file and import it. This deliberately synthetic example has one runner and two observations. Missing HP and lane data remain unknown.

```json
{
  "schemaVersion": 1,
  "title": "Synthetic format example",
  "synthetic": true,
  "distance": 2000,
  "runners": [
    { "id": "runner-1", "name": "Example runner" }
  ],
  "frames": [
    {
      "time": 0,
      "runners": [
        { "runnerId": "runner-1", "distance": 0, "speed": 18, "hp": null, "lane": null }
      ]
    },
    {
      "time": 1,
      "runners": [
        { "runnerId": "runner-1", "distance": 19, "speed": 20, "hp": null, "lane": null }
      ]
    }
  ],
  "events": []
}
```

This is a one-second observation window on a stated 2000 m course; it does not imply that the runner finished the race. `synthetic: true` remains visible after import and export.

## Race fields

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1`, optional | Version 1 is accepted. Other explicit versions are rejected. |
| `id` | string, optional | Local race identifier; file import may replace it. |
| `title` | string, optional | Display title. |
| `synthetic` | boolean, optional | Use `true` for invented or simulated examples. Defaults to `false`. |
| `distance` | number or null, optional | Official course distance in metres. Missing values may resolve from the public course reference or consistent runner positions at recorded raw finish times; final runout positions are never used. |
| `courseId` | number or null, optional | Game course identifier, when known. No course database or geometry is included. |
| `courseIdentity` | object, optional | Provenance: `source` is `recorded`, `race-instance`, `filename-race-instance`, `manual`, `skill-conditions` or `unknown`; optional `raceInstanceId` is a public race-definition ID. Skill-condition inference is labeled separately from recorded identity. |
| `distanceEvidence` | string, optional | `recorded`, `course-reference` or `finish-derived`. Distance evidence does not establish a venue. |
| `runners` | array, required | Runner definitions, described below. |
| `frames` | array, required | Ordered observations, described below. |
| `events` | array, optional | Timestamped events, described below. |
| `warnings` | string array, optional | Data quality notes. Treat these as user-supplied text. |
| `conditions` | object, optional | `weather`, `ground`, and `season` code strings or null. No enum meaning is guessed. |
| `laneDistanceMax` | number or null, optional | Explicit imported lane-width metadata when available. |
| `randomSeed` | number, optional | Recorded simulation seed; no RNG reconstruction is asserted. |
| `simDataBase64` | string, optional | Original compressed replay blob, also accepted as horseACT input. Portable **Export JSON** keeps this when the import had a scenario. |
| `raceHorse` | array, optional | horseACT-shaped start/result objects (`responseHorseData`, finish fields, attached `trained_chara_data` when the same response had it). Source horse/trained-character fields are kept, including trainer/viewer identifiers present on those objects. |
| `trainedCharaArray` | array, optional | Same-response `trained_chara_array` retained beside the per-horse attachments. |
| `raceCourseSet` | object, optional | Captured course object or `{ id, distance }` reconstructed from recorded course fields. |
| `weather`, `groundCondition`, `season`, `raceType`, `raceGrade`, `startTimeType`, `raceInstanceId`, `horseACT_version` | optional | HorseACT-compatible race-level fields retained from the source. `raceType` may be inferred from a known category. |

The viewer computes `duration` from the last frame's `time`; an input `duration` field does not override observations. Internal `source` and `sourceLabel` are assigned on import and are not required exchange fields. A top-level array of these race objects imports multiple races.

## Runner definitions

`id` is the stable identifier used by frame samples and events; IDs must be unique. Explicit IDs are recommended. If omitted, the importer assigns `runner-1`, `runner-2`, and so on. `name` is a display label; an absent name becomes `Runner N`.

Optional fields are `gate`, `charaId`, `cardId`, `trainer`, `strategy`, `finishOrder`, `finishTime`, and the extended fields below. Absent numeric or text metadata remain unknown. `finishOrder` is **one based**, from 1 through the number of runners. A frame's current position is distinct from the recorded finish result. `index` is generated from the runner definition order and need not be provided.

| Extended field | Type / unit | Meaning |
| --- | --- | --- |
| `finishTimeRaw` | number or null, seconds | Actual simulation finish time, used to align recorded finish order with replay playback. |
| `finishTime` | number or null, seconds | Separate game/display finish time; it may be scaled and need not match replay seconds. |
| `startDelay` | number or null, seconds | Recorded start delay. |
| `finishGap` | number or null, seconds | Recorded `finishDiffTime`; not a derived distance gap. |
| `lastSpurtDistance` | number or null, metres | Recorded spurt start; `-1` explicitly means no spurt. |
| `stats` | object, optional | `speed`, `stamina`, `power`, `guts`, `wisdom`, each a stat-point number or null. These are not frame speed or HP. |
| `skills` | array, optional | Owned skills as `{ "id": 123456, "level": 3 }`; unknown level stays null. At most 1,000 entries. |
| `aptitudes` | object, optional | Original G–S letters or 1–8 ranks for surface, distance and running style; missing grades stay unknown. |
| `strategyCode`, `mood` | number or null, optional | Original game style/motivation codes. |
| `gutsOrder`, `wisdomOrder`, `defeatFlags` | number or null, optional | Raw recorded result fields, retained without assigning undocumented meanings. |

New exports preserve both finish-time fields. When `finishTimeRaw` is explicitly null, the finish time is unknown. For old normalized files where the field is absent, playback retains the compatibility assumption that `finishTime` is in replay seconds; nonsynthetic imports show a warning. Old exports containing game-scaled time cannot be repaired without their original result data. The additional fields are optional and remain compatible with schema version 1.

Do not put account identifiers in `id` or personal data in names or labels when preparing a shareable file. Portable **Export JSON** replaces runner IDs and removes trainer fields, original source labels and arbitrary response fields while retaining supported event parameters, simulation seed and course provenance. The reduced `toShareableRace` projection also removes raw event parameters. Display names, event labels and event types remain and should be reviewed before sharing.

## Frames and samples

Each frame contains `time` and a `runners` array. Times are seconds, nonnegative, at most 3600, and strictly increasing. Each sample contains `runnerId` matching a defined runner and these optional numeric fields:

| Field | Unit | Interpretation |
| --- | --- | --- |
| `distance` | metres | Recorded progress along the full race. |
| `speed` | metres per second | Already normalized; do not provide the binary centimetres-per-second integer. |
| `hp` | raw simulation units | Recorded HP, not a percentage and not the trained stamina stat. |
| `lane` | dimensionless fraction | Binary lane position divided by 10,000; not a gate number or a distance in metres. |
| `temptationMode` | integer or null, optional | Recorded state enum. Zero means no rushed mode; known 1–4 values use the game's enum. |
| `blockFrontRunnerIndex` | integer or null, optional | Zero-based runner definition index; `-1` means recorded no front block. |

Omitted sample fields become `null`; do not substitute zero for missing data. A runner omitted from a frame receives an entirely unknown sample. Repeated or unknown `runnerId` values in a frame are rejected. Values must be finite, with absolute value at most 1 billion to keep plotting and interpolation numerically bounded. This generous numerical limit is not a claim about plausible game values.

Playback linearly interpolates between neighboring frames. If either endpoint of a field is unknown, its interpolated value remains unknown. Seeking outside the observed interval uses the nearest recorded frame; the viewer does not reconstruct unrecorded motion.

Discrete rushed states and block indices are held from the preceding observation and are never interpolated. A shaded interval between samples is not proof of the exact event start/end; short state changes may fall between recorded frames. If runner definitions are reordered during export, block indices must also be remapped. The app preserves definition order when replacing runner IDs.

## Events

Each event requires `time` in seconds, from 0 to 3600. Optional fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | number or string | Recorded type, or a descriptive type for normalized data. |
| `runnerId` | string or null | Defined runner ID, or null for an unassigned/race event. |
| `skillId` | number or null | Recorded skill identifier; names and definitions resolve from the bundled public reference snapshot. |
| `label` | string | Display label, or `Recorded event` if absent. |
| `params` | number array | At most 127 finite values, retained in their original order. |

Events are sorted by time on import. In the documented binary layout, `type: 3` means skill activation, parameter 0 is a zero-based simulation slot, and parameter 1 is the skill ID. The importer resolves that slot to a runner. Positive parameter 2 after time zero reports duration in 1/10,000 seconds; parameter 3 selects the reference branch, and parameter 4 is a target bitmask for the first 32 simulation slots. Missing/zero duration remains unknown. Runner-local types 4–10 preserve their recorded starts without inventing ends. Events may extend beyond the recorded frame interval; they do not extend replay duration or create observations. See [analysis evidence](race-analytics.md).

## Other supported imports

| Input | Supported content |
| --- | --- |
| horseACT JSON | `simDataBase64` with `raceHorse`, or the older C# backing-field names. Runner metadata comes from `responseHorseData` / `_responseHorseData`. |
| Decoded response JSON | `race_scenario` / `raceScenario` with optional `race_horse_data_array` / `raceHorseDataArray`; common `data` and `room_info` envelopes are handled. The `data.race_start_info.race_horse_data` metadata variant is also supported. |
| Practice replay response | `data.race_result_info` containing its own scenario and public race-instance/condition metadata. Parent runner/owner arrays are not borrowed. |
| Saved Room Match response | `data.race_scenario` beside a literal `data.race_result`; only bounded numeric race-definition/condition fields are lifted from that sibling. |
| Team Trials JSON | Paired `race_start_params_array` and `race_result_array`, matched by array index. |
| Champions Meeting history JSON | `data.race_history_info_array[].room_info.race_scenario`, including available room condition codes. Runner slots remain numbered when chart metadata is absent. |
| MessagePack file | An already-decoded response object in MessagePack serialization. This is not an encrypted wire packet. |
| HAR file | JSON or base64-encoded JSON/MessagePack response bodies. Unrelated or unsupported entries are skipped and counted in import notes. |
| Trace JSON | One record or an array of records with `direction: "RES"` and a decoded response in `data`. |
| Trace JSONL / NDJSON | `.jsonl` / `.ndjson` files with one complete trace object per nonblank line. Only `RES` records are inspected. |
| Career report JSON | Response records under `turns[].api_calls[]`, each with `direction: "RES"` and decoded response `data`. |

### Decoded trace and career report examples

This illustrates the structure, not a valid replay fixture: the base64 placeholder must be replaced with a complete supported compressed scenario. The trace `data` is the full decoded response, whose own `data` contains replay fields.

```json
{
  "direction": "RES",
  "data": {
    "data": {
      "race_scenario": "BASE64_COMPRESSED_SCENARIO",
      "race_start_info": {
        "race_horse_data": [
          { "frame_order": 1, "chara_id": 1001, "chara_name": "Runner name" }
        ]
      }
    }
  }
}
```

A career report groups these same records:

```json
{
  "turns": [
    { "api_calls": [ { "direction": "RES", "data": { "data": {} } } ] }
  ]
}
```

The empty response above contains no race. Replace it with a decoded response as in the first example. These shapes are supported for offline files; support does not execute or integrate any game's alternative client or automation software.

`REQ`, `ERR`, missing/unknown trace directions, compact events without response bodies, and unrelated response records are skipped. Request/auth branches are not traversed. Supported traversal is restricted to known response, race, and report containers; arbitrary nested objects are not searched. A malformed JSONL line rejects the entire file with its line number, so a partially written log does not silently produce a partial import. Blank lines and a UTF-8 BOM are accepted. Use the `.jsonl` or `.ndjson` extension for line-delimited files.

Only normalized race fields survive import. Trace endpoints, request IDs, timestamps, headers, authorization/session values, source viewer IDs and trained-character instance IDs are not stored in the normalized object. Public character/card IDs and available display names/stats remain. Trainer display names follow the existing policy: available internally for offline analysis, omitted by the share exporter. Do not share original trace files merely because the viewer's export is smaller.

### Champions Meeting history

The importer accepts this candidate history envelope, inferred from named field declarations in the installed client's metadata. The exact serialized nesting and whether the server populates the scenario remain unverified:

```text
data.race_history_info_array[]
  race_num
  room_info.race_scenario
  room_info.weather / ground_condition / season
  race_history_chara_result_array[]
```

Each supported scenario imports as a separate race within the same file-wide limits. Room/player IDs are discarded. A public race-instance ID resolves through the reference tables before course selection and remains as course provenance when available; a recorded simulation seed is retained separately. History character results are not assumed to identify telemetry slots. A separate chart response requested with `race_num` may contain `race_horse_data_array` without a scenario; the viewer does not automatically combine separate responses by array position, arrival order, or an unverified identifier. Such chart-only responses are skipped, and history replays with missing chart metadata show a warning and numbered slots. Explicit runner metadata accompanying a scenario still requires valid one-based `frame_order` values.

The scenario string is base64 decoded, then inflated, then parsed using the length-prefixed Global replay layout implemented in [binary.ts](../src/data/binary.ts). Speed is divided by 100, lane by 10,000, and zero-based finish order is converted to one based. Response metadata is associated through one-based `frame_order` / `frameOrder`; missing mappings are left unknown rather than guessed from array position. The binary `distanceDiffMax` field is not used as course distance.

JP/new binary layouts are not heuristically decoded. Unknown layouts, invalid record lengths, truncated payloads, and nonmonotonic frame times fail explicitly. Unread header/padding/extended-record bytes are unknown replay-record fields, not career-scenario skill inputs such as training-win counts. Spirit / Aoharu magnitudes use the current racing team's captured raw stats when team membership is present. Portable export keeps the original compressed blob so those bytes are not discarded even when they are not decoded. `race_scenario_info` is supported only as an object containing a recognized nested scenario field; no distinct byte or string layout is inferred from that name. Character names and skill names require metadata or a separately supplied database, so IDs may appear as placeholders.

Manual files are limited to 64 MB; a decompressed scenario is limited to 128 MB. Each race is limited to 64 runners, 100,000 frames, 1,000,000 runner samples, and 100,000 events. One import supports at most 100 races and 1,000,000 combined runner samples. Trace files are limited to 100,000 physical lines; envelope traversal is capped at 100,000 visits and a depth of 24, so a report containing deeply nested responses may reach the traversal cap before the line cap. Export a shorter interval if needed. The local folder bridge has its own smaller file limit documented in the capture guide.

These formats were checked against upstream source and synthetic fixtures. Successful decoding of the current installed game's traffic is a separate evidence requirement; the importer does not establish a working capture or decryption method. See [live acquisition validation](proxy-live-validation.md) and [capture guide](capture-guide.md).
