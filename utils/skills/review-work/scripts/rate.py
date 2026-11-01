#!/usr/bin/env python3
"""Helper for the /utils:review-work skill. Turns verified findings into the rates and the report.

  rate.py report FILE [--json]        validates FILE, computes every rate and prints the report
                                      (FILE may be `-` for stdin)

The findings file is JSON (`gather.py info --template` prints it with the candidates filled in):

  {
    "title": "Add CSV export (#123)",
    "lang": "en",                                   // "en" or "pt"; other languages: translate the output
    "na": {"Tests (e2e)": "style-only change"},     // criteria from Step 3 that do not apply, with the reason
    "summaries": {"Spec match": "5 of 6 requirements done; #4 (export CSV) missing"},   // optional, per criterion
    "findings": [
      {"criterion": "Tests (unit)", "severity": "major", "where": "src/pay.ts:42",
       "summary": "error path of `chargeCard` not asserted", "next_step": "Assert the declined-card branch in pay.test.ts"}
    ],
    "not_verified": ["CI never ran: lint result unknown"],   // optional
    "conflicts": "develop"                                   // optional: base the PR conflicts with
  }

Rules applied: 10.0 − fixed deduction per finding (blocker 6, major 3, minor 1, nit 0.5), floor 0.0;
overall = weighted average (Spec match 3, Security 2, Tests (unit) 2, Tests (e2e) 1.5, others 1) of
the applicable criteria; a blocker caps the overall at 4.0. A finding in an N/A criterion, an unknown
criterion or severity, or the same cause in two criteria is an error.

Exit codes: 0 = ok; 1 = invalid findings file; 2 = usage.
"""
import json
import sys
from decimal import Decimal, ROUND_HALF_UP

CRITERIA = [  # rubric order, weight
    ("Spec match", 3), ("Tests (unit)", 2), ("Tests (e2e)", 1.5), ("Security", 2), ("Cyclomatic complexity", 1),
    ("Tech debt", 1), ("Error handling & edge cases", 1), ("Performance", 1), ("Readability & conventions", 1),
    ("Scope & size", 1), ("Backward compatibility", 1), ("Documentation", 1),
]
WEIGHT = dict(CRITERIA)
DEDUCT = {"blocker": 6.0, "major": 3.0, "minor": 1.0, "nit": 0.5}
ORDER = {"blocker": 0, "major": 1, "minor": 2, "nit": 3}
BLOCKER_CAP = 4.0
L10N = {
    "en": dict(cols=("Item", "Summary", "Rate"), overall="Overall", blocker="Blocker", na="Not applicable",
               nv="Not verified", conflicts="Conflicts with", rebase="rebase before merge", next="Next steps",
               next_cols=("Severity", "Item", "Where", "Next step"), none="No verified finding.",
               ok="no finding", cap="overall capped at", sev=dict(blocker="Blocker", major="Major", minor="Minor", nit="Nit"),
               crit={}),
    "pt": dict(cols=("Item", "Resumo", "Nota"), overall="Geral", blocker="Bloqueador", na="Não se aplica",
               nv="Não verificado", conflicts="Conflitos com", rebase="fazer rebase antes do merge",
               next="Próximos passos", next_cols=("Severidade", "Item", "Onde", "Próximo passo"),
               none="Nenhum achado verificado.", ok="sem achados", cap="nota geral limitada a",
               sev=dict(blocker="Bloqueador", major="Maior", minor="Menor", nit="Nit"),
               crit={"Spec match": "Aderência à spec", "Tests (unit)": "Testes (unitários)", "Tests (e2e)": "Testes (e2e)",
                     "Security": "Segurança", "Cyclomatic complexity": "Complexidade ciclomática",
                     "Tech debt": "Dívida técnica", "Error handling & edge cases": "Tratamento de erros e casos de borda",
                     "Performance": "Performance", "Readability & conventions": "Legibilidade e convenções",
                     "Scope & size": "Escopo e tamanho", "Backward compatibility": "Compatibilidade retroativa",
                     "Documentation": "Documentação"}),
}


