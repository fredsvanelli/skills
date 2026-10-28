# The upstream server runs from the project

Design of 2026-10-27, written before any code. It changes the consequences of ADR 0003 (`runbooks/docs/adr/0003-mocked-upstream-served-by-plugin-server.md`) and touches ADR 0007 (`runbooks/docs/adr/0007-ui-tests-may-live-in-another-repo.md`). Marks: **(user)** is what the user decided, **(call)** is the designer's call that the user has not reviewed one by one. The user handed every open point to the designer after the first decisions.

## Why

During `/runbooks:run`, the agent starts the mock server with `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" upstream` (`runbooks/skills/runbooks/instructions/run.md:26`). That file lives in the plugin's install folder, outside the project. A person on the team who opens the project does not know the server exists, and has no command to start it. **(user: "isso é pouco intuitivo para o usuário final")**

`setup` already copies the server into the project, at `<tests.ui.dir>/runbooks-upstream.mjs`, and writes that path to `upstream.serverFile`. Only CI uses that copy today, and it needs flags: `--fixtures` is required, and the port, mode, target and redact lists come from flags too. The copy never reads `runbooks.config.json`. So the agent and CI run two different files, and a person has to rebuild the flag list by hand from the config.

## Goals

- The copy that `setup` puts in the project is the server everyone runs: the agent, the team and CI. **(user)**
- `setup` adds a `runbooks:upstream` script to the project's `package.json`, so `npm run runbooks:upstream` starts the server. **(user)**
- Started without `--fixtures`, the copy reads `runbooks.config.json` by itself and takes the port, mode, fixtures folder, target and redact lists from its `upstream` block. **(user)**
- During `run`, the agent starts the project's copy, not the plugin's file. **(user)**

## Non-goals

- Publishing the server as an npm package or adding it to `devDependencies`. The user chose the copy that `setup` makes. **(user)**
- Changing the Playwright `webServer` or Cypress commands that `setup` already shows. They pass `--fixtures` and keep working unchanged. **(call)**
- Supporting yarn, pnpm or bun scripts differently. A `package.json` script runs under all of them. **(call)**
- Starting the app with the server (one script that starts both). The app's start stays in `app.start`. **(call)**

## Anti-goals

- A CI job or framework config that starts the copy with `--fixtures` today must behave exactly as before, with no new config read and no new default.
- The copy stays one dependency-free Node file. It does not import anything from the plugin.
- The plugin never overwrites a project file without showing the diff first, as `setup` does today.

## How the copy reads the config

The rule that decides between config and flags: **(call)**

- With `--fixtures`, the copy works exactly as today. It reads no config, `--port` defaults to `4010`, `--mode` to `mocked`, and `--target` and the redact lists to empty. This keeps every existing CI job unchanged.
- Without `--fixtures`, the copy reads the config. The project root is `--root <dir>` when given, else the current folder. The config is `<root>/docs/runbooks/runbooks.config.json`, and every relative path in it resolves from the root. `npm run` runs scripts from the folder that holds `package.json`, which is the project root. A CI job in a UI tests repository (ADR 0007) can pass `--root ../project-001`. There is no `--config` flag, because a config at an arbitrary path leaves no rule to find the root its paths resolve from. **(call)**

When it reads the config, it maps the `upstream` block like this:

| Option | From the config | Default when the key is absent |
|---|---|---|
| port | `upstream.port` | `4010` |
| mode | `live` when `upstream.baseUrl` is set, else `mocked` | `mocked` |
| fixtures folder | `upstream.fixtures`, resolved from the root | `<paths.runbooks>/_fixtures`, where `paths.runbooks` defaults to `docs/runbooks` |
| target | `upstream.baseUrl` | empty |
| redact headers | `upstream.redactHeaders` | `[]` |
| redact body keys | `upstream.redactBodyKeys` | `[]` |

The startup mode follows the rule of the CI command that `setup` shows today (`setup.md:149`, `to-test.md:38`), not `upstream.mode`. **(call)** `upstream.mode` is the default mode of a runbook, and the agent and the scripts select each runbook's mode with `POST /__runbooks/select` anyway. The startup mode only decides what a request gets before any select. A person who runs the script by hand selects nothing, so `live` with a target lets the app work against the real API, and `mocked` without one gives 501s that name the missing fixture instead of 502s. With this rule, `npm run runbooks:upstream` and the CI command with flags start in the same mode for the same config. The shared mapping (next paragraphs) applies the same rule to `runbooks.mjs upstream`, which used `upstream.mode` until now.

Every flag the copy takes today (`--port`, `--mode`, `--target`, `--redact`, `--redact-body`, `--runbook`, `--role`, `--case`, `--step`) still overrides the value from the config. So `npm run runbooks:upstream -- --mode mocked --port 5010` works.

The copy exits 2 with one line on stderr, in the same `runbooks: <message>` form it uses today, when:

- there is no `--fixtures` and no config at the path it looked at. The message names the path and says to pass `--root` or `--fixtures`, or to run `/runbooks:setup`;
- the config is not valid JSON, or has no `upstream` block (same message as `runbooks.mjs upstream` gives today: "the config has no upstream block. Run /runbooks:setup");
- a value fails the checks `upstreamOptions` makes (port range, mode, role and case names).

The copy does not validate the rest of the config. That stays the job of `loadConfig` in the plugin. **(call)**

The defaults in the table above live in one place. Today they sit in `loadConfig` (`runbooks/scripts/lib/config.mjs`, the `config.upstream = { mode: 'live', ... }` block). The builder moves them, and the mapping from the config to server options, into `upstream-server.mjs`, and has `config.mjs` and `lib/upstream.mjs` use them from there. `runbooks.mjs` already imports `upstream-server.mjs`, so this adds no new direction of import. **(call)**

The legacy config path (`docs/runbooks/runbook.config.json`) is not searched. A project still on it gets the "no config" message, and `setup` already migrates it. **(call)**

## The npm script

`setup` adds this entry to `scripts` in the `package.json` at the project root: **(user, name; call, value)**

```json
"runbooks:upstream": "node <upstream.serverFile>"
```

For example `"node tests/e2e/runbooks-upstream.mjs"`. The script passes no flags, so all values come from the config.

- When `package.json` has no `scripts` key, `setup` adds one.
- When the `runbooks:upstream` script exists with the same value, nothing changes.
- When it exists with another value, `setup` shows the diff and asks before replacing it, as it does for the copy itself.
- When the project has no `package.json` at its root, `setup` writes nothing and says how to start the server with `node <upstream.serverFile>`. It does not create a `package.json`. **(call)**
- `setup` keeps the file's indentation and key order and adds the entry at the end of `scripts`. **(call)**
- The summary of `setup` names the script and the command `npm run runbooks:upstream`.
- `/runbooks:settings`, when it moves the copy (the `upstream.serverFile`, `tests.ui.root` or `tests.ui.dir` row in `runbooks/commands/settings.md:95`), updates the script's path too, with the same diff-and-ask rule.
- The `package.json` change goes into the same commit as the other files `setup` or `settings` wrote, under the policy `commits.setup`.

## Where the copy lives

Today `setup` copies the server only when `tests.ui` exists and some runbook can be mocked (`setup.md:146`). Once `run` depends on the copy, that leaves two holes: a project with mocked runbooks and no `tests.ui` has no server, and a live-default project gets its first mocked runbook through `create`, whose call to `run --record` would then stop on the missing copy. **(call)**

So `setup` copies the server, and adds the npm script, whenever the config has an `upstream` block. It no longer asks whether some runbooks will be mocked. A live-only project gets one unused file and one script, which costs less than a `create` that stops halfway. The `settings.md:95` row gains the case "the `upstream` block is added while `serverFile` is null", with the same copy and script.

Where the copy goes:

- With `tests.ui`: `<tests.ui.dir>/runbooks-upstream.mjs`, as today.
- With `tests.ui.root` pointing to a UI tests repository: `<tests.ui.root>/<tests.ui.dir>/runbooks-upstream.mjs`, as today. The npm script in this project points at that path (`node ../project-001-e2e/tests/runbooks-upstream.mjs`). It works only while that repository is cloned next to this one. **(call)**
- Without `tests.ui`: `<paths.runbooks>/runbooks-upstream.mjs` (by default `docs/runbooks/runbooks-upstream.mjs`). This is new.

## The agent uses the copy

Every place that starts the server, or names its process, moves to the copy. The builder finds them all with a search for `runbooks.mjs" upstream`, `runbooks.mjs upstream` and `upstream-server.mjs` under `runbooks/commands` and `runbooks/skills`. Known today:

- `runbooks/skills/runbooks/instructions/run.md:26`: start `node <upstream.serverFile>` from the project root, in the background, and wait for `runbooks-upstream listening on http://127.0.0.1:<port>`. The rest of the line (port taken, stopping at the end, `prompt` and `--import`) stays.
- `runbooks/skills/runbooks/instructions/to-test.md:36`: for a `mocked` runbook, start `node <upstream.serverFile>` the same way.
- `runbooks/commands/orchestrator.md:98`: a leftover server is one whose process is `runbooks-upstream.mjs` (the copy), `runbooks.mjs upstream` or `upstream-server.mjs` (servers started by older versions).
- `runbooks/skills/runbooks/references/upstream.md`, section "Server": the copy and `npm run runbooks:upstream` become the documented way to start the server. Section "The copy in the project" describes the config rule above.
- Any brief that `references/agents.md` or the orchestrator fills with how to start the server.

The agent runs `node <upstream.serverFile>`, not `npm run runbooks:upstream`. Both run the same file with the same config. Running `node` directly avoids guessing the package manager, avoids a project without `package.json`, and gives the agent the server's own process to stop, with no npm process in between to forward the signal. **(call)**

