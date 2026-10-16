# Race collection and portable JSON

The observer inspects POST responses under the game API prefix only on the exact official API TLS SNI and HTTP authority the exact game API host, using verified upstream TLS. Every race category is enabled by default. Non-race API responses produce only a diagnostic counter; no response, authentication headers, session material, trainer/account IDs, or device identifiers are saved.

Collection settings are a small JSON document passed through the mitmproxy option `uma_settings=<absolute path>`. The observer rereads this file for each response export, so changes do not require restarting capture:

```json
{
  "schemaVersion": 1,
  "collectionEnabled": true,
  "categories": {
    "career": true,
    "team-trials": true,
    "practice": true,
    "champions-meeting": true,
    "other": true
  }
}
```

Only the JSON boolean `false` disables collection or a category. Missing, unreadable, malformed, oversized (over 16 KiB), or unfamiliar settings fields preserve enabled defaults. `practice` covers practice and room-match endpoints. Unknown future endpoints and unknown numeric race-type codes remain `other`; they are retained when that category is enabled. Textual type names and the known Team Trial parallel arrays can supply a category when the endpoint does not.

Each extracted race is written as its own atomic JSON file, including each Team Trial in a multi-race response. Existing array files remain importable. Each saved race contains an explicit `race_scenario` string, safe course/distance/condition fields, and runner metadata actually returned with that race. Character/card IDs, stats, skill IDs and levels, aptitude rank codes, motivation, running style, rarity, race wins and fan count are retained where present. Missing metadata remains absent. `race_course_set` can be an object or a numeric course ID. Capture time is recorded in UTC. Provenance contains finite category names and `endpoint`, `content`, or `unknown`; raw endpoint paths and query strings are discarded before the export worker receives the response.

Public `race_instance_id` is retained where returned; it is a game race-definition ID, not an account or saved-room identifier. The declared saved Room Match response has `race_result` beside `race_scenario`. Only finite allowlisted numeric race fields are lifted from that literal sibling object, with a 1,000-key bound. Saved-room/player IDs, text, foreign runner arrays and unrelated sibling race arrays are excluded. [Course-context evidence](race-analytics.md#where-the-game-declares-course-context) documents the installed metadata declarations and their limits.

Object/array traversal is bounded by 16 nesting levels, 10,000 visited values, 100 races, 1,000 entries per array, 64 runners and 1,000 skills per runner. Scenario strings and HTTP bodies are bounded to 16 MiB, and the envelope codec has its own tighter limits. Histories and other race arrays do not inherit runner metadata from siblings or parents. Known Team Trial `race_start_params_array` and `race_result_array` entries pair by index only with equal counts. Separate responses, Champions charts and histories are never joined automatically.

`toPortableRace` and `toPortableRaces` in `src/data/share.ts` create version 1 normalized JSON documents. Portable exports preserve supported telemetry, event parameters, title, warnings, course/conditions, capture provenance, character metadata, stats, skills and aptitudes. They remap simulation runner IDs and omit trainer/account fields and unknown source objects. The importer restores these documents offline. `toShareableRace` remains a separate reduced sharing format that also clears arbitrary event parameters and uses a generic title.

Validation uses system checks for the HTTP bridge, offline import CLI and packaged app. The previously captured live Room Match validates that acquisition path. Career, Team Trials, practice variants and Champions Meeting still need genuine responses from the installed game build before claiming live coverage.
