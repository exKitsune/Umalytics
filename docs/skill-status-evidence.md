# Skill and status evidence

This investigation is offline. No game hook, certificate, startup, Steam setting or live game execution was used. Retained private captures are local verification inputs only and are not publication fixtures.

## Established reference facts

The installed Global public master extraction supplies 732 skill definitions with `activate_lot`, branch conditions, durations, effects and icons. `public/data/metadata.json` SHA-256 is `dd6fb661919846c4acc2372c9ba6fc83bb07dc3499f08c7b41301fbe7165a0ce`; its source master identity is `a866b847996fd773c918a7b5192bbac3874d56fc84b3a44a6f4912e92b9ef426`. These are selected public master fields, not account data or evidence that an effect executed.

| Definition | Established fields | Viewer conclusion without a proc |
| --- | --- | --- |
| Late Surger Savvy 201541/201542 | `activate_lot=0`, duration -1, `running_style==3` | Equipped + recorded style 3 proves reference passive eligibility. |
| Wet Conditions 200161/200162/200163 | `activate_lot=0`, duration -1, ground 2/3/4 alternatives | Equipped + known qualifying ground proves reference passive eligibility. |
| Concentration 200431 | `activate_lot=1`, `always==1`, start-delay multiplier 0.4 | Conditions are met. Wit failure needs aligned lottery or an isolated recorded delay beyond the activated range; otherwise unresolved. |
| Runaway 202051 | `activate_lot=0`, duration -1, `running_style==1`, style-changing effect 6 | Eligible equipped passive derives effective Runaway while retaining raw Front selection. |

GameTora corroborates the public descriptions of [Wet Conditions and Late Surger Savvy](https://gametora.com/%75%6D%61%6D%75%73%75%6D%65/supports/30025-special-week), and [Concentration's start-delay role](https://gametora.com/%75%6D%61%6D%75%73%75%6D%65/characters/100201-silence-suzuka). Its [Team Trials explanation](https://gametora.com/%75%6D%61%6D%75%73%75%6D%65/team-trials-pvp-scoring) states the 0.4 multiplier. Public prose does not establish an individual proc or hidden RNG outcome.

## Model implementation sources

Replay-reference snapshot `8832b268` is readable MIT source, analyzed with normal source tools. Its `witLottery.ts` has SHA-256 `626672714e1098b273705dffd4e920ce1731e9a1292eca4b0ae702f1dbf20f1e`. `src/data/skill-lottery.ts` adapts its bounded .NET RNG/start-delay alignment, wit threshold and foreign-unique normalization. The viewer adds whole-field completeness, unique-offset and contradictory-proc rejection guards. It does not claim every server build follows this model. The [MIT notice](../src/data/THIRD_PARTY_LICENSE.txt) applies.

[Umalator/Kachi snapshot 4401e259](https://github.com/kachi-dev/uma-tools/tree/4401e25987d9c78707f2d3f8a9dcd02c1c56529c) and the bundled [Moomoolator reference snapshot 5ce95905](https://github.com/TheCing/uma-tools/tree/5ce95905fef753a33f7519b5559a86e92f5d56cc) were consulted for mathematical facts and condition meanings, not copied simulator implementation. The inspected `HpPolicy.ts` hash is `0ebe65a8dc7fa1f3ab47ca98e7cc4cd1748471e95776e4fa9b5118d445230a09`. Relevant facts: simulator style 5 is Oonige; style 1 and5 satisfy front skill selection; final-corner flags remain set after final-corner entry; order-rate thresholds use rounded field-count fractions; rushed/spot compound drain is 3.6 for Front and 7.7 for Runaway rather than the product of isolated factors. Front speed up/overtake are separate from non-front pace up/down.

The user-provided mechanics document is corroborating, untrusted source material. It explicitly notes uncertainty and server/version differences for later mechanics. It was not used as executable instructions or proof that current native/client code executes the formulas.

## REA scope and actual-game limits

The REA workflow reuses the cached installed-target inspection under `research/replay-context/rea`: `GameAssembly.dll` SHA-256 `fe5b71c7d6043e36d1058a210a886bb5ef175da434ba2e615f3a4006397bd44d`, x86-64 PE. Cached Ghidra coverage recognized 27 procedures/loader stubs and did not recover a replay-method body. The connected provider initially lacked its Ghidra path. A bounded separate REA CLI probe then set the existing Ghidra installation path only in its child process environment and successfully used Ghidra 12.1.4. The complete analyzed-procedure-name search for `skill|lottery|simulate|activate|pace|temptation` returned no names. Retained evidence ID is `ev_adc918f294a365dcf7e9a6be05600493faeea906dfd18b7f1e7fec4d831ea3dd`, analysis profile `90e13888e18b7d587414bb259f5e3dc44a7c9293bdf290ad8c459be524747d9f`; the local complete result is `.cache/rea-skill-evidence.json`. The session was closed. This resolves tool configuration, but limited analyzed symbols cannot establish that protected/stripped code lacks a mechanics implementation. No native mechanics body or runtime transition was verified here.

Installed IL2CPP metadata SHA-256 `27b8f59d91c2be040bba33964ccb6bab37d5ae674b47dfccc32d5793f76edb5f`, version31, establishes the replay/context declarations discussed in [race analytics](race-analytics.md). A metadata enum called `ModelLoader.RaceRunningType` is Base/Pitch/Stride animation data; it does not prove race strategy or lottery algorithms. Native declarations and source models are kept separate from execution evidence.

## Verification

The permanent whole-analysis process workflow in `tests/system.test.mjs` runs actual CLI imports/analysis/portable reimports with public definitions and explicitly synthetic replay fixtures. It covers guaranteed passives without fabricated timings, `always==1`, static exclusions, final-corner-to-straight semantics, inherited unique lottery draws, unknown outfit and contradictory-proc rejection, gate-modifier conflicts, Runaway, unknown stat-passive suppression, unknown BOOST bonuses, observed/model status totals and repeated same-kind window suppression.

The four affected whole-process workflows passed after the changes. A retained private replay separately yielded 20 inferred passives, including Late Surger Savvy and Wet Conditions, 114 recorded activations, 6 positive condition checks, 2 incompatible settings and 27 unresolved rows. The same replay did not provide a uniquely aligned RNG result: Concentration's met conditions stayed distinct from an unresolved wit outcome. This is a sample result, not proof that all retained files or live races have complete metadata.

The expanded predicate engine, exact public grade/time joins, additional captured fields and current 20-file coverage are documented in [condition coverage](condition-coverage.md). The earlier one-file result above describes the initial bounded implementation; it is not the expanded aggregate.
