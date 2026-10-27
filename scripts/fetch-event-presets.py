#!/usr/bin/env python3
"""Rebuild event presets from reviewed timeline/announcement facts.

uma.moe and umapyoi can deny automated HTTP requests. This importer accepts a
complete rendered timeline export instead of depending on private endpoints or
silently treating an incomplete viewport as the whole catalog. See the event
section of docs/simulator-editor-presets.md for the refresh procedure.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://uma.moe/timeline"
FACTS = ROOT / "scripts/data/competition-event-sources.json"
OUTPUT = ROOT / "src/sandbox/event-presets.json"
TRACK_JP = {
    "札幌": "Sapporo", "函館": "Hakodate", "新潟": "Niigata",
    "福島": "Fukushima", "中山": "Nakayama", "東京": "Tokyo",
    "中京": "Chukyo", "京都": "Kyoto", "阪神": "Hanshin",
    "小倉": "Kokura", "大井": "Oi", "川崎": "Kawasaki",
    "船橋": "Funabashi", "盛岡": "Morioka", "ロンシャン": "Longchamp",
    "デルマー": "Del Mar",
}


def parse_conditions(text: str, japanese: bool = False) -> dict:
    """Only parse explicit conditions; unknown values stay null."""
    empty = dict(track=None, distance=None, surface=None, turn=None, layout=None,
                 season=None, weather=None, ground=None, time=None)
    if not text:
        return empty
    if japanese:
        course = re.search(r"^(\S+)\s+(芝|ダート)\s+(\d+)m", text)
        if not course:
            raise ValueError(f"Unrecognized Japanese course conditions: {text}")
        track, surface, distance = course.groups()
        result = {**empty, "track": TRACK_JP.get(track, track),
                  "surface": 1 if surface == "芝" else 2, "distance": int(distance)}
        result["turn"] = 1 if "右" in text else 2 if "左" in text else 4 if "直線" in text else None
        result["layout"] = 3 if "・外" in text else 2 if "・内" in text else None
        for field, mapping in {
            "season": {"春": 1, "夏": 2, "秋": 3, "冬": 4},
            "weather": {"晴": 1, "曇": 2, "雨": 3, "雪": 4},
            "ground": {"良": 1, "稍重": 2, "重": 3, "不良": 4},
            "time": {"朝": 1, "昼": 2, "夕": 3, "夜": 4},
        }.items():
            # Token equality matters: 不良 must not accidentally become 良.
            result[field] = next((value for word, value in mapping.items()
                                  if word in text.split()), None)
        return result
    course = re.search(r"^(.+?)\s*·\s*(Turf|Dirt)\s*(\d+)m", text)
    if not course:
        raise ValueError(f"Unrecognized timeline course conditions: {text}")
    track, surface, distance = course.groups()
    result = {**empty, "track": "Oi" if track == "Ooi" else track,
              "surface": 1 if surface == "Turf" else 2, "distance": int(distance)}
    result["turn"] = 2 if "Counterclockwise" in text else 1 if "Clockwise" in text else None
    for field, mapping in {
        "season": {"Spring": 1, "Summer": 2, "Autumn": 3, "Winter": 4},
        "weather": {"Sunny": 1, "Cloudy": 2, "Rain": 3, "Snow": 4},
        "ground": {"Firm": 1, "Good": 2, "Soft": 3, "Heavy": 4},
    }.items():
        result[field] = next((value for word, value in mapping.items() if word in text), None)
    return result


def resolve_course(facts: dict, courses: dict, tracks: dict) -> int | None:
    matches = []
    for key, course in courses.items():
        if tracks.get(str(course["raceTrackId"])) != facts["track"]:
            continue
        if any(course[field] != facts[field] for field in ("distance", "surface")):
            continue
        if facts["turn"] is not None and course["turn"] != facts["turn"]:
            continue
        if facts["layout"] is not None and course["course"] != facts["layout"]:
            continue
        matches.append(int(key))
    # Ambiguity is incomplete evidence, not permission to pick inner/outer.
    return matches[0] if len(matches) == 1 else None


def event_date(label: str) -> str:
    return datetime.strptime(label.split(" – ", 1)[0], "%b %d, %Y").date().isoformat()


def build_presets(evidence: dict, courses: dict, tracks: dict) -> dict:
    checked = evidence["checkedAt"]
    datetime.strptime(checked, "%Y-%m-%d")
    rows = evidence["events"]
    if not rows or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Timeline must contain distinct event IDs and cannot be empty")
    announcements = evidence.get("announcements", {})
    count = {"cm": 0, "loh": 0}
    events = []
    for row in sorted(rows, key=lambda row: (event_date(row["time"]), row["id"])):
        kind = {"champions_meeting": "cm", "league_of_heroes": "loh"}[row["kind"]]
        count[kind] += 1
        date = event_date(row["time"])
        image_id = re.search(r"/(\d+)\.webp(?:\?|$)", row.get("image", ""))
        announcement = announcements.get(image_id[1], {}) if image_id else {}
        condition_source = announcement.get("url", SOURCE)
        condition_text = announcement.get("condition") or row.get("race") or ""
        facts = parse_conditions(condition_text, bool(announcement.get("condition")))
        variable = bool(announcement.get("variableConditions"))
        if variable:
            facts["weather"] = facts["ground"] = None
        course_id = resolve_course(facts, courses, tracks)
        name = row["name"].removeprefix("Champions Meeting: ")
        if kind == "loh" or name == "Champions Meeting":
            name = f"{facts['track']} {facts['distance']}m" if facts["track"] else row["name"]
        notes = []
        if course_id is None:
            notes.append("Course unavailable in the installed simulator." if facts["track"]
                         else "Race conditions have not been recorded.")
        if variable:
            notes.append("Weather/ground vary; choose below.")
        fields = ("season", "weather", "ground", "time")
        field_sources = {"date": SOURCE}
        field_sources.update({key: condition_source for key in ("courseId", *fields)
                              if (course_id if key == "courseId" else facts[key]) is not None})
        if variable:
            field_sources.update(weather=condition_source, ground=condition_source)
        events.append({
            "id": f"{kind}-{date}", "sourceEventId": row["id"], "kind": kind,
            "number": count[kind], "name": name, "date": date,
            "predicted": bool(row.get("predicted")), "courseId": course_id,
            **{field: facts[field] for field in fields},
            "source": condition_source, "fieldSources": field_sources,
            "course": {key: facts[key] for key in ("track", "distance", "surface", "turn", "layout")},
            "variableConditions": variable, "note": " ".join(notes),
        })
    if len({event["id"] for event in events}) != len(events):
        raise ValueError("Multiple events of one kind share a date; review before assigning IDs")
    return {"checkedAt": checked, "source": SOURCE, "events": list(reversed(events))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=FACTS, help="Reviewed source snapshot")
    parser.add_argument("--timeline", type=Path, help="Complete rendered event-card JSON array")
    parser.add_argument("--announcements", type=Path, help="Reviewed announcement facts keyed by news ID")
    parser.add_argument("--checked-at", help="YYYY-MM-DD when new source facts were reviewed")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--write-source", action="store_true", help="Save imported source facts after validation")
    parser.add_argument("--allow-removals", action="store_true", help="Allow reviewed upstream event removal")
    args = parser.parse_args()
    evidence = json.loads(args.source.read_text(encoding="utf-8"))
    original_ids = {row["id"] for row in evidence["events"]}
    if args.timeline:
        evidence["events"] = json.loads(args.timeline.read_text(encoding="utf-8"))
        missing = original_ids - {row["id"] for row in evidence["events"]}
        if missing and not args.allow_removals:
            raise SystemExit(f"Refusing partial timeline: {len(missing)} existing events absent")
    if args.announcements:
        evidence["announcements"].update(json.loads(args.announcements.read_text(encoding="utf-8")))
    if args.checked_at:
        evidence["checkedAt"] = args.checked_at
    if (args.timeline or args.announcements) and not args.checked_at:
        raise SystemExit("Imported source evidence needs --checked-at YYYY-MM-DD")
    courses = json.loads((ROOT / "public/data/courses.json").read_text(encoding="utf-8"))
    tracks = json.loads((ROOT / "public/data/metadata.json").read_text(encoding="utf-8"))["trackNames"]
    result = build_presets(evidence, courses, tracks)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.write_source:
        args.source.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"events": len(result["events"]),
                      "cm": sum(e["kind"] == "cm" for e in result["events"]),
                      "loh": sum(e["kind"] == "loh" for e in result["events"]),
                      "unavailable": [e["id"] for e in result["events"] if e["courseId"] is None]}))


if __name__ == "__main__":
    main()
