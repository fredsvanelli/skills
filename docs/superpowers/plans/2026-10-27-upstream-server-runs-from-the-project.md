# Upstream server runs from the project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The copy of the upstream server that `setup` puts in the project reads `runbooks.config.json` by itself, starts with `npm run runbooks:upstream`, and is the server the agent starts during `run` and `to-test`.

**Architecture:** `runbooks/scripts/upstream-server.mjs` gains the upstream defaults, the mapping from the config's `upstream` block to server options, and a config reader, so the copied file works alone and the plugin uses the same code. `runbooks.mjs` gains two subcommands that the Markdown commands call: `upstream-copy` checks that the copy is there and current, and `package-script` adds the npm script. The commands and instructions then start `node <upstream.serverFile>` instead of the plugin's file.

**Tech Stack:** Node ESM with no dependencies, `node:test`, Markdown command and instruction files.

**Spec:** `docs/superpowers/specs/2026-10-27-upstream-server-runs-from-the-project-design.md`

## Global Constraints

- `runbooks/scripts/upstream-server.mjs` imports only `node:` built-ins. It is copied into projects and must run from any folder.
- Started with `--fixtures`, the copy behaves exactly as today: no config read, `--port` default `4010`, `--mode` default `mocked`, `--target` and redact lists default empty.
- Without `--fixtures`, the copy reads `<root>/docs/runbooks/runbooks.config.json`, where root is `--root <dir>` (resolved from the current folder) or the current folder. There is no `--config` flag on the copy.
- Startup mode read from a config: `live` when `upstream.baseUrl` is set, else `mocked`. `upstream.mode` is not used for the startup mode. `--mode` overrides.
- The npm script is named `runbooks:upstream` and its value is `node <upstream.serverFile>`, with forward slashes.
- Copy locations: `<tests.ui.dir>/runbooks-upstream.mjs`; `<tests.ui.root>/<tests.ui.dir>/runbooks-upstream.mjs` with a UI tests repository; `<paths.runbooks>/runbooks-upstream.mjs` without `tests.ui`.
- `setup` copies the server whenever the config has an `upstream` block.
- `run` and `to-test` never refresh the copy. On a missing or stale copy they stop before the first step and offer `/runbooks:setup`.
- Error lines from the copy keep the form `runbooks: <message>` on stderr, exit code 2.
- The plugin version becomes `1.14.0` in `runbooks/.claude-plugin/plugin.json`, the header comment of `upstream-server.mjs` and its `export const VERSION`.
- Prose follows the repository's style: no em dashes, sentence-case headings, active voice.
- Files under `docs/` at the repository root are git-ignored: add them with `git add -f`.

## Review Focus

1. The copy run from a folder outside the plugin, under another file name (`tests/runbooks-upstream.mjs` in a project): an import of a plugin file would break it there. Pinned by the spawn test in Task 2.
2. A `package.json` indented with 4 spaces or tabs, or without a trailing newline: `package-script --write` must keep both. Pinned in Task 4.
3. A config that sets `paths.runbooks` to another folder and omits `upstream.fixtures`: the copy must serve from `<paths.runbooks>/_fixtures`, as `loadConfig` does. Pinned in Task 2.
4. `--root` given as a relative path (`--root ../project-001`) from a UI tests repository: it resolves from the current folder, and fixtures resolve from that root. Pinned in Task 2.
5. An `upstream.serverFile` written with backslashes on Windows: the npm script must use forward slashes so it runs under any shell. Pinned in Task 4.

---

### Task 1: Shared upstream defaults and option mapping

**Files:**
- Modify: `runbooks/scripts/upstream-server.mjs` (new exports near the top, after the constants)
- Modify: `runbooks/scripts/lib/config.mjs:214-219` (the `config.upstream = { ... }` block)
- Modify: `runbooks/scripts/lib/upstream.mjs:9-40` (`upstreamOptions`)
- Test: `runbooks/scripts/upstream-server.test.mjs`, `runbooks/scripts/cli.test.mjs:184-215`, `runbooks/scripts/runbooks.test.mjs:296-302`

