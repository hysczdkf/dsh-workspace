"""Aggregate raw contest JSON (xcpcio board-data) into a lazy-loadable dataset.

Input : raw/data/<group>/<season>/<contest>/{config,team,run,organizations}.json
Output:
  docs/data/index.json          比赛列表、学校汇总、赛季索引
  docs/data/rows-<season>.json  该赛季的全部参赛记录（学校用索引引用）
  docs/data/careers.json        队伍生涯（按需加载）

Ranking follows ICPC rules: solved desc, penalty asc.
Penalty per solved problem = minutes to first AC + 20 * wrong tries before AC.
"""
import argparse
import json
import os
import re
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
        return text_of(person.get("name")).strip()
    return text_of(person).strip()


def season_key(group, season):
    slug = re.sub(r"[^a-z0-9]+", "-", season.lower()).strip("-")
    return "%s-%s" % (group, slug)


def season_label(group, season):
    return ("ICPC " + season) if group == "icpc" else ("CCPC " + season)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(ROOT, "raw"))
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "data"))
    ap.add_argument("--min-teams", type=int, default=8)
    args = ap.parse_args()

    raw_root = args.raw
    nested = os.path.join(raw_root, "data")
    if os.path.isdir(nested):
        raw_root = nested

    contests = []
    rows = []                       # [cidx, rank, solved, penalty, school_idx, team, members, official]
    school_index = {}               # name -> idx
    school_list = []
    career_hist = defaultdict(list)  # (school, team) -> [[cidx, rank, solved, penalty]]
    season_rows = defaultdict(list)  # season_key -> rows

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

                # 时间戳单位不随 config 走：46th 用秒，49th/50th 用毫秒，
                # 用最大值判断（一场比赛不可能超过 86400 秒）
                max_ts = max([(r.get("timestamp") or 0) for r in runs], default=0)
                ts_in_ms = max_ts > 86400

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
                contests.append({
                    "id": "%s/%s/%s" % (group, season, contest),
                    "group": group,
                    "season": season_label(group, season),
                    "key": season_key(group, season),
                    "name": text_of(config.get("contest_name")) or contest,
                    "date": config.get("start_time") or 0,
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

                    si = school_index.get(school)
                    if si is None:
                        si = len(school_list)
                        school_index[school] = si
                        school_list.append([school, 0, set(), None])

                    rec = [cidx, rank, item["solved"], item["penalty"],
                           si, tname, "、".join(members), 1 if item["official"] else 0]
                    rows.append(rec)
                    season_rows[contests[cidx]["key"]].append(rec)
                    career_hist[(school, tname)].append([cidx, rank, item["solved"], item["penalty"]])

    # --- school aggregation (rows already reference schools by index) ---
    for rec in rows:
        entry = school_list[rec[4]]
        entry[1] += 1                      # appearances
        entry[2].add(rec[5])               # distinct teams
        if entry[3] is None or rec[1] < entry[3]:
            entry[3] = rec[1]              # best rank

    schools_out = [[e[0], e[1], len(e[2]), e[3]] for e in school_list]
    schools_out.sort(key=lambda s: (-s[1], s[0]))

    seasons_out = []
    for key, recs in season_rows.items():
        label = next(c["season"] for c in contests if c["key"] == key)
        seasons_out.append({
            "key": key,
            "label": label,
            "rows": len(recs),
            "contests": len({r[0] for r in recs}),
        })
    seasons_out.sort(key=lambda s: (-max([c["date"] for c in contests if c["key"] == s["key"]] or [0])))

    index = {
        "contests": contests,
        "schools": schools_out,
        "seasons": seasons_out,
        "counts": {
            "contests": len(contests),
            "rows": len(rows),
            "schools": len(schools_out),
            "teams": len(career_hist),
        },
    }

    careers_out = []
    for (school, tname), hist in career_hist.items():
        hist.sort(key=lambda h: -h[0])
        careers_out.append([school, tname, len(hist), min(h[1] for h in hist),
                            sum(h[2] for h in hist), hist])
    careers_out.sort(key=lambda c: (-c[2], -c[4]))

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    for key, recs in season_rows.items():
        with open(os.path.join(args.out, "rows-%s.json" % key), "w", encoding="utf-8") as f:
            json.dump(recs, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.out, "careers.json"), "w", encoding="utf-8") as f:
        json.dump(careers_out, f, ensure_ascii=False, separators=(",", ":"))

    print("contests: %d  rows: %d  schools: %d  teams: %d"
          % (index["counts"]["contests"], index["counts"]["rows"],
             index["counts"]["schools"], index["counts"]["teams"]))
    for name in ["index.json", "careers.json"] + ["rows-%s.json" % k for k in season_rows]:
        p = os.path.join(args.out, name)
        print("  %-26s %7.1f KB" % (name, os.path.getsize(p) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
