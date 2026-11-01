#!/usr/bin/env python3
"""Helper for the /utils:review-work skill. Read-only; uses only `gh` and `git` — no jq.

  gather.py info [PR] [--base BRANCH] [--diff] [--json | --template]
      the delivery: PR, checks, unresolved review threads, changed files classified, tests next to
      them (by name or by reference), spec sources, cyclomatic complexity of changed functions,
      markers in the added lines (TODO, skipped tests, disabled lint, secret-looking literals, unsafe
      defaults) and the candidate findings derived from all that. --diff appends the filtered diff;
      --template prints the findings file for rate.py with the candidates filled in (severity "?"
      where the table needs judgment; next_step empty, so rate.py rejects it until each is verified).
  gather.py diff [PR] [--base BRANCH] [PATH...]
      the diff without lockfiles, snapshots, build output and vendored code; PATH limits it to those files

PR defaults to the open PR of the current branch. Without one, the branch is compared with its
merge base (commits, uncommitted and untracked work all count) and `gh` is not used.
`--base` on a PR only changes the merge base used to compare complexity with the base.

Exit codes: 0 = ok; 2 = usage or tool error.
"""
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

NOISE_RE = re.compile(r"(\.lock|-lock\.json|-lock\.yaml|go\.sum|\.snap|\.min\.(js|css)|\.pyc)$|(^|/)(dist|build|vendor|__snapshots__|__pycache__|node_modules)/")
TEST_RE = re.compile(r"(^|/)(__tests__|tests?|spec|e2e|cypress|playwright)/|[._-](test|spec|e2e|cy)\.[^/]+$|(^|/)test_[^/]+\.py$|_test\.go$")
E2E_RE = re.compile(r"(^|/)(e2e|cypress|playwright|tests?/(e2e|integration|acceptance))/|\.(e2e|cy)\.[^/]+$")
SPEC_RE = re.compile(r"(^|/)(docs|specs?|\.planning|adrs?|rfcs?)/|(^|/)[^/]*(PLAN|SPEC|ADR)[^/]*\.md$", re.I)
TICKET_RE = re.compile(r"\b(?!UTF|SHA|ISO|RFC|HTTP|RSA|AES|MD|ECMA)[A-Z][A-Z0-9]+-[0-9]+\b")
ISSUE_RE = re.compile(r"(?<![\w/])#(\d+)\b")
HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", re.M)
STYLE_EXT = {".css", ".scss", ".sass", ".less", ".styl"}
DOC_EXT = {".md", ".mdx", ".rst", ".txt", ".adoc"}
ASSET_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mp3", ".pdf"}
CONFIG_EXT = {".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".cfg", ".properties", ".xml"}
CONFIG_NAMES = {"Dockerfile", "Makefile", ".env.example", ".gitignore", ".npmrc", ".nvmrc", ".editorconfig"}
MARKUP_EXT = {".html", ".htm", ".hbs", ".ejs", ".pug", ".liquid", ".njk"}
CODE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".rs", ".java", ".kt", ".kts",
            ".swift", ".php", ".cs", ".c", ".cc", ".cpp", ".h", ".hpp", ".sh", ".bash", ".zsh", ".sql", ".vue",
            ".svelte", ".astro", ".ex", ".exs", ".scala", ".dart", ".lua", ".pl", ".ps1"}
PR_FIELDS = ("number,title,body,url,state,mergeable,baseRefName,headRefName,headRefOid,closingIssuesReferences,"
             "commits,files,additions,deletions,reviews,reviewDecision")
THREADS_QUERY = ("query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n)"
                 "{reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{author{login} body}}}}}}}")


def run(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True)
    except FileNotFoundError:
        return subprocess.CompletedProcess(args, 127, "", f"{args[0]}: not installed")


def sh(*args, check=True):
    r = run(*args)
    if check and r.returncode != 0:
        sys.stderr.write(r.stderr or r.stdout)
        sys.exit(2)
    return r.stdout


def gh_json(*args):
    return json.loads(sh("gh", *args))


