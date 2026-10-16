/** Per-key source declaration audit; locations are references, not copied implementation. */
export const conditionSourceAudit:Record<string,{file:string|null;line:number|null;treatment:string;url:string|null}> = {
  "accumulatetime": {
    "file": "ActivationConditions.ts",
    "line": 404,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L404"
  },
  "activate_count_all": {
    "file": "ActivationConditions.ts",
    "line": 419,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L419"
  },
  "activate_count_end_after": {
    "file": "ActivationConditions.ts",
    "line": 427,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L427"
  },
  "activate_count_heal": {
    "file": "ActivationConditions.ts",
    "line": 432,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L432"
  },
  "activate_count_later_half": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "activate_count_middle": {
    "file": "ActivationConditions.ts",
    "line": 437,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L437"
  },
  "activate_count_start": {
    "file": "ActivationConditions.ts",
    "line": 442,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L442"
  },
  "all_corner_random": {
    "file": "ActivationConditions.ts",
    "line": 447,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L447"
  },
  "always": {
    "file": "ActivationConditions.ts",
    "line": 460,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L460"
  },
  "base_power": {
    "file": "ActivationConditions.ts",
    "line": 462,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L462"
  },
  "bashin_diff_behind": {
    "file": "ActivationConditions.ts",
    "line": 467,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L467"
  },
  "bashin_diff_infront": {
    "file": "ActivationConditions.ts",
    "line": 468,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L468"
  },
  "behind_near_lane_time": {
    "file": "ActivationConditions.ts",
    "line": 469,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L469"
  },
  "behind_near_lane_time_set1": {
    "file": "ActivationConditions.ts",
    "line": 472,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L472"
  },
  "blocked_front": {
    "file": "ActivationConditions.ts",
    "line": 474,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L474"
  },
  "blocked_front_continuetime": {
    "file": "ActivationConditions.ts",
    "line": 475,
    "treatment": "random proxy",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L475"
  },
  "blocked_side_continuetime": {
    "file": "ActivationConditions.ts",
    "line": 478,
    "treatment": "random proxy",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L478"
  },
  "change_order_onetime": {
    "file": "ActivationConditions.ts",
    "line": 481,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L481"
  },
  "change_order_up_end_after": {
    "file": "ActivationConditions.ts",
    "line": 482,
    "treatment": "random proxy",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L482"
  },
  "change_order_up_finalcorner_after": {
    "file": "ActivationConditions.ts",
    "line": 488,
    "treatment": "random proxy",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L488"
  },
  "compete_fight_count": {
    "file": "ActivationConditions.ts",
    "line": 505,
    "treatment": "random proxy",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L505"
  },
  "corner": {
    "file": "ActivationConditions.ts",
    "line": 512,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L512"
  },
  "corner_random": {
    "file": "ActivationConditions.ts",
    "line": 552,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L552"
  },
  "distance_diff_rate": {
    "file": "ActivationConditions.ts",
    "line": 581,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L581"
  },
  "distance_diff_top": {
    "file": "ActivationConditions.ts",
    "line": 582,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L582"
  },
  "distance_rate": {
    "file": "ActivationConditions.ts",
    "line": 584,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L584"
  },
  "distance_rate_after_random": {
    "file": "ActivationConditions.ts",
    "line": 594,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L594"
  },
  "distance_type": {
    "file": "ActivationConditions.ts",
    "line": 600,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L600"
  },
  "down_slope_random": {
    "file": "ActivationConditions.ts",
    "line": 618,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L618"
  },
  "grade": {
    "file": "ActivationConditions.ts",
    "line": 625,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L625"
  },
  "ground_condition": {
    "file": "ActivationConditions.ts",
    "line": 626,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L626"
  },
  "ground_type": {
    "file": "ActivationConditions.ts",
    "line": 627,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L627"
  },
  "hp_per": {
    "file": "ActivationConditions.ts",
    "line": 628,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L628"
  },
  "infront_near_lane_time": {
    "file": "ActivationConditions.ts",
    "line": 638,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L638"
  },
  "is_activate_any_skill": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "is_badstart": {
    "file": "ActivationConditions.ts",
    "line": 651,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L651"
  },
  "is_basis_distance": {
    "file": "ActivationConditions.ts",
    "line": 645,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L645"
  },
  "is_behind_in": {
    "file": "ActivationConditions.ts",
    "line": 658,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L658"
  },
  "is_dirtgrade": {
    "file": "ActivationConditions.ts",
    "line": 659,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L659"
  },
  "is_exist_chara_id": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "is_finalcorner": {
    "file": "ActivationConditions.ts",
    "line": 669,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L669"
  },
  "is_finalcorner_laterhalf": {
    "file": "ActivationConditions.ts",
    "line": 681,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L681"
  },
  "is_finalcorner_random": {
    "file": "ActivationConditions.ts",
    "line": 693,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L693"
  },
  "is_last_straight_onetime": {
    "file": "ActivationConditions.ts",
    "line": 726,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L726"
  },
  "is_lastspurt": {
    "file": "ActivationConditions.ts",
    "line": 711,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L711"
  },
  "is_move_lane": {
    "file": "ActivationConditions.ts",
    "line": 736,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L736"
  },
  "is_other_character_activate_advantage_skill": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "is_overtake": {
    "file": "ActivationConditions.ts",
    "line": 737,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L737"
  },
  "is_surrounded": {
    "file": "ActivationConditions.ts",
    "line": 738,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L738"
  },
  "is_temptation": {
    "file": "ActivationConditions.ts",
    "line": 739,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L739"
  },
  "lane_type": {
    "file": "ActivationConditions.ts",
    "line": 745,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L745"
  },
  "last_straight_random": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "lastspurt": {
    "file": "ActivationConditions.ts",
    "line": 746,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L746"
  },
  "motivation": {
    "file": "ActivationConditions.ts",
    "line": 767,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L767"
  },
  "near_count": {
    "file": "ActivationConditions.ts",
    "line": 768,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L768"
  },
  "order": {
    "file": "ActivationConditions.ts",
    "line": 769,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L769"
  },
  "order_rate": {
    "file": "ActivationConditions.ts",
    "line": 770,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L770"
  },
  "order_rate_in20_continue": {
    "file": "ActivationConditions.ts",
    "line": 771,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L771"
  },
  "order_rate_in50_continue": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "order_rate_in80_continue": {
    "file": "ActivationConditions.ts",
    "line": 773,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L773"
  },
  "order_rate_out20_continue": {
    "file": "ActivationConditions.ts",
    "line": 774,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L774"
  },
  "order_rate_out40_continue": {
    "file": "ActivationConditions.ts",
    "line": 775,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L775"
  },
  "order_rate_out50_continue": {
    "file": "ActivationConditions.ts",
    "line": 776,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L776"
  },
  "order_rate_out70_continue": {
    "file": "ActivationConditions.ts",
    "line": 777,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L777"
  },
  "overtake_target_no_order_up_time": {
    "file": "ActivationConditions.ts",
    "line": 778,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L778"
  },
  "overtake_target_time": {
    "file": "ActivationConditions.ts",
    "line": 779,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L779"
  },
  "phase": {
    "file": "ActivationConditions.ts",
    "line": 780,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L780"
  },
  "phase_firsthalf_random": {
    "file": "ActivationConditions.ts",
    "line": 839,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L839"
  },
  "phase_laterhalf_random": {
    "file": "ActivationConditions.ts",
    "line": 866,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L866"
  },
  "phase_random": {
    "file": "ActivationConditions.ts",
    "line": 875,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L875"
  },
  "popularity": {
    "file": "ActivationConditions.ts",
    "line": 895,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L895"
  },
  "post_number": {
    "file": "ActivationConditions.ts",
    "line": 896,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L896"
  },
  "random_lot": {
    "file": "ActivationConditions.ts",
    "line": 915,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L915"
  },
  "remain_distance": {
    "file": "ActivationConditions.ts",
    "line": 920,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L920"
  },
  "remain_distance_viewer_id": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "rotation": {
    "file": "ActivationConditions.ts",
    "line": 934,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L934"
  },
  "running_style": {
    "file": "ActivationConditions.ts",
    "line": 935,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L935"
  },
  "running_style_count_nige_otherself": {
    "file": "ActivationConditions.ts",
    "line": 951,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L951"
  },
  "running_style_count_oikomi_otherself": {
    "file": "ActivationConditions.ts",
    "line": 960,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L960"
  },
  "running_style_count_same": {
    "file": "ActivationConditions.ts",
    "line": 945,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L945"
  },
  "running_style_count_same_rate": {
    "file": "ActivationConditions.ts",
    "line": 946,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L946"
  },
  "running_style_count_sashi_otherself": {
    "file": "ActivationConditions.ts",
    "line": 957,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L957"
  },
  "running_style_count_senko_otherself": {
    "file": "ActivationConditions.ts",
    "line": 954,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L954"
  },
  "running_style_equal_popularity_one": {
    "file": "ActivationConditions.ts",
    "line": 963,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L963"
  },
  "running_style_temptation_opponent_count_nige": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "running_style_temptation_opponent_count_oikomi": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "running_style_temptation_opponent_count_sashi": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "running_style_temptation_opponent_count_senko": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "same_skill_horse_count": {
    "file": "ActivationConditions.ts",
    "line": 968,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L968"
  },
  "season": {
    "file": "ActivationConditions.ts",
    "line": 969,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L969"
  },
  "slope": {
    "file": "ActivationConditions.ts",
    "line": 970,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L970"
  },
  "straight_front_type": {
    "file": "ActivationConditions.ts",
    "line": 989,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L989"
  },
  "straight_random": {
    "file": "ActivationConditions.ts",
    "line": 996,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L996"
  },
  "temptation_count": {
    "file": "ActivationConditions.ts",
    "line": 1008,
    "treatment": "no-op approximation",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L1008"
  },
  "temptation_opponent_count_behind": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "temptation_opponent_count_infront": {
    "file": null,
    "line": null,
    "treatment": "not declared in inspected simulator snapshot",
    "url": null
  },
  "time": {
    "file": "ActivationConditions.ts",
    "line": 1011,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L1011"
  },
  "track_id": {
    "file": "ActivationConditions.ts",
    "line": 1012,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L1012"
  },
  "up_slope_random": {
    "file": "ActivationConditions.ts",
    "line": 1013,
    "treatment": "random region",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L1013"
  },
  "weather": {
    "file": "ActivationConditions.ts",
    "line": 1021,
    "treatment": "reference rule",
    "url": "https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L1021"
  }
};
