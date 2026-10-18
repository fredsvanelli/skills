#!/usr/bin/env python3
"""Helper for the /utils:cleanup-dependabot skill. Uses only `gh` and `git` — no jq.

  dependabot.py list [--json]              open Dependabot PRs, classified
  dependabot.py covered PKG VER [REF]      is VER already resolved in REF (default origin/develop)?
  dependabot.py wait N [--timeout S]       waits for mergeable + checks and says whether it can merge
  dependabot.py rebase N [--timeout S]     comments @dependabot rebase and waits for the head to change

Exit codes: 0 = ok / covered / mergeable; 1 = no; 2 = usage or tool error.
"""
import json
import os
import re
import subprocess
import sys
import time

# checks that must be SUCCESS; each project sets them in the "env" of .claude/settings.json
REQUIRED_CHECKS = tuple(c.strip() for c in os.environ.get("DEPENDABOT_REQUIRED_CHECKS", "").split(",") if c.strip())
GROUP_RE = re.compile(r"bump the (?P<group>[\w-]+) group")
SINGLE_RE = re.compile(r"bump (?P<pkg>\S+) from (?P<from>\S+) to (?P<to>\S+)")
UPDATE_RE = re.compile(r"Updates? `(?P<pkg>[^`]+)` from (?P<from>\S+) to (?P<to>\S+)")
# table at the top of a group's body: | [pkg](url) | `from` | `to` |  — GitHub truncates the
# body at ~65 KB and the "Updates `pkg`" blocks at the end disappear; the table is the full source.
TABLE_RE = re.compile(r"^\| \[(?P<pkg>[^\]]+)\]\([^)]*\) \| `(?P<from>[^`]+)` \| `(?P<to>[^`]+)` \|", re.M)


def sh(*args, check=True):
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.stderr.write(r.stderr or r.stdout)
        sys.exit(2)
    return r.stdout


def gh_json(*args):
    return json.loads(sh("gh", *args))


def semver(v):
    """Comparable tuple; ignores the 'v' prefix and orders pre-releases first ("1.2.3-beta.1" < "1.2.3")."""
    v = v.lstrip("v")
    core, _, pre = v.partition("-")
    nums = tuple(int(x) if x.isdigit() else 0 for x in core.split("."))
    nums += (0,) * (3 - len(nums))
    return nums + ((0,) if pre else (1,))


def level(frm, to):
    a, b = semver(frm), semver(to)
    if a[0] != b[0]:
        return "major"
    if a[1] != b[1]:
        return "minor"
    return "patch"


def parse_updates(title, body):
    m = SINGLE_RE.search(title)
    if m and not GROUP_RE.search(title):
        return [dict(pkg=m["pkg"], **{"from": m["from"]}, to=m["to"],
                     level=level(m["from"], m["to"]))]
    seen, out = set(), []
    for m in list(TABLE_RE.finditer(body)) + list(UPDATE_RE.finditer(body)):
        if m["pkg"] in seen:
            continue
        seen.add(m["pkg"])
        out.append(dict(pkg=m["pkg"], **{"from": m["from"]}, to=m["to"],
                        level=level(m["from"], m["to"])))
    return out


def checks_summary(rollup):
    """(all_required_green, list_of_failed_or_missing). A skipped job is NOT green."""
    by_name = {}
    for c in rollup or []:
        name = c.get("name") or c.get("context") or ""
        state = (c.get("conclusion") or c.get("state") or "").upper()
        by_name[name] = state
    bad = []
    for req in REQUIRED_CHECKS:
        st = by_name.get(req)
        if st != "SUCCESS":
            bad.append(f"{req}={st or 'missing'}")
    for name, st in by_name.items():
        if st in ("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED") and name not in REQUIRED_CHECKS:
            bad.append(f"{name}={st}")
    return (not bad), bad


def cmd_list(as_json):
    prs = gh_json("pr", "list", "--author", "app/dependabot", "--state", "open",
                  "--limit", "50", "--json",
                  "number,title,body,baseRefName,headRefName,mergeable,mergeStateStatus,"
                  "statusCheckRollup,createdAt,labels")
    rows = []
    for p in prs:
        ups = parse_updates(p["title"], p["body"])
        green, bad = checks_summary(p["statusCheckRollup"])
        rows.append(dict(
            number=p["number"], base=p["baseRefName"], head=p["headRefName"],
            title=p["title"], createdAt=p["createdAt"][:10],
            group=bool(GROUP_RE.search(p["title"])),
            ecosystem="github-actions" if p["headRefName"].startswith("dependabot/github_actions") else "npm",
            updates=ups,
            has_major=any(u["level"] == "major" for u in ups),
            mergeable=p["mergeable"], mergeState=p["mergeStateStatus"],
            ci_green=green, ci_problems=bad,
        ))
    # working order: develop before main; group before single; no major before major
    rows.sort(key=lambda r: (r["base"] != "develop", not r["group"], r["has_major"], r["number"]))
    if as_json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return
    print(f"{'PR':>5}  {'base':8} {'level':6} {'mergeable':12} {'CI':6} packages")
    for r in rows:
        lvl = "group" if r["group"] else (r["updates"][0]["level"] if r["updates"] else "?")
        pk = ", ".join(f"{u['pkg']} {u['from']}→{u['to']}" for u in r["updates"][:3])
        if len(r["updates"]) > 3:
            pk += f" (+{len(r['updates']) - 3})"
        ci = "green" if r["ci_green"] else "NO"
        print(f"#{r['number']:>4}  {r['base']:8} {lvl:6} {r['mergeable']:12} {ci:6} {pk}")
        if r["has_major"] and r["group"]:
            print(f"{'':6} ⚠ group contains major: " + ", ".join(u["pkg"] for u in r["updates"] if u["level"] == "major"))
        if not r["ci_green"]:
            print(f"{'':6} CI: " + "; ".join(r["ci_problems"]))