def classify(path):
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    if NOISE_RE.search(path):
        return "noise"
    if TEST_RE.search(path) and (ext in CODE_EXT or ext in MARKUP_EXT or ext == ".feature"):
        return "e2e-test" if E2E_RE.search(path) else "test"
    if ext in DOC_EXT:
        return "docs"
    if ext in STYLE_EXT:
        return "style"
    if ext in ASSET_EXT:
        return "asset"
    if ext in MARKUP_EXT:
        return "markup"
    if path.startswith(".github/") or ext in CONFIG_EXT or name in CONFIG_NAMES or name.startswith(".env"):
        return "config"
    if ext in CODE_EXT:
        return "code"
    return "other"


def int0(s):
    return int(s) if s.isdigit() else 0


# ---------- context: PR or branch ----------

def default_base():
    if run("git", "show-ref", "--verify", "-q", "refs/remotes/origin/develop").returncode == 0:
        return "develop"
    r = run("git", "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD")
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip().split("/", 1)[-1]
    r = run("gh", "repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name")
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else "main"


def ensure_remote_branch(base):
    if run("git", "rev-parse", "--verify", "-q", f"origin/{base}").returncode != 0:
        sh("git", "fetch", "-q", "origin", base)


def load_pr(num):
    r = run("gh", "pr", "view", *([str(num)] if num else []), "--json", PR_FIELDS)
    if r.returncode != 0:
        if num:
            sys.stderr.write(r.stderr or r.stdout)
            sys.exit(2)
        return None
    return json.loads(r.stdout)


def resolve(num, base):
    pr = load_pr(num)
    if pr is None:
        base = base or default_base()
        ensure_remote_branch(base)
        mb = sh("git", "merge-base", f"origin/{base}", "HEAD").strip()
        files = []
        for line in sh("git", "diff", "--numstat", mb).splitlines():
            a, d, p = line.split("\t", 2)
            files.append(dict(path=p, additions=int0(a), deletions=int0(d)))
        untracked = [l[3:] for l in sh("git", "status", "--porcelain", "--untracked-files=all").splitlines()
                     if l.startswith("?? ")]
        for p in untracked:
            n = 0
            if os.path.isfile(p):
                with open(p, "rb") as fh:
                    n = fh.read().count(b"\n")
            files.append(dict(path=p, additions=n, deletions=0, untracked=True))
        return dict(
            mode="branch", pr=None, base=base, merge_base=mb, head_sha=None, head_local=True,
            branch=sh("git", "rev-parse", "--abbrev-ref", "HEAD").strip(),
            commits=sh("git", "log", "--oneline", f"{mb}..HEAD").splitlines(),
            messages=sh("git", "log", "--format=%s%n%b", f"{mb}..HEAD"),
            dirty=bool(sh("git", "status", "--porcelain", "--untracked-files=no").strip()),
            untracked=untracked, files=files,
        )
    base = base or pr["baseRefName"]
    sha = pr["headRefOid"]
    head_local = run("git", "cat-file", "-e", f"{sha}^{{commit}}").returncode == 0
    if not head_local:
        head_local = run("git", "fetch", "-q", "origin", f"pull/{pr['number']}/head").returncode == 0 \
            and run("git", "cat-file", "-e", f"{sha}^{{commit}}").returncode == 0
    mb = None
    if head_local:
        ensure_remote_branch(base)
        r = run("git", "merge-base", f"origin/{base}", sha)
        mb = r.stdout.strip() if r.returncode == 0 else None
    files = [dict(path=f["path"], additions=f["additions"], deletions=f["deletions"]) for f in pr["files"]]
    return dict(
        mode="pr", pr=pr, base=base, merge_base=mb, head_sha=sha, head_local=head_local,
        branch=pr["headRefName"],
        commits=[f"{c['oid'][:7]} {c['messageHeadline']}" for c in pr["commits"]],
        messages="\n".join(f"{c['messageHeadline']}\n{c.get('messageBody') or ''}" for c in pr["commits"]),
        dirty=False, untracked=[], files=files,
    )


# ---------- diff ----------