**Interfaces:**
- Produces, in `upstream-server.mjs`:
  - `upstreamDefaults(runbooksPath = 'docs/runbooks')` returns `{ mode: 'live', baseUrl: '', start: [], urlEnv: '', port: 4010, fixtures: `${runbooksPath}/_fixtures`, schema: null, redactHeaders: [], redactBodyKeys: [], tokenEnv: '', serverFile: null }`.
  - `upstreamServerOptions(root, upstream, flags)` returns `{ fixturesRoot, target, redactHeaders, redactBodyKeys, port, mode, runbook, role, case, step }`. `upstream` is a block already merged with the defaults. `flags` has optional keys `port`, `mode`, `target`, `redact`, `redact-body`, `runbook`, `role`, `case`, `step`, each a string, `true` (flag without value) or absent. Throws `Error` with the existing messages: `--port must be an integer from 0 to 65535`, `--mode must be one of mocked, live, record`, `--role must be a role name like editor`, `--case must be a case name like vip-team`.
- `upstreamOptions(root, config, options)` keeps its signature and its "no upstream block" error, and delegates to `upstreamServerOptions(root, config.upstream, options)`.

- [ ] **Step 1: Write the failing tests**

In `upstream-server.test.mjs`, import `upstreamDefaults` and `upstreamServerOptions`:

```js
test('upstreamServerOptions starts live with a baseUrl and mocked without, whatever upstream.mode says', () => {
  const root = '/project'
  const live = upstreamServerOptions(root, { ...upstreamDefaults(), mode: 'mocked', baseUrl: 'https://api.example.com' }, {})
  assert.deepEqual([live.mode, live.target], ['live', 'https://api.example.com'])
  const mocked = upstreamServerOptions(root, { ...upstreamDefaults(), mode: 'live' }, {})
  assert.deepEqual([mocked.mode, mocked.target], ['mocked', ''])
  assert.equal(upstreamServerOptions(root, { ...upstreamDefaults(), baseUrl: 'https://x' }, { mode: 'record' }).mode, 'record')
})

test('upstreamServerOptions lets flags override the config', () => {
  const upstream = { ...upstreamDefaults(), port: 4321, redactHeaders: ['x-key'], redactBodyKeys: ['otp'] }
  const options = upstreamServerOptions('/project', upstream, { port: '5010', target: 'https://other', redact: 'a, b', 'redact-body': 'pin' })
  assert.deepEqual(
    [options.port, options.target, options.redactHeaders, options.redactBodyKeys, options.fixturesRoot],
    [5010, 'https://other', ['a', 'b'], ['pin'], path.resolve('/project', 'docs/runbooks/_fixtures')],
  )
  assert.throws(() => upstreamServerOptions('/project', upstream, { port: true }), /--port/)
})
```