`runbooks.mjs upstream` stays in the plugin, for plugin development and its tests. No command or instruction tells the agent to use it. Its help line says the project's copy is the normal way. **(call)**

### When the copy is missing or from another version

Before the first step, when the server is needed (any `mocked` runbook, or `--record`), `run` checks the copy. `to-test` makes the same check before it starts the server in its step 6, and stops the same way. Both check the copy the same way `copiedServerWarning` in `runbooks/scripts/lib/upstream.mjs` does. **(call)**

- Missing (`upstream.serverFile` is null or the file does not exist): `run` stops before the first step, says the copy is missing, and offers `/runbooks:setup`. With `tests.ui.root` and that repository not cloned, the message says to clone it at `tests.ui.root`, or to run `/runbooks:setup`.
- From another version: `run` stops the same way, names both versions, and offers `/runbooks:setup`. A copy from an older version may lack a matching rule that the fixtures rely on (the payload match of ADR 0009 is an example), so running it would give results that are wrong without any sign.
- The orchestrator makes the same check as a new item of "Check the environment" (`orchestrator.md:88-100`), after the port check, when some stage needs the server. Like the other items there, a failure is one `AskUserQuestion`: run `/runbooks:setup` now and check again, or stop. **(call)** This is not the mid-run write ruled out below: no stage has started, and `setup` commits its own files under `commits.setup`, apart from the stages' commits.

`run` and `to-test` never refresh the copy by themselves. Writing a project file in the middle of a run would add an unasked change to its commit. **(call)**

The builder chooses how `run` gets this result: a field in `list --json`, a small `runbooks.mjs` subcommand, or another output that already exists. `copiedServerWarning` returns `null` today for a copy in a UI tests repository that is not cloned. `run` needs that case reported, so the builder either adds a flag or a sibling function for it.

## Records to update

- A new ADR, `runbooks/docs/adr/0011-...md`, says the agent runs the project's copy, the copy reads the config when started without `--fixtures`, and `run` stops on a missing or stale copy. It names the options considered: an npm package (rejected by the user), keeping the plugin's file for the agent (rejected, two files diverge), and refreshing the copy during `run` (rejected, unasked file change).
- ADR 0003, "Consequences": the line about `setup` copying the server says the copy is also what the agent and `npm run runbooks:upstream` start, and points to ADR 0011.
- `runbooks/skills/runbooks/references/config.md:264`: `serverFile` lists the third location.
- `runbooks/commands/setup.md` (step for the upstream server, and the summary) and `runbooks/commands/settings.md:95`.
- `runbooks/skills/runbooks/instructions/to-test.md:38`: CI may start the server with `npm run runbooks:upstream` when the job checks out this project, with `node <copy> --root <path to this project>` from a UI tests repository, or with the flags as today. All three start in the same mode for the same config.
- `runbooks/commands/setup.md:146-149`: the copy condition becomes "the config has an `upstream` block", the question about mocked runbooks goes away, and the step adds the npm script.
- `runbooks/README.md` and `CONTEXT.md` wherever they say how the server starts.
- The plugin version gets a minor bump, with the version string in `upstream-server.mjs` (header comment and `VERSION`) kept equal to the plugin's, as today.

## Tests

In `runbooks/scripts/upstream-server.test.mjs`, starting the copy as a child process the way the existing tests do:

- Without `--fixtures`, in a folder with a config, the copy listens on `upstream.port`, serves fixtures from `upstream.fixtures`, and uses `upstream.baseUrl` and the redact lists.
- The startup mode is `live` with `upstream.baseUrl` set and `mocked` without it, whatever `upstream.mode` says.
- A flag overrides the matching config value (`--port`, `--mode`).
- `--root <dir>` reads the config under that folder and resolves `upstream.fixtures` from it, not from the current folder.
- With `--fixtures`, a config in the folder is ignored: mode is `mocked`, port is `4010`, target is empty.
- No `--fixtures` and no config exits 2 with the message that names the path.
- A config without an `upstream` block exits 2.
- A config whose `upstream` block omits `fixtures` serves from `<paths.runbooks>/_fixtures`.

In the tests for `lib/upstream.mjs` and `config.mjs`: the defaults now come from `upstream-server.mjs`, and `loadConfig` gives the same `upstream` object as before for the existing fixtures of those tests.

For whatever `run` uses to detect a missing or stale copy: a test for a missing file, another version, the same version, and a `tests.ui.root` that is not cloned.

## Left to the builder

- How `run` and the orchestrator read the result of the copy check (see above).
- How `setup` edits `package.json` without changing its formatting. The Markdown instruction can tell the agent to edit the file, or a `runbooks.mjs` helper can do it. A helper is easier to test.
- The ADR number and title, following the existing ones.
- The exact wording of error messages, in the style the copy and `runbooks.mjs` already use.
