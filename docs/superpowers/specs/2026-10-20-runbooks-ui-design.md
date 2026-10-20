# /runbooks:ui, a local explorer for runbooks, runs and coverage

Decisions from the brainstorming session of 2026-10-20. Terms are defined in `runbooks/CONTEXT.md`. "Mine" marks a call made by the agent during the session, not by the user; the user can overturn any of them.

## Why

The user wants one place to answer two questions fast: which runbooks have gone too long without a run, and which routes have no runbook covering them. Today the answers are split between `runs.html` and `coverage.html`, two static files that are only as fresh as the last `run` or `coverage` command. The new command replaces both.

## Goals

- `/runbooks:ui` starts a temporary local server and opens a UI with three screens: Runbooks (capabilities and their runbooks), a runbook's detail with its history, and Coverage.
- Every page shows the state of the files on disk at the moment it loads. No command has to run first.
- A runbook past the configured age limit stands out in red, and so does every uncovered entry point.
- `runs.html` and `coverage.html` go away.

## Non-goals

- Editing runbooks, starting runs or changing anything on disk from the UI. The server only reads.
- Showing runs from other machines. Run reports in `_runs/` are ignored by Git, so the history shows the runs of this machine only, and the UI says so.
- The agent's ranked suggestions of runbooks to write first. The script cannot produce them; they stay in `/runbooks:coverage`.
- A light theme. The existing templates are dark only by design, and the UI keeps that.

## Data source: the Markdown files, read on every request

Runbooks stay in Markdown. No JSON format replaces them. The frontmatter is already structured data, and the plugin already reads it:

- `scripts/lib/runbooks.mjs` `loadRunbooks` gives every runbook with its metadata, `lastRun`, `problems` and `warnings`.
- `scripts/runbooks.mjs` `coverageResult(root, config, {}, warnings, true)` gives the overall coverage with each slice's entries, the same object `output --coverage` writes to `coverage.json` today. A filter `{ slice }` gives one slice.
- `scripts/lib/reports.mjs` reads run reports from `_runs/<YYYY-MM-DD-HHMM>-<id>.md`: frontmatter (date, commit, branch, mode, result, partial) and the step table.
- `scripts/lib/junit.mjs` `parseSteps` reads step headings, `Parents:` and `Viewports:` from a runbook body.

The static HTML files exist only because a page opened from `file://` cannot fetch JSON, so `output` pastes the data into the HTML. A server removes that limit. It reads the files on every request and keeps no cache, so a page reload always shows the current state.

## The command

- `/runbooks:ui` runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" ui [--port n]` in the background and gives the user the URL.
- The server listens on `127.0.0.1` only. Port default `4020` (mine), overridden by `--port`. A taken port exits 2 with a message that names the port, as `upstream` does.
- It stops on SIGINT or SIGTERM. The command file tells the agent how to stop it when the user asks, and the server stops with the session that started it (mine).
- Dependency-free Node, like `scripts/upstream-server.mjs`.
- Control of other web pages: every request whose `Host` header does not name `127.0.0.1`, `localhost` or `[::1]` gets a 403, as the upstream server's control routes do. The server sends no CORS headers (mine).
- Report and runbook files are looked up by id and by the names that `reports.mjs` lists. A path from the URL is never joined to the file system directly, so `..` cannot reach files outside `<paths.runbooks>` (mine).

## Config

- New key `staleDays`, default `30`: a runbook whose last full run is more than this many days old is stale. Documented in `skills/runbooks/references/config.md` and offered by `/runbooks:settings` in a group of its own (mine for the name and the group).
- No config key for the port (mine).

## Stale rule

- The age is today's date minus `last_run.date`, in whole days. Only full runs write `last_run`, so a partial run (`--steps`) never resets the age.
- A runbook that never ran is stale (mine).
- Only `active` and `draft` runbooks can be stale. `deprecated` runbooks and placeholders never count (mine).
- `last_run.outdated: true` keeps showing as an "outdated" badge, as in `runs.html` today. It does not make a runbook stale.

## Visual design