In `cli.test.mjs`, the test `upstreamOptions resolves the config and the flags` sets `baseUrl`, so its expected `mode` changes from `'mocked'` to `'live'`. In `runbooks.test.mjs`, `loadConfig fills upstream defaults` stays as it is: it proves the move kept the defaults.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd runbooks && node --test scripts/upstream-server.test.mjs scripts/cli.test.mjs`
Expected: FAIL. `upstreamDefaults` is not exported, and `upstreamOptions` returns `mode: 'mocked'`.

- [ ] **Step 3: Implement `upstreamDefaults` and `upstreamServerOptions` in `upstream-server.mjs`**

Move the port, mode, role and case checks out of `lib/upstream.mjs` into `upstreamServerOptions`. Use the file's own `ROLE` regex, which equals `ROLE_NAME` in `lib/roles.mjs`. `fixturesRoot` is `path.resolve(root, upstream.fixtures)`. A redact flag is a comma list, trimmed, empty items dropped, as `cliOptions` splits it today.

- [ ] **Step 4: Use them from `config.mjs` and `lib/upstream.mjs`**

`config.mjs` builds `config.upstream` as `{ ...upstreamDefaults(config.paths.runbooks), ...raw.upstream }`, importing from `'../upstream-server.mjs'`. `upstreamOptions` keeps only the "no upstream block" check and returns `upstreamServerOptions(root, config.upstream, options)`. Drop the `MODES` constant and the `ROLE_NAME` import from `lib/upstream.mjs` if nothing else there uses them.

- [ ] **Step 5: Run the whole suite**

Run: `cd runbooks && npm test`
Expected: all tests pass, including `loadConfig fills upstream defaults` unchanged.

- [ ] **Step 6: Commit**

```bash
git add runbooks/scripts/upstream-server.mjs runbooks/scripts/lib/config.mjs runbooks/scripts/lib/upstream.mjs runbooks/scripts/upstream-server.test.mjs runbooks/scripts/cli.test.mjs
git commit -m "refactor(runbooks): keep the upstream defaults and option mapping in the server file"
```

---

### Task 2: The copy reads the config without `--fixtures`

**Files:**
- Modify: `runbooks/scripts/upstream-server.mjs:687-723` (`cliOptions` and the main block)
- Test: `runbooks/scripts/upstream-server.test.mjs`

**Interfaces:**
- Consumes: `upstreamDefaults`, `upstreamServerOptions` from Task 1.
- Produces, in `upstream-server.mjs`:
  - `readProjectUpstream(root)` returns the `upstream` block of `<root>/docs/runbooks/runbooks.config.json` merged over `upstreamDefaults(raw.paths?.runbooks ?? 'docs/runbooks')`. Throws `Error` with:
    - `no config at <absolute config path>: pass --root <project> or --fixtures <dir>, or run /runbooks:setup` when the file does not exist;
    - `<absolute config path> is not valid JSON: <parser message>`;
    - `the config has no upstream block. Run /runbooks:setup` when `raw.upstream` is null or absent.
  - `cliOptions(argv, cwd = process.cwd())`, now exported. With `--fixtures`, it returns what it returns today. Without it, it returns `upstreamServerOptions(root, readProjectUpstream(root), flags)` with `root = path.resolve(cwd, flags.root ?? '.')`.

- [ ] **Step 1: Write the failing tests**

Add a helper `project(config, files = {})` that writes `docs/runbooks/runbooks.config.json` plus the given files into a temp folder (reuse `tmp`). Tests:

```js
test('cliOptions without --fixtures reads the config of the current folder', () => {
  const dir = tmp({ 'docs/runbooks/runbooks.config.json': JSON.stringify({ version: 1, upstream: { port: 4321, baseUrl: 'https://api.example.com', redactHeaders: ['x-key'], redactBodyKeys: ['otp'] } }) })
  assert.deepEqual(cliOptions([], dir), {
    fixturesRoot: path.join(dir, 'docs/runbooks/_fixtures'), target: 'https://api.example.com',
    redactHeaders: ['x-key'], redactBodyKeys: ['otp'], port: 4321, mode: 'live',
    runbook: null, role: null, case: null, step: null,
  })
  assert.deepEqual([cliOptions(['--mode', 'mocked', '--port', '5010'], dir).mode, cliOptions(['--port', '5010'], dir).port], ['mocked', 5010])
})

test('cliOptions takes fixtures from paths.runbooks when upstream.fixtures is absent', () => {
  const dir = tmp({ 'docs/runbooks/runbooks.config.json': JSON.stringify({ version: 1, paths: { runbooks: 'qa/runbooks' }, upstream: {} }) })
  assert.equal(cliOptions([], dir).fixturesRoot, path.join(dir, 'qa/runbooks/_fixtures'))
})

test('cliOptions --root resolves from the current folder and fixtures resolve from the root', () => {
  const parent = tmp({ 'app/docs/runbooks/runbooks.config.json': JSON.stringify({ version: 1, upstream: {} }), 'app-e2e/.keep': '' })
  assert.equal(cliOptions(['--root', '../app'], path.join(parent, 'app-e2e')).fixturesRoot, path.join(parent, 'app/docs/runbooks/_fixtures'))
})

