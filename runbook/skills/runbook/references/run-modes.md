# Run modes

Modes apply to `ui` runbooks. An `api` runbook always runs in mode `test`, through its script (see "test" below), and `--mode` does not change that.

| Mode | Who acts | Who sets the state | Login |
|---|---|---|---|
| `guided` | the user | the user | the user |
| `headless` | the agent, Playwright MCP server `mcp.headless` | the agent | form at `loginPath`, secret names |
| `headed` | the agent, Playwright MCP server `mcp.headed` | the agent | form at `loginPath`, secret names |
| `chrome` | the agent, Claude in Chrome | the agent | the user, beforehand |
| `prompt` | the Claude in Chrome extension | the user, by pasting the reply | the user, beforehand |
| `script` | a temporary Playwright script (fallback) | the agent, from the script output | env vars read by the script |
| `test` | `api` runbooks only: the project's test command on the runbook's `scripts` | `runbook.mjs junit`, from the JUnit report | the script's own helpers |

## Choosing the mode

`--mode` decides. Without it, ask with `AskUserQuestion` before any precondition check or browser action. There is no default mode. Ask only when the selection has a `ui` runbook; when it also has `api` runbooks, say in the question that they run through their scripts.

A mode is available when:

| Mode | Available when |
|---|---|
| `guided` | always |
| `headless` | `.mcp.json` has the `mcp.headless` server and its tools are loaded in this session |
| `headed` | `.mcp.json` has the `mcp.headed` server and its tools are loaded in this session |
| `chrome` | the `mcp__claude-in-chrome__*` tools, or a tool that enables them, are in this session |
| `prompt` | always |

Offer only the available modes, in the table's order, each with a one-line description from the first table. Mark `headless` "(Recommended)" and list it first when it is available; otherwise recommend `guided`. `AskUserQuestion` takes four options at most: when five are available, leave `prompt` out of the options and name it in the question text as an answer the user can type under "Other". Name the unavailable modes in the question text with the reason, for example "headed: `.mcp.json` has no `runbook-playwright-headed` server".

## guided

For each step, show Parents, Page (full URL), Actions and Expected. Ask with `AskUserQuestion`, options `Passed`, `Failed`, `Blocked`, `Waive`; the question asks the user to describe in the notes what they saw on Failed and what is missing on Blocked. Record the user's words. When a failure has no description, record "reason to collect" and ask all of those in one question at the end of the run.

## headless and headed

Use the tools of the MCP server named in `mcp.headless` or `mcp.headed` (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_take_screenshot`, ...).

- Login: navigate to `app.baseUrl` + `loginPath`, type the env var name (for example `UAT_ADMIN_EMAIL`, then `UAT_ADMIN_PASSWORD`) into the fields; the server replaces secret names from its `--secrets` file. A role change is a logout and a new login.
- After each step, take a snapshot, compare the visible text with Expected, and save a screenshot named `<run id>/<step>.png` (it lands in `paths.evidence` through `--output-dir`).
- Set each state from what the page shows. On failure, quote the visible text.

When the selected mode cannot start (the server is missing, its tools are not loaded, or the browser fails to launch), stop before the first step. Show the error, then ask again with `AskUserQuestion`, offering the other available modes plus `script`. Never switch modes without the user's answer.

## script

Needs Node 20.12+ (`process.loadEnvFile`). Write `.runbook/tmp/<run id>.mjs` using the project's Playwright (`import { chromium } from 'playwright'` or `'@playwright/test'`):

- `process.loadEnvFile('<mcp.secretsFile>')` for the account variables; the script reads them, the agent never prints them;
- `chromium.launch({ headless: <true for headless, false for headed> })`;
- one block per step in run order, each wrapped in try/catch, saving a screenshot to `<paths.evidence>/<run id>/<step>.png` and printing one JSON line `{ "step", "seen", "ok" }`;
- skip a step whose parent did not pass and print it as `blocked-by-parent`.

Run it with `node .runbook/tmp/<run id>.mjs`, read the JSON lines, and set the states from them. Delete the script after the report is written.

`script` is offered only when the project has Playwright (`@playwright/test` or `playwright` in the manifest), whatever `tests.ui.framework` says.

## test

For `api` runbooks. Needs `tests.api` in the config.

1. **Preconditions.** `tests.api.command` is set, and `tests.api.root` exists when given. When `tests.api.baseUrl` is set, it answers (`curl -s -o /dev/null -w '%{http_code}' <baseUrl>`); otherwise the app is not checked, because the scripts boot it themselves.
2. **Sync.** Every step has exactly one test whose name starts with its id in `scripts`, and no test there names a step the runbook does not have. Read the test names in the script files. When `scripts` is empty, or a step has no test, or a test names a missing step, follow `${CLAUDE_PLUGIN_ROOT}/commands/to-test.md` for the runbook first, skipping its "Run once" item: this run is that run. Content (whether each assertion matches its Expected) is not checked here; that is `audit-runbook`'s job.
3. **Execute.** Run `tests.api.command` in `tests.api.root` (default the project root), with `{files}` replaced by the `scripts` paths relative to that folder and `{junit}` by `.runbook/junit/<run id>.xml` (absolute path). Create the folder first.
4. **Read.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook.mjs" junit <id> --file .runbook/junit/<run id>.xml --json`, with `--waive <steps>` when the user asked before the run to skip steps. It gives one state per step with parents resolved, the run `result`, and the tests outside the runbook. A missing report means the command did not write `{junit}`: show its output and stop.
5. **Script mistakes.** A failure caused by the script itself (an import, a helper, a fixture, a typo in a route) may be fixed and the run repeated; say in the report's Notes what was fixed. Never loosen or remove an assertion so the app passes: a step whose Expected the app does not meet is a `failed` finding.

The report's `mode` is `test` and its `executor` is "the project's test command". Evidence is the JUnit report path. Tests outside the runbook go in the report's "Other tests in the file" section and do not change its `result`.

## chrome

Load the browser skill for Claude in Chrome when one is listed, then use the `mcp__claude-in-chrome__*` tools in a new tab.

- Ask the user to sign in with the runbook's role before the first step, and again when the role changes.
- Act only on URLs that start with `app.baseUrl`. A step that leads elsewhere is `blocked` with the URL recorded.
- Screenshots go to `paths.evidence/<run id>/` when the tools can save them; otherwise describe the screen in the report.

## prompt

1. Fill `${CLAUDE_PLUGIN_ROOT}/templates/prompt.md` with the runbook's role, `app.baseUrl`, preconditions and steps in run order. Never put a credential in it.
2. Save it to `.runbook/prompts/<run id>.md`, print it, and tell the user to sign in as the role, paste it into the Claude in Chrome extension, and bring back the reply with `/runbook:run <id> --import <file or pasted text>`.

### Import

The reply block:

```
RUNBOOK RESULT <runbook id>
S01 | passed | <what was seen>
S02 | failed | <what was seen>
END
```

- The id after `RUNBOOK RESULT` must match the runbook.
- Every step of the runbook appears once, with one of the step states.
- Ask the user about missing, repeated or unknown lines before writing anything.
- The report's `executor` is "Claude in Chrome extension, result reported by the user" and `mode` is `prompt`.