def raw_diff(ctx, explicit_base):
    if ctx["mode"] == "pr" and not explicit_base:
        return sh("gh", "pr", "diff", str(ctx["pr"]["number"]))
    if ctx["mode"] == "pr":
        if not ctx["head_local"]:
            sys.stderr.write("head commit is not available locally; cannot diff against --base\n")
            sys.exit(2)
        return sh("git", "diff", ctx["merge_base"], ctx["head_sha"])
    out = sh("git", "diff", ctx["merge_base"])
    for p in ctx["untracked"]:
        if not os.path.isfile(p):
            continue
        with open(p, "r", errors="replace") as fh:
            body = fh.read()
        lines = body.splitlines()
        out += f"diff --git a/{p} b/{p}\nnew file (untracked)\n--- /dev/null\n+++ b/{p}\n@@ -0,0 +1,{len(lines)} @@\n"
        out += "".join(f"+{line}\n" for line in lines)
    return out


def split_diff(text):
    """[(path, chunk)] per `diff --git` block; path is the b/ side."""
    out = []
    for chunk in re.split(r"(?m)^(?=diff --git )", text):
        if not chunk.strip():
            continue
        m = re.match(r"diff --git a/(.*?) b/(.*)", chunk.splitlines()[0])
        out.append((m.group(2) if m else "", chunk))
    return out


def filter_text(text, paths=()):
    keep = []
    for path, chunk in split_diff(text):
        if paths and path not in paths:
            continue
        if not paths and NOISE_RE.search(path):
            continue
        keep.append(chunk)
    return "".join(keep)


def added_lines(text):
    """(path, new-side line number, content) for every `+` line of the diff."""
    for path, chunk in split_diff(text):
        n = None
        for line in chunk.splitlines():
            m = HUNK_RE.match(line)
            if m:
                n = int(m.group(1))
            elif n is None or line.startswith("\\"):
                continue
            elif line.startswith("+"):
                yield path, n, line[1:]
                n += 1
            elif not line.startswith("-"):
                n += 1


MARKERS = (  # regex on an added line → criterion, severity from the Step 6 table, what it is
    (re.compile(r"\b(TODO|FIXME|HACK)\b"), "Tech debt", "minor", "TODO/FIXME/HACK added"),
    (re.compile(r"\.(skip|only)\(|^\s*x(it|describe|test)\(|@(pytest\.mark\.)?skip\b|\bt\.Skip\(|\bmarkTestSkipped\("),
     "Tech debt", "major", "test skipped or focused"),
    (re.compile(r"eslint-disable|\bnoqa\b|type:\s*ignore|@ts-(ignore|nocheck|expect-error)|rubocop:disable|//\s*nolint|phpcs:ignore"),
     "Tech debt", "major", "lint rule disabled"),
    (re.compile(r"AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|(?i:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['\"][^'\"\s]{8,}['\"]"),
     "Security", "blocker", "secret-looking literal"),
    (re.compile(r"Access-Control-Allow-Origin\W+\*|origin:\s*['\"]\*['\"]|verify\s*=\s*False|rejectUnauthorized:\s*false|InsecureSkipVerify:\s*true|NODE_TLS_REJECT_UNAUTHORIZED"),
     "Security", "major", "unsafe default (open CORS or TLS check disabled)"),
)


def markers(text, files):
    kind = {f["path"]: f["kind"] for f in files}
    out = []
    for path, n, line in added_lines(text):
        if kind.get(path) in (None, "docs", "asset", "noise"):
            continue
        for rx, crit, sev, what in MARKERS:
            if rx.search(line):
                out.append(dict(criterion=crit, severity=sev, where=f"{path}:{n}", summary=f"{what}: `{line.strip()[:80]}`"))
                break
    return out


def changed_ranges(text):
    """{path: [(start, end)]} of new-side line ranges touched by the diff."""
    out = {}
    for path, chunk in split_diff(text):
        for m in HUNK_RE.finditer(chunk):
            start, n = int(m.group(1)), int(m.group(2) or "1")
            out.setdefault(path, []).append((start, start + max(n, 1) - 1))
    return out


# ---------- checks, reviews ----------