def one_decimal(x):
    return float(Decimal(str(x)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def fmt(x):
    return f"{one_decimal(x):.1f}"


def validate(d):
    errors = []
    if not isinstance(d, dict):
        return ["the file must contain a JSON object"]
    na = d.get("na") or {}
    if not isinstance(na, dict):
        errors.append('"na" must be an object {criterion: reason}')
        na = {}
    for c in na:
        if c not in WEIGHT:
            errors.append(f'unknown criterion in "na": {c!r}')
    if len(na) >= len(WEIGHT) or "Spec match" in na or "Scope & size" in na:
        errors.append("Spec match and Scope & size always apply")
    findings = d.get("findings")
    if not isinstance(findings, list):
        errors.append('"findings" must be a list (empty when there is none)')
        findings = []
    seen = {}
    for i, f in enumerate(findings):
        tag = f"finding {i + 1}"
        if not isinstance(f, dict):
            errors.append(f"{tag}: must be an object")
            continue
        for k in ("criterion", "severity", "where", "summary", "next_step"):
            if not str(f.get(k) or "").strip():
                errors.append(f'{tag}: missing "{k}"')
        c, s = f.get("criterion"), str(f.get("severity") or "").lower()
        if c not in WEIGHT:
            errors.append(f"{tag}: unknown criterion {c!r}")
        elif c in na:
            errors.append(f"{tag}: {c} is N/A; once a criterion applies a gap is a finding, once it is N/A it has none")
        if s not in DEDUCT:
            errors.append(f"{tag}: severity must be one of {', '.join(DEDUCT)}" +
                          (" (a candidate left unverified: decide it from the Step 6 table or delete it)" if s == "?" else ""))
        f["severity"] = s
        key = (str(f.get("where", "")).strip(), str(f.get("summary", "")).strip().lower())
        if key in seen and seen[key] != c:
            errors.append(f"{tag}: same cause as a finding in {seen[key]!r}; one finding, one criterion")
        seen.setdefault(key, c)
    for c in d.get("summaries") or {}:
        if c not in WEIGHT:
            errors.append(f'unknown criterion in "summaries": {c!r}')
    if d.get("lang", "en") not in L10N:
        errors.append(f'"lang" must be one of {", ".join(L10N)}; translate the output for other languages')
    return errors


def compute(d):
    na = d.get("na") or {}
    findings = d.get("findings") or []
    summaries = d.get("summaries") or {}
    rows, total, wsum = [], 0.0, 0.0
    for c, w in CRITERIA:
        if c in na:
            continue
        mine = [f for f in findings if f["criterion"] == c]
        rate = max(0.0, 10.0 - sum(DEDUCT[f["severity"]] for f in mine))
        rate = one_decimal(rate)
        rows.append(dict(criterion=c, weight=w, rate=rate, findings=len(mine),
                         summary=summaries.get(c) or "; ".join(f["summary"] for f in mine)))
        total += rate * w
        wsum += w
    overall = one_decimal(total / wsum) if wsum else 0.0
    blockers = [f for f in findings if f["severity"] == "blocker"]
    capped = bool(blockers) and overall > BLOCKER_CAP
    return dict(rows=rows, overall=min(overall, BLOCKER_CAP) if blockers else overall, uncapped=overall,
                capped=capped, blockers=blockers,
                findings=sorted(findings, key=lambda f: (ORDER[f["severity"]], CRITERIA_INDEX[f["criterion"]], f["where"])))


CRITERIA_INDEX = {c: i for i, (c, _) in enumerate(CRITERIA)}


def icon(rate):
    """✅ 9.0+, ⚠️ 7.0–8.9, ❌ 0.0–6.9 (on the one-decimal rate)."""
    rate = one_decimal(rate)
    return "✅" if rate >= 9.0 else "⚠️" if rate >= 7.0 else "❌"


def cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ").strip()


def report(d, r):
    t = L10N[d.get("lang", "en")]
    name = lambda c: t["crit"].get(c, c)  # noqa: E731
    out = []
    if d.get("title"):
        out.append(f"## {d['title']}\n")
    out.append(f"| | {t['cols'][0]} | {t['cols'][1]} | {t['cols'][2]} |\n|---|---|---|---|")
    for row in r["rows"]:
        out.append(f"| {icon(row['rate'])} | {name(row['criterion'])} | {cell(row['summary'] or t['ok'])} | {fmt(row['rate'])} |")
    out.append(f"| {icon(r['overall'])} | **{t['overall']}** | | **{fmt(r['overall'])}** |\n")
    if r["blockers"]:
        what = "; ".join(f"{name(f['criterion'])} — {f['summary']} (`{f['where']}`)" for f in r["blockers"])
        cap = f" — {t['cap']} {fmt(BLOCKER_CAP)}" if r["capped"] else ""
        out.append(f"{t['blocker']}: {what}{cap}.")
    na = d.get("na") or {}
    if na:
        reasons = sorted(set(na.values()))
        items = ", ".join(name(c) for c, _ in CRITERIA if c in na)
        out.append(f"{t['na']}: {items} — {'; '.join(reasons)}.")
    if d.get("not_verified"):
        out.append(f"{t['nv']}: " + "; ".join(d["not_verified"]) + ".")
    if d.get("conflicts"):
        out.append(f"{t['conflicts']} `{d['conflicts']}` ({t['rebase']}).")
    out.append(f"\n### {t['next']}\n")
    if not r["findings"]:
        out.append(t["none"])
    else:
        h = t["next_cols"]
        out.append(f"| {h[0]} | {h[1]} | {h[2]} | {h[3]} |\n|---|---|---|---|")
        for f in r["findings"]:
            out.append(f"| {t['sev'][f['severity']]} | {name(f['criterion'])} | `{cell(f['where'])}` | {cell(f['next_step'])} |")
    return "\n".join(out) + "\n"


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd, args = argv[1], argv[2:]
    if cmd != "report" or not args:
        print(__doc__)
        return 2
    src = sys.stdin if args[0] == "-" else open(args[0])
    try:
        d = json.load(src)
    except ValueError as e:
        print(f"invalid JSON: {e}")
        return 1
    finally:
        if src is not sys.stdin:
            src.close()
    errors = validate(d)
    if errors:
        print("findings file rejected:\n  " + "\n  ".join(errors))
        return 1
    r = compute(d)
    if "--json" in args:
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0
    sys.stdout.write(report(d, r))
    terms = " + ".join(f"{fmt(row['rate'])}×{row['weight']:g}" for row in r["rows"])
    sys.stderr.write(f"overall = ({terms}) / {sum(row['weight'] for row in r['rows']):g} = {fmt(r['uncapped'])}"
                     + (f" → capped at {fmt(BLOCKER_CAP)} (blocker)" if r["capped"] else "") + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
