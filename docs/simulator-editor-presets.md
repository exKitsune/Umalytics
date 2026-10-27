# Simulator editor reference notes

Reviewed 2026-10-26.

## Catalog refresh and simulator support

The service checks GameTora's revision manifest at startup when stale and every
24 hours after success, including while the application is in the tray. Failed
checks retry hourly. An unchanged manifest does not download the catalogs again.
Characters, outfit release dates, supports and skills share one validated,
atomically saved snapshot under the service's `cache/catalog` directory. Offline
use retains the last good snapshot or the bundled data. The interface checks for
a newer local snapshot every minute; release eligibility also advances by date.
GameTora's explicit Global outfit release dates determine the released filter;
JP text is retained when an English translation is absent.

GameTora definitions now feed a separate, validated simulator overlay. The
frozen table retains priority; new definitions must pass the v74 condition,
operator, targeting, effect and scaling contract. All branches must pass: an
unknown mechanic rejects the entire skill with a reason. Global patches take
priority over JP, which remains available for supported unreleased skills.
The nine previously missing Global definitions are also bundled for offline use.
Their twelve activation branches were exercised in eligible turf and dirt races.

Overlays are content-addressed under `engine-skill-catalogs` and bound to the
installed binary, base data and reviewed source revision. New captures and custom
jobs use the latest supported overlay. Saved jobs, resumed batches and follow-up
win-impact samples retain their original definitions. Dashboard calculations
receive a matching immutable reference; historical inference retains its separate
compatibility rules. The picker refreshes its engine capabilities when the local
catalog changes. This imports data, not new engine code or unsupported mechanics.
`simulator-skill-support.json` records the inventory and validation evidence.

Skill search returns every match. The interface initially renders 120 results
and appends more as the list is scrolled, with an explicit Show more fallback.
Workspace URLs retain captured race IDs, simulation job/run IDs and the current
setup/results view. Browser Back/Forward and reload restore the saved result;
the simulation sidebar links directly to its results and editable setup.

## Batch results and win-impact performance

Overview, Averaged race statistics and Individual races are separate, prominent
result views. The detailed averages retain each metric's units, assessed sample
count, median and 10th–90th percentiles. Individual race cards load in pages of
48 instead of mounting hundreds of hidden replay buttons.

`WR when activated` divides wins in races where the equipped skill activated by
the number of races where it activated. Each race counts once, even for repeat
activations. Never-activated skills show an unavailable rate. Missing skill
samples are excluded; this statistic is descriptive, separate from causal win
impact, and calculated directly from saved normal-batch summaries.

An isolated skill/stat win-impact job runs both the original and changed builds
with `retainAllFrames`, `decisionTrace` and `traceConservePower` disabled. Neither
side invokes the JavaScript analysis worker or computes skill gains. Up to four
independent persistent engine workers run concurrently (bounded by CPU count),
using the existing paired seed/gate/mood schedules. Completed results are saved
by stable run index. Cancellation stops dispatch and retains the already-running
races. Normal race batches still calculate their full summary statistics; opening
an individual replay regenerates its trace and verifies the saved finish results.

On the development machine, the nine-runner Chukyo 1200 m fixture (2026-10-26)
took 4.845 s for six old-path comparison runs versus 0.284 s for the same six
outcome-only runs, with exact finishing-order/time equality. Two 200-race parallel
batches took 3.921 s and 4.142 s, including SQLite persistence, and produced the
same outcomes under different scheduling. These are local measurements, not
speed guarantees for other fields or hardware. Python regression tests ensure
both comparison sides bypass analysis, enforce concurrency bounds, and retain
in-flight results on cancellation.

## Seeds

The installed engine accepts signed 32-bit seeds. Its RetailRandom initialization
uses signed magnitude, so positive/negative pairs can produce the same random
stream. The 34 explicit seed fields found in the local capture/QA corpus were all
positive (116204324–2033993225); this does not establish that the game never emits
negative seeds. New editor seeds are positive; imported signed seeds remain valid.

## Popularity