def pr_checks(n, required):
    args = ["pr", "checks", str(n), "--json", "name,state,bucket"] + (["--required"] if required else [])
    r = run("gh", *args)
    text = (r.stdout or "") + (r.stderr or "")
    note = "no required checks reported on the base (not the same as passing)" if "no required checks" in text.lower() \
        else None
    rows = []
    try:
        for c in json.loads(r.stdout or "[]"):
            rows.append(dict(name=c.get("name") or "", state=(c.get("bucket") or c.get("state") or "").lower()))
        return rows, note
    except ValueError:
        pass
    for line in text.splitlines():  # older gh: name<TAB>pass|fail|pending|skipping<TAB>elapsed<TAB>url
        parts = line.split("\t")
        if len(parts) >= 2 and parts[1] in ("pass", "fail", "pending", "skipping", "cancel"):
            rows.append(dict(name=parts[0], state=parts[1]))
    return rows, note


def checks(ctx):
    if ctx["mode"] != "pr":
        return dict(required=[], other=[], note="no PR: CI not consulted; say *not verified* for CI-backed claims")
    n = ctx["pr"]["number"]
    req, note = pr_checks(n, True)
    allc, _ = pr_checks(n, False)
    names = {c["name"] for c in req}
    other = [c for c in allc if c["name"] not in names]
    if not req and note is None:
        note = "no required checks reported on the base (not the same as passing)"
    return dict(required=req, other=other, note=note,
                required_failing=[c["name"] for c in req if c["state"] in ("fail", "cancel")],
                other_failing=[c["name"] for c in other if c["state"] in ("fail", "cancel")],
                pending=[c["name"] for c in req + other if c["state"] == "pending"])


