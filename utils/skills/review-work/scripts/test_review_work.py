#!/usr/bin/env python3
"""Self-check for gather.py and rate.py (no git, no gh): python3 test_review_work.py"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gather
import rate

DIFF = """diff --git a/src/a.py b/src/a.py
--- a/src/a.py
+++ b/src/a.py
@@ -10,3 +10,5 @@
 keep
-old
+new  # TODO later
+x = 1
 keep
@@ -30,2 +32,2 @@
+verify = False
 end
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
+TODO docs
"""
FILES = [dict(path="src/a.py", kind="code"), dict(path="README.md", kind="docs")]

# added lines carry the new-side line number across hunks and files
assert list(gather.added_lines(DIFF)) == [("src/a.py", 11, "new  # TODO later"), ("src/a.py", 12, "x = 1"),
                                          ("src/a.py", 32, "verify = False"), ("README.md", 1, "TODO docs")]

# markers: one per line, docs skipped
m = gather.markers(DIFF, FILES)
assert [(x["criterion"], x["severity"], x["where"]) for x in m] == \
    [("Tech debt", "minor", "src/a.py:11"), ("Security", "major", "src/a.py:32")], m

# candidates: checks → criterion by name, untested code, unchanged tests, complexity only when grown
d = dict(checks=dict(required_failing=["ci / pytest"], other_failing=["lint"]),
         tests=dict(by_file=[dict(path="src/a.py", tests=[]),
                             dict(path="src/b.py", tests=[dict(path="t/b_test.py", changed=False, by="name")])]),
         reviews=dict(unresolved_threads=[]),
         complexity=dict(functions=[dict(file="src/a.py", function="f", ccn=25, base_ccn=12, line=3, touched=True),
                                    dict(file="src/a.py", function="g", ccn=12, base_ccn=15, line=9, touched=True)]),
         markers=m)
c = gather.candidates(d)
assert [(x["criterion"], x["severity"]) for x in c] == [
    ("Tests (unit)", "blocker"), ("Readability & conventions", "major"), ("Tests (unit)", "major"),
    ("Tests (unit)", "?"), ("Cyclomatic complexity", "major"), ("Tech debt", "minor"), ("Security", "major")], c
assert all(x["next_step"] == "" for x in c)

# tests_for: by name (incl. FooTest), by reference, generic stems never by reference
tmp = tempfile.mkdtemp(prefix="review-work-test-")
os.chdir(tmp)
os.makedirs("tests")
with open("tests/test_flow.py", "w") as fh:
    fh.write("from src.gather import run\nimport index\n")
ctx = dict(mode="branch", head_local=True, head_sha=None)
listing = ["src/gather.py", "src/index.py", "src/Order.java", "tests/test_flow.py", "tests/test_index.py", "tests/OrderTest.java"]
t = gather.tests_for(ctx, [dict(path=p, kind="code") for p in listing[:3]], listing)
got = {row["path"]: [(h["path"], h["by"]) for h in row["tests"]] for row in t["by_file"]}
assert got == {"src/gather.py": [("tests/test_flow.py", "ref")], "src/index.py": [("tests/test_index.py", "name")],
               "src/Order.java": [("tests/OrderTest.java", "name")]}, got

# rate: a "?" left from the template or an empty next_step is rejected; a blocker caps the overall
bad = dict(findings=[dict(criterion="Tech debt", severity="?", where="a", summary="s", next_step="")])
errs = rate.validate(bad)
assert any("next_step" in e for e in errs) and any("candidate" in e for e in errs), errs
ok = dict(na={"Tests (e2e)": "x"}, findings=[dict(criterion="Security", severity="blocker", where="a", summary="s", next_step="n")])
assert rate.validate(ok) == []
r = rate.compute(ok)
assert r["capped"] and r["overall"] == 4.0 and r["uncapped"] > 4.0, r

# status icon: boundaries at 9.0 and 7.0, overall row included
assert [rate.icon(x) for x in (10, 9.0, 8.95, 8.9, 7.0, 6.9, 0)] == ["✅", "✅", "✅", "⚠️", "⚠️", "❌", "❌"]
lines = rate.report(ok, r).splitlines()
assert lines[0] == "| | Item | Summary | Rate |" and lines[2].startswith("| ✅ | Spec match |"), lines[:3]
assert any(l.startswith("| ❌ | Security |") for l in lines) and any(l.startswith("| ❌ | **Overall** |") for l in lines), lines
print("ok")
