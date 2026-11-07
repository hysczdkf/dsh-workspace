"""Aggregate raw contest JSON (xcpcio board-data) into one compact dataset.

Input : raw/<group>/<season>/<contest>/{config,team,run}.json
Output: docs/data/dataset.json  (+ docs/data/schools.json)

Ranking follows ICPC rules: solved desc, penalty asc.
Penalty per solved problem = minutes to first AC + penalty_per_wrong * wrong tries.
"""
import argparse
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def text_of(node, default=""):
    """xcpcio stores i18n text as {fallback_lang, texts:{lang: str}}."""
    if node is None:
        return default
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        texts = node.get("texts") or {}
        fallback = node.get("fallback_lang")
        if fallback and texts.get(fallback):
            return texts[fallback]
        for key in ("zh-CN", "en", "en-US"):
            if texts.get(key):
                return texts[key]
        for value in texts.values():
            if value:
                return value
    return default


def name_of_person(person):
    if isinstance(person, dict):
        return text_of(person.get("name"))
    return text_of(person)


def season_label(group, season):
    return ("ICPC " + season) if group == "icpc" else ("CCPC " + season)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(ROOT, "raw"))
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "data"))
    ap.add_argument("--min-teams", type=int, default=8)
    args = ap.parse_args()

    contests = []
    rows = []
    careers = defaultdict(list)

    print("raw root: %s" % args.raw)
    raw_root = args.raw
    nested = os.path.join(raw_root, "data")
    if os.path.isdir(nested):
        raw_root = nested

    for group in ("icpc", "ccpc"):
        gdir = os.path.join(raw_root, group)
        if not os.path.isdir(gdir):
            continue
        for season in sorted(os.listdir(gdir)):
            sdir = os.path.join(gdir, season)
            if not os.path.isdir(sdir):
                continue
            for contest in sorted(os.listdir(sdir)):
                cdir = os.path.join(sdir, contest)
                need = [os.path.join(cdir, f) for f in ("config.json", "team.json", "run.json")]
                if not all(os.path.exists(p) for p in need):
                    continue
                try:
                    config = json.load(open(need[0], encoding="utf-8"))
                    teams = json.load(open(need[1], encoding="utf-8"))
                    runs = json.load(open(need[2], encoding="utf-8"))
                except (ValueError, OSError) as exc:
                    print("skip %s: %s" % (cdir, exc), file=sys.stderr)
                    continue

                if len(teams) < args.min_teams:
                    continue
                # 世界总决赛的学校字段上游普遍缺失，且不属于「中国赛区」范围
                if "world-finals" in contest:
                    continue

                # 新赛站把学校名放在独立的 organizations.json，用 organization_id 关联
                org_map = {}
                org_file = os.path.join(cdir, "organizations.json")
                if os.path.exists(org_file):
                    try:
                        for org in json.load(open(org_file, encoding="utf-8")):
                            org_map[str(org.get("id"))] = text_of(org.get("name"))
                    except (ValueError, OSError):
                        pass

                penalty_seconds = int(config.get("penalty", 1200) or 1200)
                problems = config.get("problems") or []
                prob_index = {str(p.get("id")): i for i, p in enumerate(problems)}

                # 时间戳单位不随 config 走：46th 用秒，49th/50th 用毫秒，
                # 用最大值判断（一场比赛不可能超过 86400 秒）
                max_ts = max([(r.get("timestamp") or 0) for r in runs], default=0)
                ts_in_ms = max_ts > 86400

                # --- score the runs ---
                per_team = defaultdict(lambda: {"solved": set(), "penalty": 0, "wrong": defaultdict(int)})
                for run in runs:
                    tid = str(run.get("team_id"))
                    pid = str(run.get("problem_id"))
                    state = per_team[tid]
                    if pid in state["solved"]:
                        continue
                    status = (run.get("status") or "").upper()
                    if status in ("ACCEPTED", "AC", "CORRECT"):
                        state["solved"].add(pid)
                        ts = run.get("timestamp") or 0
                        minutes = ts // 60000 if ts_in_ms else ts // 60
                        state["penalty"] += minutes + state["wrong"][pid] * (penalty_seconds // 60)
                    else:
                        state["wrong"][pid] += 1

                scored = []
                for team in teams:
                    tid = str(team.get("id") or team.get("team_id") or "")
                    st = per_team.get(tid, {"solved": set(), "penalty": 0})
                    groups = team.get("group") or []
                    official = ("official" in groups) or not groups
                    if team.get("unofficial"):
                        official = False
                    scored.append({
                        "team": team,
                        "solved": len(st["solved"]),
                        "penalty": st["penalty"],
                        "official": official,
                    })

                scored.sort(key=lambda x: (-x["solved"], x["penalty"]))
                cidx = len(contests)
                start = config.get("start_time") or 0
                contests.append({
                    "id": "%s/%s/%s" % (group, season, contest),
                    "group": group,
                    "season": season_label(group, season),
                    "name": text_of(config.get("contest_name")) or contest,
                    "date": start,
                    "problems": len(problems),
                    "teams": len(scored),
                })

                rank = 0
                prev = None
                for pos, item in enumerate(scored, 1):
                    key = (-item["solved"], item["penalty"])
                    if key != prev:
                        rank = pos
                        prev = key
                    team = item["team"]
                    members = [name_of_person(m) for m in (team.get("members") or [])]
                    members = [m for m in members if m]
                    school = text_of(team.get("organization"))
                    if not school:
                        school = org_map.get(str(team.get("organization_id")), "")
                    tname = text_of(team.get("name")).strip()
                    if not school or not tname:
                        continue  # 上游缺学校/队名的记录会污染统计，直接丢弃
                    rows.append([
                        cidx, rank, item["solved"], item["penalty"],
                        school, tname, "、".join(members), 1 if item["official"] else 0,
                    ])
                    careers[(school, tname)].append([cidx, rank, item["solved"], item["penalty"]])

    # --- school aggregation ---
    schools = defaultdict(lambda: {"name": "", "teams": set(), "appearances": 0,
                                   "gold": 0, "silver": 0, "bronze": 0, "best_rank": None})
    for row in rows:
        cidx, rank, solved, penalty, school = row[0], row[1], row[2], row[3], row[4]
        entry = schools[school]
        entry["name"] = school
        entry["teams"].add(row[5])
        entry["appearances"] += 1
        if entry["best_rank"] is None or rank < entry["best_rank"]:
            entry["best_rank"] = rank

    school_list = []
    for name, entry in schools.items():
        school_list.append({
            "name": name,
            "teams": len(entry["teams"]),
            "appearances": entry["appearances"],
            "best_rank": entry["best_rank"],
        })
    school_list.sort(key=lambda s: (-s["appearances"], s["name"]))

    career_list = []
    for (school, tname), hist in careers.items():
        hist.sort(key=lambda h: -h[0])
        best = min(h[1] for h in hist)
        total_solved = sum(h[2] for h in hist)
        career_list.append([school, tname, len(hist), best, total_solved,
                            [[h[0], h[1], h[2], h[3]] for h in hist]])
    career_list.sort(key=lambda c: (-c[2], -c[4]))

    dataset = {
        "contests": contests,
        "rows": rows,
    }
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "dataset.json"), "w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.out, "schools.json"), "w", encoding="utf-8") as f:
        json.dump(school_list, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.out, "careers.json"), "w", encoding="utf-8") as f:
        json.dump(career_list, f, ensure_ascii=False, separators=(",", ":"))

    print("contests: %d" % len(contests))
    print("rows    : %d" % len(rows))
    print("schools : %d" % len(school_list))
    print("teams   : %d" % len(career_list))
    for name in ("dataset.json", "schools.json", "careers.json"):
        path = os.path.join(args.out, name)
        print("  %-13s %6.2f MB" % (name, os.path.getsize(path) / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