GlobalSim receives popularity as an input; it does not calculate the game's ranking.
[t-snow's original investigation](https://note.com/t_snow/n/n1ebe8a1446e1)
describes three relative-stat scores and skill corrections, but labels its final
popularity transform an estimate. We do not present a guessed rating sort as the
game's formula. The editor swaps conflicting ranks, preserves relative order when
removing a runner, and the service rejects duplicate popularity ranks.

## Event presets

`src/sandbox/event-presets.json` covers all 64 competition cards currently exposed
by [uma.moe's Global timeline](https://uma.moe/timeline): **49 CMs and 15 LoHs**,
from 2025-08-17 through 2029-04-01. Each category is numbered chronologically,
including unavailable courses. Future Global dates remain timeline estimates;
`predicted` preserves this provenance internally, without adding that word to the
picker. The displayed dates include the day. Source event IDs are retained.

The first 30 CM cards supply English course conditions directly. The remaining
19 CMs and all 15 LoHs use the Japanese announcements linked by the timeline's
banners. `scripts/data/competition-event-sources.json` retains the complete card
export plus only the announcement's factual target-race line. Every normalized
field has a source URL in `fieldSources`. The timeline's ground labels
Firm/Good/Soft/Heavy map to engine values 1/2/3/4; Japanese
良/稍重/重/不良 map to the same values. Inner and outer layouts are resolved
separately against `public/data/courses.json`.

The [first LoH announcement](https://umapyoi.net/news/1334?lang=jp) explicitly says
weather and ground vary. **昼 means daytime, not sunny weather.** All 15 LoH
presets therefore leave weather and ground unchanged when applied. The supplied
time is applied: normally daytime, evening for LoH 5 and night for LoH 11.
The first 30 CM timeline cards omit time, so it remains null instead of guessed.
CMs 44 and 45 specify Del Mar courses absent from the installed course catalog;
their conditions are retained and their picker entries are disabled. Missing or
ambiguous future course facts likewise remain null rather than silently vanishing.
Presets set race conditions; they do not implement LoH NPCs, items or scoring.

`scripts/fetch-event-presets.py` reproducibly builds the snapshot from the reviewed
facts. Both uma.moe and umapyoi returned HTTP 403 to ordinary automated requests
during this review, so this is not advertised as an unattended network refresh.
For a refresh, use the normal browser timeline with only CM and LoH enabled,
visit the entire date range, and export every rendered event card (deduplicate by
`data-event-id`) using the existing source JSON's fields. The filtered total must
equal the export count. Review missing conditions in the linked announcements'
`対象レース` section; use the Japanese text, not the machine translation. Then run:

```powershell
python scripts/fetch-event-presets.py --timeline .cache/event-timeline-full.json --announcements .cache/event-announcement-facts.json --checked-at YYYY-MM-DD --write-source
python tests/event-presets-workflow.py
node --import tsx tests/sandbox-workflow.ts
```

The importer rejects a partial export that would drop known source IDs, requires
an explicit review date for new source evidence, and retains new unknown events.
`--allow-removals` is reserved for verified upstream removal. Running it without
import arguments regenerates the bundled JSON without falsely advancing its
review date. Review the generated diff and update these coverage counts after a
refresh; do not present projected Global dates as official announcements.

LoH has a collection setting and library/import/export category. The finite
`heroes` / `league_of_heroes` route aliases are prepared for future responses.
Synthetic tests cover classification; real Global responses still need validation
after launch. This does not add LoH to the simulator's verified capture modes.

## Editor invariants

Explicit GameTora skill-owner mappings select the native unique for each outfit.
The editor puts it first, retains its level, protects it from removal, and excludes
foreign native uniques from search/templates. The upgraded native version is the
default for low-rarity outfits; an imported valid original version is preserved.
Inherited skills have level 1 and omit the inherited suffix in this editor.
Counterfactual measurement inputs may still remove the unique intentionally.

The equipped inventory sits in a dark panel below the five stats and expands
within the left column before scrolling. The right column is reserved for the
skill filters and catalog; wide, short windows retain both columns. Narrow
windows stack them. Moving the inventory does not change save, unique-lock,
search-focus or skill-removal behavior.

No team is stored as null. At execution each solo runner receives an unused team
ID; shared color teams retain equality. Save As resolves names case-insensitively,
requires a second explicit confirmation before replacing an existing record, and
assigns a fresh ID when saving under a new name.

## Status statistics and stat sensitivity

Saved batch summaries are normalized on read: uphill and pace-down contributions
are displayed as negative losses; the separate downhill ceiling-area estimate is
omitted in favor of the realized downhill-mode contribution. Rushed duration and
gain remain distinct measurements. Status occurrence counts use the presence of
an observed mode window, not whether its measured contribution is nonzero.
Explicitly unavailable contributions and outcome-only runs do not become zeros.
Duration averages include nonoccurrences; the rushed row also reports duration
conditional on occurrence.

Stat sensitivity starts at −200 to +200, uses 50-point steps and adds 100 fresh matched pairs per measured
value, independently of the skill-measurement sample control. Existing 25-point
measurements remain visible and individually refinable; new range batches use
the 50-point grid. Expanded ranges process up to nine
adjustments and one shared baseline per batch, prioritizing missing or least
sampled values to stay within the 1,000-race limit. The optional trend is a
sample-count-weighted least-squares fit anchored at zero adjustment/zero change:
linear for two or three distinct measured values, quadratic for four or more.
It is drawn only across the measured range and is descriptive, not a confidence
bound. The original estimates and per-point uncertainty bars always remain.

## Comparisons and uncertainty

Conditional activation WR is compared with the runner's overall WR by first
comparing the disjoint activated and inactive groups. A Newcombe Wilson-score
difference interval is scaled by the inactive share, since the overall group
contains the activated group. Text stays neutral when its 95% interval includes
zero, fading to full color when the 99% interval also excludes zero. This is an
association, not skill causation, and does not correct for scanning many skills.
Incomplete skill coverage withholds confidence coloring. Wilson background:
https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm

Paired skill impact additionally reports a Student-t interval for mean time
saved, computed from each complete pair's finishing-time difference, not from
independent per-build timing averages. Single pairs have no interval. This is
approximate sampling uncertainty, not engine accuracy or a guarantee under
repeated optional stopping. Movement gain remains the fixed-race effect estimate;
paired timing includes downstream race changes. They answer different questions.

Lobby markers pool individual runner-race observations. An unobserved status in
a fully analyzed run is zero; missing analysis stays unknown. These are the mean
and median of the pool, never an average of runner medians. Normalized signed
losses are used consistently in distributions and their markers.

The raw-stat comparator is an isolated Web Worker course model. Its formulas are
checked against GlobalSim's race_solver.rs, hp_policy.rs, and retail_spurt.rs.
Each profile retains its own strategy and mood. Randomized batches use the observed
mood distribution. For each stat, the runner's own result is compared with that
same runner using the other runner's value: own speed minus substituted speed,
and substituted finishing time minus own finishing time. Two tables show these
contributions independently; they do not compare the runners' actual speeds.
Raw stats, the 1200 soft cap, ground,
course stat thresholds and each profile's surface/distance/style grades feed
acceleration, HP, target speed, exhaustion and the spurt candidate search.
One-at-a-time substitutions report isolated contributions; the interaction
residual reconciles these with replacing the full profile.

It integrates at 0.1 seconds, stopping at phase, hill and spurt boundaries.
Downhill probability mass splits at one-second checks and keeps separate speed
states, merged into 0.025 m/s buckets with mass-weighted speed preservation.
Momentum persists after hill exit. Its shadow speed path excludes the direct
downhill boost to report speed gain/carryover without counting HP savings twice.
The mean position/HP path and mean section pacing approximate branching outcomes;
spurt candidate probabilities are averaged analytically. This is deliberately
not a bit-exact simulator or a win-rate estimate. Skill effects, traffic, lanes,
position keep, rushed, conserve/release power and scenario bonuses are
excluded. Distance equivalent is time saved times that runner's own finish speed,
not a separately simulated finish margin. The UI labels this estimate and exposes
its formulas and exclusions. Deterministic fixtures check caps, grades, slopes,
HP-limited spurt, boundary carryover and numerical step refinement.

## Automatic skill impact

Ordinary multi-race results queue 100 distinct matched pairs per equipped skill.
Existing compatible measurements count toward that target. One baseline is shared
across several isolated skill removals, within the 1,000-run batch limit. These
jobs use the outcome-only engine path without traces or dashboard analysis; stat
sensitivity remains manual.

The service persists the request and reserved seed schedule, resumes missing run
indices after a pause or restart, and gives foreground runs and dashboard loading
priority. The results checkbox pauses or resumes this work. Compact progress
responses carry only the compared runner's outcomes; full outcomes remain saved.

The Guts row includes a separate Early duel increment. It assumes an eligible
partner stays nearby, allows its 3 m lead to begin the 2 s proximity warmup, and
requires the subject to enter the final straight with at least 15% HP. The duel
ends below 5% HP. Its target/acceleration bonuses use the v74 Guts formulas. This
conditional increment is excluded from the combined stat advantage.