def reviews(ctx):
    if ctx["mode"] != "pr":
        return dict(changes_requested=[], unresolved_threads=[], decision=None)
    pr = ctx["pr"]
    last = {}
    for rv in sorted(pr.get("reviews") or [], key=lambda r: r.get("submittedAt") or ""):
        if rv.get("state") in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            last[(rv.get("author") or {}).get("login", "?")] = (rv["state"], (rv.get("submittedAt") or "")[:10])
    cr = [dict(author=a, at=at) for a, (st, at) in last.items() if st == "CHANGES_REQUESTED"]
    r = run("gh", "api", "graphql", "-F", "owner={owner}", "-F", "repo={repo}", "-F", f"n={pr['number']}",
            "-f", f"query={THREADS_QUERY}")
    threads = []
    if r.returncode == 0:
        nodes = json.loads(r.stdout)["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
        for t in nodes:
            if t["isResolved"]:
                continue
            c = (t["comments"]["nodes"] or [{}])[0]
            threads.append(dict(path=t.get("path"), line=t.get("line"),
                                author=(c.get("author") or {}).get("login", "?"),
                                body=(c.get("body") or "").strip()[:400]))
    return dict(changes_requested=cr, unresolved_threads=threads, decision=pr.get("reviewDecision"))


# ---------- files, tests, specs ----------

def repo_listing(ctx):
    if ctx["mode"] == "pr" and ctx["head_local"]:
        return sh("git", "ls-tree", "-r", "--name-only", ctx["head_sha"]).splitlines()
    return sh("git", "ls-files").splitlines() + ctx["untracked"]


GENERIC_STEMS = {"index", "main", "app", "utils", "util", "helpers", "types", "mod", "lib", "init", "__init__",
                 "setup", "config", "constants", "common", "base", "core", "server", "client", "handler", "service"}


def read_at(ctx, path):
    if ctx["mode"] == "pr" and ctx["head_local"]:
        r = run("git", "show", f"{ctx['head_sha']}:{path}")
        return r.stdout if r.returncode == 0 else ""
    try:
        with open(path, "r", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def tests_for(ctx, files, listing):
    changed = {f["path"] for f in files}
    test_files = [p for p in listing if TEST_RE.search(p)]
    # ponytail: reads every test file once to find references; cap keeps huge monorepos fast, name matching still works
    contents = {p: read_at(ctx, p) for p in test_files} if len(test_files) <= 500 else {}
    out = []
    for f in files:
        if f["kind"] != "code":
            continue
        stem = os.path.splitext(os.path.basename(f["path"]))[0]
        pat = re.compile(rf"^(test_)?{re.escape(stem)}([._-](test|spec|e2e|cy|tests)|Tests?)?\.[^.]+$", re.I)
        hits = {p: "name" for p in test_files if pat.match(os.path.basename(p))}
        if len(stem) >= 4 and stem.lower() not in GENERIC_STEMS:
            ref = re.compile(rf"(?<![\w-]){re.escape(stem)}(?![\w-])")
            hits.update({p: "ref" for p, text in contents.items() if p not in hits and p != f["path"] and ref.search(text)})
        out.append(dict(path=f["path"], tests=[dict(path=p, changed=p in changed, by=by) for p, by in sorted(hits.items())]))
    e2e_dirs = sorted({m.group(0).strip("/") for p in listing for m in [E2E_RE.search(p)] if m and m.group(0).endswith("/")})
    e2e_changed = [f["path"] for f in files if f["kind"] == "e2e-test"]
    return dict(by_file=out, e2e_dirs=e2e_dirs, e2e_changed=e2e_changed,
                tests_changed=[f["path"] for f in files if f["kind"] == "test"])


def spec_sources(ctx, files, listing):
    pr = ctx["pr"] or {}
    body = pr.get("body") or ""
    text = "\n".join([ctx["branch"], pr.get("title") or "", body, ctx["messages"]])
    tickets = sorted(set(TICKET_RE.findall(text)))
    nums, seen = [], set()
    for n in [i["number"] for i in pr.get("closingIssuesReferences") or []] + [int(m) for m in ISSUE_RE.findall(body)]:
        if n not in seen and n != pr.get("number"):
            seen.add(n)
            nums.append(n)
    issues = []
    for n in nums[:5]:
        r = run("gh", "issue", "view", str(n), "--json", "number,title,body,comments")
        if r.returncode != 0:
            issues.append(dict(number=n, error=(r.stderr or "").strip()[:120]))
            continue
        i = json.loads(r.stdout)
        issues.append(dict(number=n, title=i["title"], body=(i.get("body") or "").strip(),
                           closing=any(c["number"] == n for c in pr.get("closingIssuesReferences") or []),
                           comments=[dict(author=(c.get("author") or {}).get("login", "?"),
                                          body=(c.get("body") or "").strip()[:1500]) for c in i.get("comments") or []]))
    in_diff = [f["path"] for f in files if SPEC_RE.search(f["path"])]
    named = [p for p in listing if tickets and any(t.lower() in p.lower() for t in tickets) and p not in in_diff]
    return dict(tickets=tickets, issues=issues, spec_files_in_diff=in_diff, repo_files_named_after_tickets=named[:20],
                pr_body=body)


# ---------- complexity ----------

def materialize(ctx, path, side, root):
    dst = os.path.join(root, side, path)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if side == "head" and ctx["mode"] == "branch":
        if not os.path.isfile(path):
            return False
        shutil.copyfile(path, dst)
        return True
    ref = ctx["head_sha"] if side == "head" else ctx["merge_base"]
    if not ref:
        return False
    r = run("git", "show", f"{ref}:{path}")
    if r.returncode != 0:
        return False
    with open(dst, "w") as fh:
        fh.write(r.stdout)
    return True


def measure(tool, root):
    """{(relpath, function): (ccn, start, end)}"""
    out = {}
    if tool == "lizard":
        r = run("lizard", "--csv", root)
        for row in csv.reader(io.StringIO(r.stdout)):
            if len(row) < 11:
                continue
            rel = os.path.relpath(row[6], root)
            out[(rel, row[7])] = (int(row[1]), int(row[9]), int(row[10]))
    elif tool == "radon":
        r = run("radon", "cc", "-j", root)
        try:
            data = json.loads(r.stdout or "{}")
        except ValueError:
            data = {}
        for f, items in data.items():
            if not isinstance(items, list):
                continue
            for it in items:
                name = f"{it['classname']}.{it['name']}" if it.get("classname") else it["name"]
                out[(os.path.relpath(f, root), name)] = (it["complexity"], it["lineno"], it.get("endline", it["lineno"]))
    elif tool == "gocyclo":
        r = run("gocyclo", root)
        for line in r.stdout.splitlines():
            m = re.match(r"(\d+) \S+ (\S+) (.+):(\d+):\d+", line)
            if m:
                out[(os.path.relpath(m.group(3), root), m.group(2))] = (int(m.group(1)), int(m.group(4)), None)
    return out


def complexity(ctx, files, ranges):
    code = [f["path"] for f in files if f["kind"] == "code"]
    if not code:
        return dict(tools=[], functions=[], note="no code files changed")
    tools = [t for t in ("lizard", "radon", "gocyclo") if shutil.which(t)]
    if not tools:
        return dict(tools=[], functions=[], note="no complexity tool installed (lizard, radon, gocyclo); count decision points by hand")
    if ctx["mode"] == "pr" and not ctx["head_local"]:
        return dict(tools=tools, functions=[], note="head commit not available locally; count decision points by hand")
    tools = ["lizard"] if "lizard" in tools else tools
    root = tempfile.mkdtemp(prefix="review-work-")
    try:
        have_base = False
        for p in code:
            materialize(ctx, p, "head", root)
            have_base |= materialize(ctx, p, "base", root)
        head, base = {}, {}
        for t in tools:
            head.update(measure(t, os.path.join(root, "head")))
            if have_base:
                base.update(measure(t, os.path.join(root, "base")))
    finally:
        shutil.rmtree(root, ignore_errors=True)
    funcs = []
    for (path, name), (ccn, start, end) in head.items():
        b = base.get((path, name))
        touched = None
        if end is not None:
            touched = any(s <= end and e >= start for s, e in ranges.get(path, []))
        funcs.append(dict(file=path, function=name, ccn=ccn, base_ccn=b[0] if b else None, line=start,
                          touched=touched))
    funcs.sort(key=lambda f: (-f["ccn"], f["file"], f["line"]))
    note = None if have_base else "base versions not available; base_ccn is empty"
    return dict(tools=tools, measured=len(funcs), functions=[f for f in funcs if f["ccn"] >= 11], note=note)


# ---------- candidates ----------

CHECK_CRITERIA = (("e2e playwright cypress acceptance", "Tests (e2e)"),
                  ("test jest pytest vitest spec unit coverage", "Tests (unit)"),
                  ("lint prettier format type tsc mypy style", "Readability & conventions"),
                  ("audit security snyk codeql trivy", "Security"))


def check_criterion(name):
    n = name.lower()
    return next((crit for words, crit in CHECK_CRITERIA if any(w in n for w in words.split())), "?")


def candidates(d):
    """Findings the facts suggest; severity "?" where the Step 6 table needs judgment. All still need Step 5."""
    out = []
    c = d["checks"]
    for name in c.get("required_failing") or []:
        out.append(dict(criterion=check_criterion(name), severity="blocker", where=f"CI: {name}", summary="required check failing"))
    for name in c.get("other_failing") or []:
        out.append(dict(criterion=check_criterion(name), severity="major", where=f"CI: {name}", summary="check failing (not required)"))
    for row in d["tests"]["by_file"]:
        if not row["tests"]:
            out.append(dict(criterion="Tests (unit)", severity="major", where=row["path"], summary="no test file names or references it"))
        elif not any(h["changed"] for h in row["tests"]):
            out.append(dict(criterion="Tests (unit)", severity="?", where=row["path"],
                            summary="tests exist but none changed: " + ", ".join(h["path"] for h in row["tests"])))
    for t in d["reviews"]["unresolved_threads"]:
        where = f"{t['path']}:{t['line']}" if t.get("line") else (t.get("path") or "(general)")
        first = t["body"].splitlines()[0] if t["body"] else ""
        out.append(dict(criterion="?", severity="?", where=where, summary=f"unresolved thread @{t['author']}: {first[:120]}"))
    for f in d["complexity"]["functions"]:
        if f["touched"] is False or (f["base_ccn"] is not None and f["ccn"] <= f["base_ccn"]):
            continue
        out.append(dict(criterion="Cyclomatic complexity", severity="major" if f["ccn"] > 20 else "minor",
                        where=f"{f['file']}:{f['line']}",
                        summary=f"`{f['function']}` at CCN {f['ccn']} (base {f['base_ccn'] if f['base_ccn'] is not None else '-'})"))
    out += d["markers"]
    for x in out:
        x["next_step"] = ""
    return out


def template(d):
    p = d["pr"]
    nv = []
    if d["checks"].get("pending"):
        nv.append("pending checks: " + ", ".join(d["checks"]["pending"]))
    if d["mode"] == "branch":
        nv.append("no PR: CI not consulted")
    return dict(title=f"{p['title']} (#{p['number']})" if p else f"{d['branch']} vs {d['base']}", lang="en", na={},
                summaries={}, findings=d["candidates"], not_verified=nv,
                conflicts=d["base"] if p and p["mergeable"] == "CONFLICTING" else None)


# ---------- info ----------

def info(ctx, explicit_base):
    for f in ctx["files"]:
        f["kind"] = classify(f["path"])
    files = ctx["files"]
    listing = repo_listing(ctx)
    diff = filter_text(raw_diff(ctx, explicit_base))
    d = dict(
        mode=ctx["mode"], pr=ctx["pr"] and {k: ctx["pr"][k] for k in ("number", "title", "url", "state", "mergeable",
                                                                        "baseRefName", "headRefName", "headRefOid",
                                                                        "additions", "deletions")},
        branch=ctx["branch"], base=ctx["base"], merge_base=ctx["merge_base"], commits=ctx["commits"],
        includes_uncommitted=ctx["dirty"], untracked=ctx["untracked"],
        checks=checks(ctx), reviews=reviews(ctx), files=files,
        tests=tests_for(ctx, files, listing), spec=spec_sources(ctx, files, listing),
        complexity=complexity(ctx, files, changed_ranges(diff)), markers=markers(diff, files),
    )
    d["candidates"] = candidates(d)
    d["diff"] = diff
    return d


def print_info(d, show_diff=False):
    p = d["pr"]
    if p:
        print(f"PR #{p['number']} \"{p['title']}\" state={p['state']} mergeable={p['mergeable']} "
              f"base={p['baseRefName']} head={p['headRefName']} ({p['headRefOid'][:7]}) +{p['additions']} −{p['deletions']}")
        print(p["url"])
    else:
        extra = []
        if d["includes_uncommitted"]:
            extra.append("UNCOMMITTED changes")
        if d["untracked"]:
            extra.append(f"{len(d['untracked'])} UNTRACKED file(s)")
        print(f"No PR. Branch {d['branch']} vs origin/{d['base']} (merge base {d['merge_base'][:7]}), "
              f"{len(d['commits'])} commit(s)" + (", includes " + " and ".join(extra) if extra else ""))

    print(f"\n== Commits ({len(d['commits'])})")
    for c in d["commits"][:30]:
        print(f"  {c}")
    if len(d["commits"]) > 30:
        print(f"  … +{len(d['commits']) - 30}")

    c = d["checks"]
    print("\n== Checks")
    for label in ("required", "other"):
        rows = c.get(label) or []
        print(f"  {label} ({len(rows)}): " + ("  ".join(f"{r['name']}={r['state']}" for r in rows) or "none"))
    if c.get("required_failing"):
        print("  BLOCKER candidate: failing required check(s): " + ", ".join(c["required_failing"]))
    if c.get("other_failing"):
        print("  major candidate (in the criterion it covers): " + ", ".join(c["other_failing"]))
    if c.get("pending"):
        print("  pending → not verified: " + ", ".join(c["pending"]))
    if c.get("note"):
        print(f"  note: {c['note']}")

    r = d["reviews"]
    print(f"\n== Reviews (decision={r['decision'] or '-'})")
    print("  changes requested, no later approval: " +
          (", ".join(f"{x['author']} ({x['at']})" for x in r["changes_requested"]) or "none"))
    print(f"  unresolved threads ({len(r['unresolved_threads'])}):" if r["unresolved_threads"] else "  unresolved threads: none")
    for t in r["unresolved_threads"]:
        where = f"{t['path']}:{t['line']}" if t.get("line") else (t.get("path") or "(general)")
        print(f"    {where} @{t['author']}: {t['body'].splitlines()[0] if t['body'] else ''}")

    noise = [f for f in d["files"] if f["kind"] == "noise"]
    print(f"\n== Files ({len(d['files'])}, {len(noise)} noise skipped by `diff`)")
    for f in d["files"]:
        flag = " (untracked)" if f.get("untracked") else ""
        print(f"  {f['kind']:9} {f['path']}  +{f['additions']} −{f['deletions']}{flag}")

    t = d["tests"]
    print("\n== Tests")
    for row in t["by_file"]:
        hits = ", ".join(f"{h['path']} ({'changed' if h['changed'] else 'unchanged'}, by {h['by']})" for h in row["tests"]) or "none"
        print(f"  {row['path']} → {hits}")
    if not t["by_file"]:
        print("  no code files changed")
    print("  e2e suites: " + (", ".join(t["e2e_dirs"]) or "none found") +
          "; e2e files changed: " + (", ".join(t["e2e_changed"]) or "none"))

    s = d["spec"]
    print("\n== Spec sources")
    print("  tickets: " + (", ".join(s["tickets"]) or "none"))
    print("  spec files in diff: " + (", ".join(s["spec_files_in_diff"]) or "none"))
    print("  repo files named after tickets: " + (", ".join(s["repo_files_named_after_tickets"]) or "none"))
    for i in s["issues"]:
        if i.get("error"):
            print(f"  issue #{i['number']}: {i['error']}")
            continue
        print(f"  issue #{i['number']} \"{i['title']}\"{' (closing)' if i['closing'] else ''}:")
        print("    " + (i["body"].replace("\n", "\n    ") or "(empty body)"))
        for cm in i["comments"]:
            print(f"    -- @{cm['author']}: " + cm["body"].replace("\n", "\n       "))
    if not s["issues"]:
        print("  linked issues: none")
    print("\n== PR body")
    print("  " + (s["pr_body"].replace("\n", "\n  ") if s["pr_body"].strip() else "(empty)"))

    cx = d["complexity"]
    head = f"== Complexity ({', '.join(cx['tools']) or 'no tool'}" + (f"; {cx['measured']} function(s) measured" if "measured" in cx else "") + ")"
    print("\n" + head)
    if cx.get("note"):
        print(f"  note: {cx['note']}")
    if cx["functions"]:
        print(f"  {'CCN':>4} {'base':>4}  where  function  [touched by the diff?]")
        for f in cx["functions"]:
            b = f["base_ccn"] if f["base_ccn"] is not None else "-"
            touched = {True: "touched", False: "not touched", None: "?"}[f["touched"]]
            print(f"  {f['ccn']:>4} {b:>4}  {f['file']}:{f['line']}  {f['function']}  [{touched}]")
    elif "measured" in cx:
        print("  no function at CCN ≥ 11")

    print(f"\n== Candidates ({len(d['candidates'])}; every one still needs Step 5; ? = decide from the table)")
    for x in d["candidates"]:
        print(f"  [{x['severity']}] {x['criterion']} — {x['where']}: {x['summary']}")
    if not d["candidates"]:
        print("  none from the facts; the diff still needs reading")

    if show_diff:
        print("\n== Diff")
        sys.stdout.write(d["diff"])


def main(argv):
    if len(argv) < 2 or argv[1] not in ("info", "diff"):
        print(__doc__)
        return 2
    cmd, args = argv[1], argv[2:]
    base = None
    if "--base" in args:
        i = args.index("--base")
        if i + 1 >= len(args):
            print(__doc__)
            return 2
        base = args[i + 1]
        del args[i:i + 2]
    flags = {a for a in args if a.startswith("--")}
    args = [a for a in args if not a.startswith("--")]
    num = int(args.pop(0)) if args and args[0].isdigit() else None
    if flags - {"--json", "--diff", "--template"} or (cmd == "diff" and flags):
        print(__doc__)
        return 2
    ctx = resolve(num, base)
    if cmd == "diff":
        sys.stdout.write(filter_text(raw_diff(ctx, base is not None), set(args)))
        return 0
    if args:
        print(__doc__)
        return 2
    d = info(ctx, base is not None)
    if "--template" in flags:
        print(json.dumps(template(d), indent=2, ensure_ascii=False))
    elif "--json" in flags:
        if "--diff" not in flags:
            del d["diff"]
        print(json.dumps(d, indent=2, ensure_ascii=False))
    else:
        print_info(d, "--diff" in flags)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