test('cliOptions with --fixtures ignores a config in the folder', () => {
  const dir = tmp({ 'docs/runbooks/runbooks.config.json': JSON.stringify({ version: 1, upstream: { port: 4321, baseUrl: 'https://api.example.com' } }) })
  const options = cliOptions(['--fixtures', 'fx'], dir)
  assert.deepEqual([options.port, options.mode, options.target], [4010, 'mocked', ''])
})

test('cliOptions fails on a missing config, bad JSON and no upstream block', () => {
  assert.throws(() => cliOptions([], tmp({})), /^Error: no config at .*runbooks\.config\.json: pass --root <project> or --fixtures <dir>, or run \/runbooks:setup$/)
  assert.throws(() => cliOptions([], tmp({ 'docs/runbooks/runbooks.config.json': '{ nope' })), /is not valid JSON/)
  assert.throws(() => cliOptions([], tmp({ 'docs/runbooks/runbooks.config.json': '{ "version": 1 }' })), /the config has no upstream block\. Run \/runbooks:setup/)
})
```

The `--fixtures` test assumes the old path keeps `path.resolve(flags.fixtures)` from the process folder. Keep that: CI jobs pass it relative to where they run.

One spawn test, using `spawn` from `node:child_process`, proves the copy works alone from a project (Review Focus 1):

```js
test('a copy in a project folder starts from the config with no flags but --port', async (t) => {
  const dir = tmp({
    'docs/runbooks/runbooks.config.json': JSON.stringify({ version: 1, upstream: {} }),
    'docs/runbooks/_fixtures/billing/list/invoices.json': fixture('GET', '/invoices', { status: 200, body: { items: [] } }),
  })
  fs.mkdirSync(path.join(dir, 'tests'))
  fs.copyFileSync(new URL('./upstream-server.mjs', import.meta.url), path.join(dir, 'tests/runbooks-upstream.mjs'))
  const child = spawn(process.execPath, ['tests/runbooks-upstream.mjs', '--port', '0'], { cwd: dir })
  t.after(() => child.kill())
  // read stdout until /listening on (http:\/\/127\.0\.0\.1:\d+)/ matches, then:
  // POST /__runbooks/select { runbook: 'billing.list', mode: 'mocked' } and GET /invoices answers 200 { items: [] }
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd runbooks && node --test scripts/upstream-server.test.mjs`
Expected: FAIL. `cliOptions` is not exported, and the spawned copy exits with `--fixtures <dir> is required`.

- [ ] **Step 3: Implement `readProjectUpstream` and the new branch of `cliOptions`**

The main block passes `process.cwd()` explicitly. Leave the `--fixtures` branch's behavior as it is; it may call `upstreamServerOptions` only if the defaults it passes keep `mode` `mocked` when `--target` is given without `--mode`.

- [ ] **Step 4: Run the tests**

Run: `cd runbooks && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add runbooks/scripts/upstream-server.mjs runbooks/scripts/upstream-server.test.mjs
git commit -m "feat(runbooks): the copied upstream server reads the config when started without --fixtures"
```

---

### Task 3: `runbooks.mjs upstream-copy` checks the copy before a run

**Files:**
- Modify: `runbooks/scripts/lib/upstream.mjs:42-54` (`copiedServerWarning`)
- Modify: `runbooks/scripts/runbooks.mjs` (`USAGE`, `PROJECT_COMMANDS`, dispatch in `run`)
- Test: `runbooks/scripts/cli.test.mjs`

**Interfaces:**
- Produces, in `lib/upstream.mjs`: `copiedServerProblem(root, config, version)` returns a message string or `null`. It is strict where `copiedServerWarning` is lenient:
  - no `upstream` block: `the config has no upstream block. Run /runbooks:setup`;
  - `upstream.serverFile` null: `upstream.serverFile is not set: run /runbooks:setup to copy the server`;
  - `tests.ui.root` outside the project and not cloned: `upstream.serverFile <file> is in <tests.ui.root>, which is not cloned: clone it there or run /runbooks:setup`;
  - missing file and other version: the same two messages `copiedServerWarning` gives today.
- `copiedServerWarning` keeps its current results (null for no block, unset file, or a UI tests repository not cloned) and reuses `copiedServerProblem` for the missing and version cases.
- CLI: `runbooks.mjs upstream-copy [--root dir]`. Ready: stdout `<upstream.serverFile>\n`, exit 0. Not ready: stdout `<problem>\n`, exit 1. A config that fails to load exits 2, as every project command does.

- [ ] **Step 1: Write the failing tests**

In `cli.test.mjs`, reuse `upstreamProject`:

```js
test('copiedServerProblem is strict about an unset file and a UI tests repository not cloned', () => {
  const unset = upstreamProject({})
  assert.equal(copiedServerProblem(unset, configOf(unset), VERSION), 'upstream.serverFile is not set: run /runbooks:setup to copy the server')
  const none = upstreamProject(null)
  assert.equal(copiedServerProblem(none, configOf(none), VERSION), 'the config has no upstream block. Run /runbooks:setup')
  const tests = { ui: { framework: 'playwright', root: '../app-e2e', dir: 'tests' } }
  const far = upstreamProject({ serverFile: '../app-e2e/tests/runbooks-upstream.mjs' }, { tests })
  assert.equal(
    copiedServerProblem(far, configOf(far), VERSION),
    'upstream.serverFile ../app-e2e/tests/runbooks-upstream.mjs is in ../app-e2e, which is not cloned: clone it there or run /runbooks:setup',
  )
})

test('upstream-copy prints the file when it is current and the problem otherwise', () => {
  const dir = upstreamProject({ serverFile: 'tests/runbooks-upstream.mjs' })
  assert.deepEqual(pick(run(['upstream-copy', '--root', dir])), [1, 'upstream.serverFile tests/runbooks-upstream.mjs is missing: run /runbooks:setup to copy it\n'])
  fs.mkdirSync(path.join(dir, 'tests'))
  fs.writeFileSync(path.join(dir, 'tests/runbooks-upstream.mjs'), "export const VERSION = '0.9.0'\n")
  assert.equal(run(['upstream-copy', '--root', dir]).code, 1)
  fs.writeFileSync(path.join(dir, 'tests/runbooks-upstream.mjs'), `export const VERSION = '${VERSION}'\n`)
  assert.deepEqual(pick(run(['upstream-copy', '--root', dir])), [0, 'tests/runbooks-upstream.mjs\n'])
})
```

`pick` is `({ code, stdout }) => [code, stdout]`. The existing `copiedServerWarning` tests stay unchanged and must still pass.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd runbooks && node --test scripts/cli.test.mjs`
Expected: FAIL, `copiedServerProblem` is not exported and `upstream-copy` is an unknown command.

- [ ] **Step 3: Implement `copiedServerProblem`, adjust `copiedServerWarning`, add the command**

Add `'upstream-copy'` to `PROJECT_COMMANDS` and a `USAGE` line: `upstream-copy  prints upstream.serverFile when the copied server is there and from this plugin version; else prints why and exits 1`. Change the `upstream` line of `USAGE` to say that the project's copy (`npm run runbooks:upstream`) is the normal way to start the server and this command serves plugin development.

- [ ] **Step 4: Run the tests**

Run: `cd runbooks && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add runbooks/scripts/lib/upstream.mjs runbooks/scripts/runbooks.mjs runbooks/scripts/cli.test.mjs
git commit -m "feat(runbooks): add upstream-copy to check the copied server before a run"
```

---

### Task 4: `runbooks.mjs package-script` adds the npm script

**Files:**
- Modify: `runbooks/scripts/lib/upstream.mjs` (new function)
- Modify: `runbooks/scripts/runbooks.mjs` (`USAGE`, `PROJECT_COMMANDS`, dispatch)
- Test: `runbooks/scripts/cli.test.mjs`

**Interfaces:**
- Produces, in `lib/upstream.mjs`: `packageScript(root, config, { write = false } = {})` returns `{ status, value, current }`:
  - `value` is `node <upstream.serverFile>` with every `\` turned into `/`;
  - `status` is `no-package` (no `<root>/package.json`), `unchanged`, `missing` (dry run) or `added` (written), `differs` (dry run) or `replaced` (written);
  - `current` is the existing script value, or `null`.
  - Throws `Error('upstream.serverFile is not set: run /runbooks:setup to copy the server first')` when the file is not set.
  - Writing keeps the file's indent (the leading whitespace of its first indented line, default two spaces), its key order and whether it ends with a newline. A missing `scripts` key is added last; the new script goes last in `scripts`.
- CLI: `runbooks.mjs package-script [--write] [--root dir]` prints one line and exits 0:
  - `no package.json: start the server with node <file>`
  - `unchanged: "runbooks:upstream": "<value>"`
  - `missing: "runbooks:upstream": "<value>"` or `added: ...`
  - `differs: "runbooks:upstream" is "<current>", expected "<value>"` or `replaced: ...`

- [ ] **Step 1: Write the failing tests**

```js
test('packageScript adds, keeps and replaces the runbooks:upstream script', () => {
  const dir = upstreamProject({ serverFile: 'tests\\e2e\\runbooks-upstream.mjs' })
  const config = configOf(dir)
  assert.equal(packageScript(dir, config).status, 'no-package')
  const file = path.join(dir, 'package.json')
  fs.writeFileSync(file, '{\n    "name": "app",\n    "scripts": {\n        "dev": "next dev"\n    }\n}')
  assert.deepEqual(packageScript(dir, config), { status: 'missing', value: 'node tests/e2e/runbooks-upstream.mjs', current: null })
  assert.equal(packageScript(dir, config, { write: true }).status, 'added')
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '{\n    "name": "app",\n    "scripts": {\n        "dev": "next dev",\n        "runbooks:upstream": "node tests/e2e/runbooks-upstream.mjs"\n    }\n}',
  )
  assert.equal(packageScript(dir, config).status, 'unchanged')
})

test('packageScript reports and replaces a different script, and adds scripts when absent', () => {
  const dir = upstreamProject({ serverFile: 'tests/runbooks-upstream.mjs' })
  const file = path.join(dir, 'package.json')
  fs.writeFileSync(file, '{\n\t"scripts": { "runbooks:upstream": "node old.mjs" }\n}\n')
  assert.deepEqual(packageScript(dir, configOf(dir)), { status: 'differs', value: 'node tests/runbooks-upstream.mjs', current: 'node old.mjs' })
  assert.equal(packageScript(dir, configOf(dir), { write: true }).status, 'replaced')
  assert.match(fs.readFileSync(file, 'utf8'), /^\{\n\t"scripts": \{\n\t\t"runbooks:upstream": "node tests\/runbooks-upstream\.mjs"\n\t\}\n\}\n$/)
  fs.writeFileSync(file, '{ "name": "app" }\n')
  packageScript(dir, configOf(dir), { write: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).scripts, { 'runbooks:upstream': 'node tests/runbooks-upstream.mjs' })
})

test('package-script prints one line', () => {
  const dir = upstreamProject({ serverFile: 'tests/runbooks-upstream.mjs' })
  assert.equal(run(['package-script', '--root', dir]).stdout, 'no package.json: start the server with node tests/runbooks-upstream.mjs\n')
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n')
  assert.equal(run(['package-script', '--root', dir, '--write']).stdout, 'added: "runbooks:upstream": "node tests/runbooks-upstream.mjs"\n')
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd runbooks && node --test scripts/cli.test.mjs`
Expected: FAIL, `packageScript` is not exported.

- [ ] **Step 3: Implement `packageScript` and the command**

Add `'package-script'` to `PROJECT_COMMANDS` and a `USAGE` line: `package-script [--write] adds "runbooks:upstream": "node <upstream.serverFile>" to the scripts of package.json. A dry run unless --write`.

- [ ] **Step 4: Run the tests**

Run: `cd runbooks && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add runbooks/scripts/lib/upstream.mjs runbooks/scripts/runbooks.mjs runbooks/scripts/cli.test.mjs
git commit -m "feat(runbooks): add package-script to write the runbooks:upstream npm script"
```

---

### Task 5: Commands and instructions start the project's copy

**Files:**
- Modify: `runbooks/skills/runbooks/instructions/run.md:26`
- Modify: `runbooks/skills/runbooks/instructions/to-test.md:36`, `:38`
- Modify: `runbooks/commands/orchestrator.md:88-100` ("Check the environment")
- Modify: `runbooks/commands/setup.md:146-149`, `:181`
- Modify: `runbooks/commands/settings.md:95`
- Test: `runbooks/scripts/plugin.test.mjs`

**Interfaces:**
- Consumes: `runbooks.mjs upstream-copy` (Task 3), `runbooks.mjs package-script [--write]` (Task 4), the copy's config read and `--root` (Task 2).

- [ ] **Step 1: Write the failing test**

In `plugin.test.mjs`:

```js
test('no command or instruction starts the plugin copy of the upstream server', () => {
  const dirs = ['commands', 'skills/runbooks/instructions'].map((dir) => new URL(`../${dir}/`, import.meta.url))
  const files = dirs.flatMap((dir) => fs.readdirSync(dir, { recursive: true }).filter((name) => name.endsWith('.md')).map((name) => new URL(name, dir)))
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /runbooks\.mjs" upstream(?![-\w])/, fileURLToPath(file))
})
```

Adapt the file walk to the helpers `plugin.test.mjs` already has.

- [ ] **Step 2: Run it to see it fail**

Run: `cd runbooks && node --test scripts/plugin.test.mjs`
Expected: FAIL on `run.md` and `to-test.md`.

- [ ] **Step 3: Edit `run.md` and `to-test.md`**

- `run.md:26`: before starting the server, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" upstream-copy`. Exit 1: show its line, offer `/runbooks:setup`, and stop before the first step. Never copy or refresh the server here. Exit 0: start `node <printed path>` from the project root in the background and wait for the listening line. The rest of the line (port taken, stop at the end, `prompt` and `--import`) stays.
- `to-test.md:36`: the same check and start for a `mocked` runbook.
- `to-test.md:38`: CI may start the server with `npm run runbooks:upstream` when the job checks out this project, with `node <copy> --root <path to this project>` from a UI tests repository, or with the flags as today. All three start in the same mode for the same config.

- [ ] **Step 4: Edit `orchestrator.md`**

Add item 7 to "Check the environment", when some stage needs the server (a `mocked` `ui` runbook, or a `create` or `update` that records): run `upstream-copy`. Exit 1: one `AskUserQuestion` with two options, run `/runbooks:setup` now and check again, or stop. Item 6 names `runbooks-upstream.mjs` as a leftover server process too, beside `runbooks.mjs upstream` and `upstream-server.mjs`.

- [ ] **Step 5: Edit `setup.md` and `settings.md`**

- `setup.md:146`: copy whenever the config has an `upstream` block, with no question about mocked runbooks. Location: `<tests.ui.dir>/runbooks-upstream.mjs`; with `tests.ui.root`, `<tests.ui.root>/<tests.ui.dir>/runbooks-upstream.mjs`; without `tests.ui`, `<paths.runbooks>/runbooks-upstream.mjs`. The framework start command (`:147-149`) is shown only when `tests.ui` exists, as today.
- After the copy: run `runbooks.mjs package-script`. `missing`: run it again with `--write`. `differs`: show the line and ask with `AskUserQuestion` before `--write`. `no package.json`: write nothing and keep the line for the summary. `package.json` joins this repository's write list and the `commits.setup` commit.
- `setup.md:181` (summary): name the copy, the command `npm run runbooks:upstream`, or the `node` line when there is no `package.json`.
- `settings.md:95`: add the case "the `upstream` block is added while `serverFile` is null", and after any copy run `package-script` with the same rules as `setup`.

- [ ] **Step 6: Run the suite**

Run: `cd runbooks && npm test`
Expected: all pass, including `every ${CLAUDE_PLUGIN_ROOT} path in the plugin docs exists`.

- [ ] **Step 7: Commit**

```bash
git add runbooks/skills/runbooks/instructions/run.md runbooks/skills/runbooks/instructions/to-test.md runbooks/commands/orchestrator.md runbooks/commands/setup.md runbooks/commands/settings.md runbooks/scripts/plugin.test.mjs
git commit -m "feat(runbooks): run, to-test and the orchestrator start the project's copy of the upstream server"
```

---

### Task 6: References, ADR 0011 and version 1.14.0

**Files:**
- Create: `runbooks/docs/adr/0011-the-agent-runs-the-projects-copy-of-the-upstream-server.md`
- Modify: `runbooks/docs/adr/0003-mocked-upstream-served-by-plugin-server.md` (Consequences, the `setup` copies line)
- Modify: `runbooks/skills/runbooks/references/upstream.md` ("Server", "The copy in the project")
- Modify: `runbooks/skills/runbooks/references/config.md:264` (`serverFile` row)
- Modify: `runbooks/commands/help.md:36` (`upstream` area)
- Modify: `runbooks/README.md:36`, `runbooks/templates/readme.md` (one line under the `_fixtures/` bullet)
- Modify: `runbooks/.claude-plugin/plugin.json`, `runbooks/scripts/upstream-server.mjs:1`, `:12`
- Test: `runbooks/scripts/plugin.test.mjs` (existing version and section tests)

- [ ] **Step 1: Write ADR 0011**

Follow the shape of ADR 0010: one context-and-decision paragraph, then "Considered Options" and "Consequences". Decision: the agent, the team and CI run the copy `setup` makes; without `--fixtures` it reads the config, starting `live` with `upstream.baseUrl` and `mocked` without; `run`, `to-test` and the orchestrator stop on a missing or stale copy; `setup` copies whenever an `upstream` block exists and writes the `runbooks:upstream` script. Options: an npm package in `devDependencies` (rejected by the user), the agent keeps the plugin's file (rejected: two files drift), `run` refreshes the copy (rejected: an unasked file change in the run's commit), `--config` on the copy (rejected: no rule to find the root its paths resolve from).

- [ ] **Step 2: Update ADR 0003, the references, help, READMEs**

- ADR 0003: the `setup` copies line says the copy is also what the agent and `npm run runbooks:upstream` start, and links ADR 0011.
- `upstream.md` "Server": the documented start is `npm run runbooks:upstream` or `node <upstream.serverFile>`, with the flag list and the config rule from the Global Constraints. `runbooks.mjs upstream` stays, described as the plugin's development command. "The copy in the project": the three locations, the npm script, `--root`, and the stop on a missing or stale copy.
- `config.md:264`: `serverFile` names the three locations.
- `help.md:36`: add `docs/adr/0011-the-agent-runs-the-projects-copy-of-the-upstream-server.md`.
- `README.md:36` and `templates/readme.md`: say that `npm run runbooks:upstream` starts the mock server from the config.

- [ ] **Step 3: Bump the version**

`1.13.0` becomes `1.14.0` in `plugin.json`, the header comment and `VERSION` of `upstream-server.mjs`.

- [ ] **Step 4: Run the suite**

Run: `cd runbooks && npm test`
Expected: all pass, including `the upstream server version equals the plugin version` and `the upstream reference has the sections the commands link to`.

- [ ] **Step 5: Commit**

```bash
git add runbooks/docs/adr runbooks/skills/runbooks/references runbooks/commands/help.md runbooks/README.md runbooks/templates/readme.md runbooks/.claude-plugin/plugin.json runbooks/scripts/upstream-server.mjs
git commit -m "docs(runbooks): add ADR 0011 for the project's copy of the upstream server and bump to 1.14.0"
```
