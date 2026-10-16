# Mechanics evidence from the installed client

This audit uses offline Steam Global client files. It does not execute, attach to, or modify the game. Native declarations, recovered machine code, reference notes, and simulator behavior are different levels of evidence.

## Artifact identity and recovered code

| Artifact | SHA-256 |
| --- | --- |
| `GameAssembly.dll` (100,642,816 bytes) | `fe5b71c7d6043e36d1058a210a886bb5ef175da434ba2e615f3a4006397bd44d` |
| `global-metadata.dat` (33,532,564 bytes, IL2CPP version 31) | `27b8f59d91c2be040bba33964ccb6bab37d5ae674b47dfccc32d5793f76edb5f` |
| Supplied *Race Mechanics* notes | `fb63c86215a4f06fadcca2cca6d4f5bbf5e5d399a9bb955c2b2382c8f7e9649b` |

REA/Ghidra 12.1.4 recovered the entry at `0x180001b5c`, its call to `0x180001000`, and a subsequent function at `0x1800019f0`. The latter derives addresses from the caller, obtains function pointers, calls another transformation function, and transfers control through a computed pointer. No race-mechanics body was recovered on this path. In the on-disk PE, `.text` and `il2cpp` have virtual sizes `0x507000` and `0x5643000`, respectively, but each has only `0x1000` raw bytes. The normal mapped executable view therefore does not expose their declared virtual ranges as ordinary on-disk code. This supports a loader/transformation boundary; it does not establish the encoding algorithm or the behavior of the transformed code.

Retained REA evidence:

- Entry: `ev_057ea0b81b86d39447356b46b1dba12ffac0244b1ebe6d28bf4b290eb5754b2f`.
- Entry callee: `ev_500a187c1d3194a25b1b02497ecfb5389a1632541244cc9f13084c10ea146bb4`.
- Additional loader trace: `ev_34b4e7904908f6e792451afb28e5e928371feaa0ce1570bddc8dddb56f8bba78`.
- Earlier complete procedure-name search: `ev_adc918f294a365dcf7e9a6be05600493faeea906dfd18b7f1e7fec4d831ea3dd`. Its 27 recognized procedures do not cover the game engine; a negative name search is not proof of an absent feature.
- Analysis profile: `90e13888e18b7d587414bb259f5e3dc44a7c9293bdf290ad8c459be524747d9f`.

The bounded new session was closed. No runtime unpacking, hooks, certificate changes, or installation changes were used.

## Exact metadata declarations

The following are parsed IL2CPP enum/default records, not inferred translations. All decimal offsets below are **metadata file record offsets**, not native addresses or object member offsets.

| Declaration | Value | Default record |
| --- | --- | --- |
| `SkillAbilityType.CurrentSpeed` | 21 | 17377724 |
| `SkillAbilityType.CurrentSpeedWithNaturalDeceleration` | 22 | 17377736 |
| `SkillAbilityType.TargetSpeed` | 27 | 17377796 |
| `SkillAbilityType.Accel` | 31 | 17377844 |
| `SkillAbilityType.ChallengeMatchBonus_Old` | 501 | 17377952 |
| `SkillAbilityType.ChallengeMatchBonusStatus` | 502 | 17377964 |
| `SkillAbilityType.ChallengeMatchBonusMotivation` | 503 | 17377976 |
| `SkillAbilityValueUsage.MultiplyOrderUpCountCornerPhaseEndAfter` | 11 | 17378216 |
| `SkillAbilityValueUsage.MultiplyFanCount` | 12 | 17378228 |
| `SkillAbilityValueLevelUsage.None / Normal / Ignore / Inverse` | 0 / 1 / 2 / 3 | 17378420–17378456 |
| `SkillTargetType.Visible` | 4 | 17378504 |

`SkillAbilityValueMultiplyOrderUpCountCornerPhaseEndAfter.GetMultiply`, `SkillAbilityValueMultiplyFanCount.GetMultiply`, and the corresponding `OrderUpCornerPhaseEndAfterCoefAscArray` / `FanCountCoefAscArray` declarations exist. Their names do not recover qualifying-pass rules or numeric fan-count thresholds. Likewise, 501–503 names do not establish which attributes change, by how much, or whether an event score bonus affects race movement. `Inverse` alone does not prove multiplication versus division in level scaling.

The readable replay reference `SkillDataUtils.ts` implements fan-count tiers below 20,000 / 50,000 / 100,000 / 160,000 as ×0.8 / ×0.9 / ×1.0 / ×1.1, then ×1.2. This is a sourced implementation, not native-body verification. Its missing-fan-count fallback of ×1.2 must not become an observed value in this application. No inspected simulator source established `valueLevelUsage=2` behavior; treating the exact enum name `Ignore` as bypassing the level coefficient remains an explicit reference policy.

`SkillBase` declares separate `LotActivate`, `IsActivateEnableByWizLot`, and `CheckTriggerAndActivate` methods. `SkillManagerSimulate` separately declares lottery and first/second-group condition checks. This establishes distinct engine entry points, but declarations alone cannot prove their execution order or RNG consumption.

