# Map the code into placeholders: instructions

You map the code into placeholder runbooks, one per flow no runbook cites yet. The parameters are in `${CLAUDE_PLUGIN_ROOT}/commands/map.md`.

You cannot ask the user. Where this file says to ask (`AskUserQuestion`, "ask the user", a diff approval), stop with `status: question` as `agents.md` says. Where it says to say something and stop, put the message in `summary:` and report `status: done`. Commit nothing: the main session commits after it prints your summary.

The filter in your brief (`<filter>` below) is what the user typed: `--capability x`, `--slice name`, `--path glob`, or nothing.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/format.md`.

A placeholder is a runbook with frontmatter and a Goal but no steps (`status: placeholder`). It marks a flow that still needs a runbook. `/runbooks:create` fills it later. This command writes new placeholders only and never edits an existing runbook, placeholders included, so running it again maps only what is still unmapped.

## 1. Find what no runbook cites

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" coverage <filter> --json`. Exit code 2 stops the command; show the message. Keep the numbers for step 4.
2. `entries.uncovered` and `requirements.uncovered` are the items no runbook cites in any status. Map only these. Slice and path filters reach entries only, so with a filter, map a requirement only when it belongs to a flow mapped in this scope.
3. `... list --status placeholder --json`: the existing placeholders. An `orphans` item whose runbook is one of them is a stale placeholder for step 4.

4. Existing tests: every test file in the project, of any library (Playwright, Cypress, Jest, Vitest, PHPUnit, Pest, ...), whether `to-test` wrote it or not. Look in each `tests.<surface>.dir` (in its `root`) and across the project for the usual names (`*.spec.*`, `*.test.*`, `*.cy.*`, `*Test.php`, `tests/**`, `e2e/**`, `__tests__/**`), skipping `node_modules`, `vendor` and build output. For each file, write down the entries it exercises: the routes it visits and the endpoints it calls, matched to entry ids from `... entries --json`. A file that calls no entry but tests the code behind one (the handler, use case, repository or service an entry's route reaches) gets those entries too, marked "below the endpoint".

Done when you hold the uncovered entries and requirements, the stale placeholders, and the existing tests with the entries each one exercises.

## 2. Group into flows

For each uncovered entry, read its code: the page and its components, the API endpoints it calls, the route guards and navigation config. Group the entries into flows (`references/format.md`, Flow), one placeholder per flow:

- `ui` flows, when the stack has `ui`: what a user goes through on screens (`list-deliveries`: the list page, the detail page and the endpoints they call; `issue-invoice`: the form and its POST).
- `api` flows, when the stack has `api`: one per business operation, a write endpoint plus the reads that prove its effect (`create-invoice`: `POST /invoices` and `GET /invoices/{id}`), and one per read with logic of its own (`list-invoices`). Webhooks and internal endpoints are `api` flows too. An endpoint is uncovered here even when a `ui` runbook cites it, because only `api` runbooks cover endpoints in this stack (`references/coverage.md`, By surface).

- Endpoints of an upstream API in another repository are not entries here, so they are never mapped. A `ui` placeholder lists the ones its screens reach in `calls` (`references/format.md`, the `calls` key).
- Every uncovered entry goes into at least one placeholder. On a `frontend` stack, an entry no user flow reaches through the UI (webhook, cron, health check, internal endpoint) goes on the not-mapped list with the reason. On any stack, a health check or an endpoint with no behavior worth proving does too.
- Every uncovered requirement goes into the placeholder of the flow it describes, or on the not-mapped list with the reason.
- `covers` lists every entry and requirement the flow touches, including ones other runbooks already cite.
- `capability` is the slice of the flow's main entry; without a slice, its first route segment after dropped segments and groups. The flow name is kebab-case verb-object. The id must not clash with any existing runbook.

Then fit the existing tests from step 1 to the flows. A test file represents a flow when it exercises any of the flow's entries for the behavior the flow proves, even when it covers only part of the flow (only the main path, only the POST, no edge case). A file can represent several flows. A file that calls the flow's entries is a candidate script. A file marked "below the endpoint" is evidence only: its assertions describe the flow's rules, but it cannot run the runbook's steps, so it is never offered for adoption. A file that fits a flow an existing runbook already holds goes on the existing-runbook list instead, because this command never edits a runbook. A file that fits no flow goes on the unfitted list with the reason (a unit test of a helper, a test of an entry outside this scope).

Done when every uncovered item is in a placeholder or on the not-mapped list with its reason, and every existing test is fitted to a flow, on the existing-runbook list, or on the unfitted list.

## 3. Write the placeholders

Path `<paths.runbooks>/<capability>/<flow>.md`, from `${CLAUDE_PLUGIN_ROOT}/templates/placeholder.md`:

- `surface`: `ui` or `api`, from the group the flow came from;
- `title` and `Goal`: the user outcome or business operation, in the config language;
- `roles`: with role tracking off, the account roles the guards let in, when the code shows them, otherwise `[]`. With role tracking on, `all`, because the placeholder template writes it and `create` decides the roles later;
- `covers.entries` and `covers.requirements`: ids exactly as the script printed them;
- `calls`, for a `ui` flow whose screens reach an upstream API in another repository: the operations the code calls, left out when there are none;
- `scripts`: the candidate scripts fitted to the flow in step 2, paths relative to the project root. In a placeholder they are candidates, not adopted scripts: `create` reads them as evidence, and `to-test` asks before adopting each one;
- `sources`: `map <short sha of HEAD>`, followed by the evidence-only test files fitted to the flow.

Then run `... list --json` and confirm every new placeholder has an empty `problems` list, and `... coverage <filter> --json` and confirm every item from step 1 is now `planned` or on the not-mapped list.

## 4. Report

Your report follows "The report" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`. List in `files:` every placeholder you wrote. Put in `summary:`:

- a table per capability: placeholder id, surface, title, entries, requirements, fitted tests (each marked candidate or evidence only, and full or partial, with what it leaves out when partial);
- the existing-runbook list: each test file with the runbook it fits, offering `/runbooks:to-test <id>` for runbooks whose `scripts` is empty;
- the unfitted tests, with the reason;
- the not-mapped list with reasons;
- the stale placeholders from step 1, each with the ids that no longer exist;
- the entry and requirement counts from step 1 next to the new ones: uncovered before, planned after;
- the three placeholders to create first, ranked by risk of the flow as in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/coverage.md`. On a tie, a placeholder with fitted tests comes first: its steps and Expected already have evidence.

Done when every uncovered item is in a placeholder or on the not-mapped list, every existing test is fitted or listed, every new placeholder has an empty `problems` list, and `summary:` holds the map.
