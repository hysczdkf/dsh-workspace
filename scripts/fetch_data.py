"""Download ICPC / CCPC contest data from xcpcio/board-data via the GitHub API.

Why the blob API instead of /contents: the contents endpoint returns an empty
payload for files larger than 1 MB, which silently corrupts run.json files.
Git blobs are returned base64 up to 100 MB and are addressed by sha, so every
download can be verified against the size declared in the git tree.

raw.githubusercontent.com and cdn.jsdelivr.net are unreachable from this
network, so everything goes through api.github.com.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
API = "https://api.github.com"
OWNER, REPO = "xcpcio", "board-data"


def token():
    tok = os.environ.get("GITHUB_TOKEN", "").strip()
    if tok:
        return tok
    for candidate in (os.path.join(ROOT, ".env"),
                      os.path.join(os.path.dirname(ROOT), ".env")):
        if os.path.exists(candidate):
            for line in open(candidate, encoding="utf-8-sig"):
                if line.strip().startswith("GITHUB_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


TOK = token()


def api(path, attempts=6):
    for i in range(attempts):
        req = urllib.request.Request(API + path, headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + TOK,
            "User-Agent": "dsh-agent",
        })
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(5 * (i + 1) if e.code in (403, 429) else 2 * (i + 1))
        except Exception:
            time.sleep(3 * (i + 1))
    return None


def fetch_blob(sha, dest, expected, attempts=5):
    if os.path.exists(dest) and os.path.getsize(dest) == expected:
        return "cached", 0
    if os.path.exists(dest):
        os.remove(dest)
    for i in range(attempts):
        blob = api("/repos/%s/%s/git/blobs/%s" % (OWNER, REPO, sha))
        if blob is None:
            time.sleep(3 * (i + 1))
            continue
        data = base64.b64decode(blob["content"])
        if len(data) != expected:
            time.sleep(2 * (i + 1))
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        return "ok", len(data)
    return "failed", 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "raw"))
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--targets", default=os.path.join(ROOT, "scripts", "targets.json"))
    args = ap.parse_args()

    targets = json.load(open(args.targets, encoding="utf-8"))
    print("loading git tree...", flush=True)
    tree = api("/repos/%s/%s/git/trees/main?recursive=1" % (OWNER, REPO))
    if not tree:
        print("cannot load tree")
        return 1
    blobs = {t["path"]: (t["sha"], t.get("size", 0)) for t in tree["tree"] if t["type"] == "blob"}

    jobs = []
    for group in ("icpc", "ccpc"):
        for cdir in targets.get(group, []):
            for fname in ("config.json", "team.json", "run.json", "organizations.json"):
                rel = "%s/%s" % (cdir, fname)
                if rel not in blobs:
                    continue
                sha, size = blobs[rel]
                jobs.append((rel, sha, size, os.path.join(args.out, rel)))

    print("files to fetch: %d (%.1f MB)" % (len(jobs), sum(j[2] for j in jobs) / 1e6), flush=True)
    stats = {"ok": 0, "cached": 0, "failed": 0}
    done = 0
    got = 0
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_blob, sha, dest, size): rel
                   for rel, sha, size, dest in jobs}
        for fut in as_completed(futures):
            rel = futures[fut]
            try:
                status, size = fut.result()
            except Exception as exc:
                status, size = "failed", 0
                print("EXC %s: %s" % (rel, exc), flush=True)
            stats[status] = stats.get(status, 0) + 1
            got += size
            done += 1
            if done % 25 == 0 or done == len(jobs):
                print("[%5.1f%%] %d/%d  %.1fMB  %ds  ok=%d cached=%d failed=%d"
                      % (100.0 * done / len(jobs), done, len(jobs), got / 1e6,
                         time.time() - t0, stats["ok"], stats["cached"], stats["failed"]),
                      flush=True)

    print("DONE", stats, "%.1f MB in %ds" % (got / 1e6, time.time() - t0), flush=True)
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