The mockups from the session are in `.superpowers/brainstorm/13963-1792533766/content/`: `layout-v4.html` (Runbooks page), `history.html` option B (report panel), `coverage.html` (Coverage page), `runbook-v2.html` (runbook detail). They are local and not committed. This section describes them in full.

- Palette, fonts and badges of `templates/runs.html`: warm black background, Claude orange accent, prompt green for ids and passed, red for failed and stale, amber for blocked. Geist and Geist Mono from Google Fonts. Dark only.
- Body text 15px, generous padding in tables and cards.
- All UI text in English.
- Header across the full width: the logo `❯ runbooks` on the left, then a menu with "Runbooks" and "Coverage". The current page is underlined in orange.
- A left sidebar across the full height below the header, 220px wide.
- The content right of the sidebar sits in a centered container with a maximum width of 960px.
- Single page app in one HTML file with inline CSS and vanilla JS, as the current templates are. Routes in the URL hash (`#/runbooks/billing`, `#/runbook/billing.issue-invoice/history`, `#/coverage/billing`), so reload and back work and a link can be shared (mine).

### Runbooks page

- Sidebar titled "Capabilities": "all" first, then one item per capability folder and one per slice from the config that has no capability folder yet, sorted by name, then "no slice" last when some entry point falls in no slice. So every uncovered entry point appears on this page (user's decision). Each item shows a red count of its problems: stale runbooks plus uncovered entry points in the slice with the same name. A zero shows in grey.
- A slice without runbooks shows its counters, "No runbooks yet" in place of the table, and its uncovered routes. "no slice" shows only the uncovered routes that fall in no slice.
- Selecting a capability shows, in the container:
  - four counters: runbooks, stale runbooks ("no run in 30+ days", with the configured number), percentage of entry points covered, uncovered entry points;
  - the capability name and a line such as "1 stale runbook · 1 uncovered route";
  - a table: runbook (flow name in green with the title below in grey), last full run (date and time, and "N days ago" below), result badge, and a "History (N) →" link, where N counts every report of that runbook in `_runs/`;
  - a stale row has a light red background, a red bar on its left edge and its date in red;
  - "Uncovered routes": each uncovered entry point of the slice with the same name, with its file on the right.
- "all" shows every sidebar item stacked, each in the format above, with the counters for the whole project. Since every entry point belongs to exactly one item, the counters equal the sum of the sections shown.
- A capability with no slice of the same name shows no uncovered section (mine).
- Invalid runbooks (with `problems`) appear in their capability's table with an "invalid" badge and the problems as text (mine).
- Clicking a runbook row opens its detail. Clicking "History" opens the detail on the History tab.

### Runbook detail

- Breadcrumb `billing / issue-invoice`, then the id in green, the title, and badges: status, surface, tags (`critical` in orange), and the last run result with its age.
- Two tabs: "Runbook" and "History (N)".
- Runbook tab, metadata on top and body below:
  - a panel with the frontmatter: feature, roles, viewports with their sizes from the config, upstream mode (marked "config default" when the runbook does not set it), covers (entries and requirements), scripts, sources, design references as links, last run (date, commit, link to its report), and the file path;
  - the body sections in order, rendered from Markdown: Goal, Preconditions, Steps, Not covered, Cleanup;
  - each step as a card: `S01` in orange and the step title, then a line with Parents, Requirement, Page (or Endpoint and As for `api`), Design and Viewports when present, the numbered Actions (or Request for `api`), and the Expected in a shaded box;
  - each step card shows its state from the last full run: one badge per viewport when the runbook has viewports ("desktop passed", "mobile failed"), else one badge. A step that the last full run did not reach shows no badge (mine). A failed step's card has a red border.
  - the step badges and the report link read only the report that `last_run.report` names, never the newest local report, so they always agree with the `last_run` result shown in the header and in the Runbooks table. `last_run` is committed and can come from a teammate's run, whose report is not on this machine. Then the panel says "report not on this machine" in place of the link, and the steps show no badges (mine).
- History tab:
  - a list of every run of this runbook in `_runs/`, newest first: date and time, branch and mode below in grey, commit, result badge, and a grey "partial" mark for `--steps` runs;
  - clicking a run opens its report in a panel on the right of the list. The list stays visible, and clicking another run swaps the panel. A close button hides the panel;
  - the panel shows the result badge, mode, upstream and viewports, the step table, and the report's sections (Failures, Blocked, Waived, Design differences, Other tests in the file, Notes) rendered from Markdown;
  - a line under the title says "N runs on this machine".

### Coverage page

- Sidebar titled "Slices": "overall" first, then each slice from the config with its percentage, then "no slice" for entry points that fall in no slice (mine). A percentage below 50 shows in red (mine).
- "overall" shows the sections of today's `coverage.html`: the four counters (entry points, requirements, active runbooks, active runbooks with a script), "By slice" with one row per slice and surface and the colored bar (covered, pending, planned), "Uncovered" with a filter by id or file, "Orphans" and "Invalid runbooks". Uncovered rows have the same red treatment as stale runbooks.
- The Coverage page runs the config's requirement sources on every load, `command` sources included, as `/runbooks:coverage` does. The Runbooks page needs entry points only (entry sources are never commands), so it runs no requirement source (mine).
- A slice shows a line with its counts and a link to the capability of the same name on the Runbooks page, then a table: entry point with its kind below, state badge (covered, pending, planned, uncovered), runbooks that cite it, scripts that test it. An entry that only mocked runbooks cite shows "cited, not covered (mocked)", as `coverage.html` does today.

## Markdown rendering

The UI needs runbook bodies and run reports as HTML. A small dependency-free renderer covers what the plugin's templates write: headings, paragraphs, ordered and unordered lists, tables, inline code, code blocks, bold, links and `---`. It escapes HTML first, so text from a runbook never becomes markup (mine). Where it lives (server or page) is the builder's choice.

## What goes away

- `templates/runs.html` and `templates/coverage.html`.
- The `output` subcommand of `runbooks.mjs`, `scripts/lib/output.mjs`, and their tests in `cli.test.mjs`. Nothing reads `runs.json` or `coverage.json` except the two HTML files.
- In `commands/run.md` and `commands/coverage.md`: the step that runs `output`, and the closing links to the HTML files. Both commands end instead with a line that offers `/runbooks:ui`.
- In `commands/setup.md`, `skills/runbooks/references/commits.md` and `templates/readme.md`: the summary files and their two `.gitignore` lines.
- In `skills/runbooks/references/coverage.md` and `docs/adr/0004-mocked-runbooks-never-cover-endpoints.md`: "in `coverage.html`" becomes "in `/runbooks:ui`".

### Migration of projects set up by older versions

`/runbooks:setup` and `/runbooks:upgrade` already migrate older projects. On the next setup (mine):

- delete `<paths.runbooks>/runs.json`, `runs.html`, `coverage.json` and `coverage.html` when they exist; Git ignores them, so nothing is staged;
- remove the lines `/<paths.runbooks>/runs.*` and `/<paths.runbooks>/coverage.*` from the root `.gitignore`.

## Docs and version

- New `commands/ui.md`, with the same sections as the other commands.
- `README.md`, `skills/runbooks/SKILL.md` and the CLI `USAGE` list the new command.
- Plugin version `1.3.0` in `plugin.json` and in the upstream server's `VERSION` (mine).

## Tests

`node --test` like the rest of the plugin, with the fixture project in `scripts/__fixtures__/project/`:

- the server's JSON for the Runbooks page: capabilities, stale flags against a fixed "today", problem counts per capability;
- the history list and one report, including a partial run;
- the stale rule: never run, `deprecated`, placeholder, a partial run newer than `last_run`;
- the 403 for a foreign `Host` and the 404 for a report name that is not in `_runs/`;
- the Markdown renderer escaping HTML.

## Left to the builder

- The JSON routes the page calls, and whether the page builds HTML from JSON or the server renders HTML.
- How the server gets "today" so tests can fix it.
- Reading per-viewport step states from a report: `reports.mjs` `readSteps` reads only the step and state columns today.
- How the "all" view stacks capabilities when there are many.