## Formula and update-order evidence

The supplied notes describe a pre-race wisdom lottery, followed by condition checks during the race. Their initialization and frame sections put lottery before gate initialization, and activation before phase update. These are reference claims; the installed native method bodies have not independently verified that ordering. The pinned [Umalator solver](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/RaceSolver.ts) uses a different explicit frame order in some places, including phase update before skill activation. Its order must not be presented as a native confirmation of the notes.

For movement, the notes distinguish self speed (`LastSelfSpeed`) from actual speed (`LastSpeed`). Acceleration changes self speed; effects 21/22 add to actual speed for travel. Type 22 additionally transfers its value to self speed when its temporary modifier expires. The pinned solver implements this separation with `currentSpeed`, additive current-speed modifiers, and displacement after acceleration. Target speed is a separate attractor, so target-speed and actual-speed effects are not interchangeable percentages and must not be compounded twice.

The notes give a front-neighborhood candidate rule: `0 < longitudinal gap < 2 m`, lateral gap at most `(1 − 0.6 × gap / 2) × 0.75 horse lane`, selecting the closest qualifying runner. Its speed cap is `(0.988 + 0.012 × gap / 2) × front actual speed`. This can support a conditional neighborhood cap even when a capture does not report a block flag. It does **not** prove that the native game starts deceleration earlier, nor determine whether a sampled flag is delayed, sustained, or thresholded. Missing/uncertain lane conversion or between-sample positions must remain uncertainty. No arbitrary wider slowdown radius is established by this audit.

The reference position-keeping entry rules do not require a speed plateau. The pinned solver checks pace entry before its acceleration update, with no general prohibition while accelerating; Pace Down separately checks active speed-up skills. Thus acceleration is not a sound universal exclusion for a *reference* pace scenario. The hidden checks, cooldown, selected pacemaker, and RNG still prevent a unique recorded-state reconstruction.

## Native condition bodies not verified

The later complete [GameTora review](condition-coverage.md) resolves these reference meanings, including gap percentage, lane bands, player-only distance, healing type 9 and current rushed enemies. The table below records what the native-code inspection itself did not establish; it is not the current condition coverage list.

| Question | Native declaration located | Not established from native bodies |
| --- | --- | --- |
| `distance_diff_rate` | `SkillTriggerHorseDistanceDiffRate.GetValueLh`, record 10463192 | Scale, denominator, rounding |
| `is_behind_in` | `SkillTriggerHorseBehindIn.CheckActivate`, 10464416 | Opponent/inside geometry and boundary rules |
| `lane_type` | `SkillTriggerLaneType.GetValueLh`, 10459772 | Exact lane bands |
| `lastspurt` | `SkillTriggerLastSpurt.CheckActivate`, 10459232 | Native enum implementation (the adopted GameTora reference defines 0/1/2) |
| Viewer-specific remaining distance | `SkillTriggerHorseViewerIdRemainDistance.GetValueLh`, 10462976; `_targetHorseArray` | Construction and target binding |
| Other-character advantage skill | `SkillTriggerOtherCharacterActivateAdvantageSkill.CheckActivate`, 10466756; `_targetAbilityType` | Keyword-to-effect mapping and timing |
| Opponent rushed counters | `SkillTriggerTemptationBehind/Infront` and `SkillTriggerRunningStyleTemptationCount` constructors accept `isCheckOnlyOpponent`; style selector is separate | Current active runners versus cumulative events; team exclusion rules |

`HorseRaceAISimulate` also declares distinct last-spurt calculation result, start-distance, target-speed, and state accessors. This does not settle whether recovery recalculates after an already-started spurt. The supplied notes say recovery after late-race entry recalculates; the pinned solver guards recalculation with `!isLastSpurt`. Preserve that disagreement explicitly.

The October 16 follow-up rechecked the installed binary digest (unchanged) and reused the retained loader dossier through REA `inspect_analysis_view`, evidence `ev_44b1aceeee0833a508e6a28a19aeb60bace30f4aa37b2c80a08ee239314c02c5`. Its complete 1,508-code-unit pseudocode still ends at transformed/computed code; it does not expose a spurt or HP-recovery body. Metadata separately declares `_lastSpurtCalcCount`, `_lastSpurtCalcResult`, `_lastSpurtTargetSpeed`, `_lastSpurtStartDistance`, `_isLastSpurtByDistanceRequested`, `UpdateLastSpurtRequestByDistance`, `UpdateLastSpurt`, and the base `IsReqCalcLastSpurt` getter/setter. These declarations support separate request/calculation/state concepts, but cannot establish the recovery trigger, guard or update order. No new game execution or runtime attachment was performed.

Recovering these unknowns requires a verified code-to-metadata registration and inspectable transformed method bodies, or separately authorized runtime evidence. More searches over the same loader-only procedure inventory cannot resolve them. Until then, formulas remain declared reference assumptions, recorded statuses remain observations, and counterfactual trajectories remain conditional models.