def cmd_covered(pkg, ver, ref):
    """npm: every `pkg@...` entry of yarn.lock in REF resolves to >= ver.
    github-actions (pkg with '/', no '@'): every `uses: pkg@vN` in the workflows has N >= major(ver)."""
    if "/" in pkg and not pkg.startswith("@"):
        files = sh("git", "ls-tree", "-r", "--name-only", ref, ".github/workflows").split()
        found = []
        for f in files:
            txt = sh("git", "show", f"{ref}:{f}")
            found += re.findall(rf"uses:\s*{re.escape(pkg)}@v?([\w.]+)", txt)
        if not found:
            print(f"{pkg}: not used in {ref}")
            return 0
        ok = all(semver(v)[0] >= semver(ver)[0] for v in found)
        print(f"{pkg} in {ref}: uses@ {sorted(set(found))} — {'covered' if ok else 'NOT covered'} (target v{semver(ver)[0]})")
        return 0 if ok else 1
    lock = sh("git", "show", f"{ref}:yarn.lock")
    # entry header: `"@scope/pkg@^1.0.0", "@scope/pkg@^1.2.0":` or `pkg@^1.0.0:`
    resolved = []
    for m in re.finditer(r'^"?(' + re.escape(pkg) + r')@[^\n]*:\n  version "([^"]+)"', lock, re.M):
        resolved.append(m.group(2))
    if not resolved:
        print(f"{pkg}: not used in {ref} (no entry in yarn.lock) — nothing to cover; "
              f"check the name, and if the package was removed from the project close the PR as obsolete")
        return 0
    ok = all(semver(v) >= semver(ver) for v in resolved)
    print(f"{pkg} in {ref}: resolved {sorted(set(resolved))} — {'covered' if ok else 'NOT covered'} (target {ver})")
    return 0 if ok else 1


def pr_state(n):
    return gh_json("pr", "view", str(n), "--json",
                   "mergeable,mergeStateStatus,statusCheckRollup,headRefOid,state,baseRefName")


def cmd_wait(n, timeout):
    deadline = time.time() + timeout
    while True:
        p = pr_state(n)
        if p["state"] != "OPEN":
            print(f"#{n}: {p['state']}")
            return 1
        green, bad = checks_summary(p["statusCheckRollup"])
        pending = any((c.get("status") or "").upper() in ("IN_PROGRESS", "QUEUED", "PENDING", "WAITING")
                      or (c.get("state") or "").upper() == "PENDING"
                      for c in p["statusCheckRollup"] or [])
        settled = p["mergeable"] != "UNKNOWN" and not pending
        if settled or time.time() > deadline:
            verdict = "CAN MERGE" if (p["mergeable"] == "MERGEABLE" and green) else "DO NOT MERGE"
            print(f"#{n} ({p['baseRefName']}): mergeable={p['mergeable']} state={p['mergeStateStatus']} "
                  f"checks={'green' if green else 'no'} → {verdict}")
            if bad:
                print("  problems: " + "; ".join(bad))
            if not settled:
                print("  (timeout — state still unsettled)")
            return 0 if verdict == "CAN MERGE" else 1
        time.sleep(20)


def cmd_rebase(n, timeout):
    before = pr_state(n)["headRefOid"]
    sh("gh", "pr", "comment", str(n), "--body", "@dependabot rebase")
    print(f"#{n}: asked @dependabot rebase (head {before[:8]}); waiting for the head to change…")
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(30)
        p = pr_state(n)
        if p["state"] != "OPEN":
            print(f"#{n}: {p['state']} during the rebase")
            return 1
        if p["headRefOid"] != before:
            print(f"#{n}: head now {p['headRefOid'][:8]}; waiting for checks…")
            return cmd_wait(n, timeout)
    print(f"#{n}: Dependabot did not rebase in {timeout}s — see the PR comments; take the manual re-extraction route")
    return 1


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd, args = argv[1], argv[2:]
    if not REQUIRED_CHECKS and cmd in ("list", "wait", "rebase"):
        print('DEPENDABOT_REQUIRED_CHECKS is not set. Put the names of the required checks in the '
              'project\'s .claude/settings.json: {"env": {"DEPENDABOT_REQUIRED_CHECKS": "Lint,Build"}}')
        return 2
    if cmd == "list":
        return cmd_list("--json" in args) or 0
    if cmd == "covered" and len(args) >= 2:
        if " " in args[0] or " " in args[1]:
            print("usage: covered PKG VER [REF] — one package per call")
            return 2
        return cmd_covered(args[0], args[1], args[2] if len(args) > 2 else "origin/develop")
    if cmd in ("wait", "rebase") and args:
        timeout = 900
        if "--timeout" in args:
            timeout = int(args[args.index("--timeout") + 1])
        return (cmd_wait if cmd == "wait" else cmd_rebase)(int(args[0]), timeout)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
