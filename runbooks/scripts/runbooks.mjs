#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/args.mjs'
import { loadConfig, rolesEnabled } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { collect, runbookWarnings, coverageResult } from './lib/project.mjs'
import { filterRunbooks } from './lib/filter.mjs'
import { nextStatus } from './lib/status.mjs'
import { changedFiles, affectedRunbooks, schemaChanges } from './lib/affected.mjs'
import { matchesGlob } from './lib/glob.mjs'
import { latestReport, reportByName } from './lib/reports.mjs'
import { expectedCells, mergeLastRun, markOutdated, renameCells, pendingCells } from './lib/last-run.mjs'
import { setLastRun } from './lib/frontmatter-edit.mjs'
import { parseSteps, parseJunit, stepStates } from './lib/junit.mjs'
import { splitFrontmatter } from './lib/yaml.mjs'
import { fixturesDir, loadFixtures, sourceCounts, checkFixtures } from './lib/fixtures.mjs'
import { upstreamOptions, copiedServerWarning, copiedServerProblem, packageScript, serverFileOf, PACKAGE_SCRIPT } from './lib/upstream.mjs'
import { VERSION, serveUpstream } from './upstream-server.mjs'
import { serveUi } from './ui-server.mjs'
import { listMarkdown, itemsMarkdown, coverageMarkdown, checkMarkdown, junitMarkdown, fixturesMarkdown, moveToCallsMarkdown, contractMarkdown, reviewPlanMarkdown, caseEditMarkdown, rolesMarkdown, roleMarkdown, contextsMarkdown, affectedContextMarkdown, passesMarkdown, affectedRolesMarkdown, citingMarkdown, mergeRolesMarkdown, modelsMarkdown, lastRunPlanMarkdown, markOutdatedMarkdown } from './lib/format.mjs'
import { roleRows, roleDetail, affectedByChange, affectedByContext, contextRows, citingRole } from './lib/role-views.mjs'
import { moveToCalls } from './lib/move-to-calls.mjs'
import { checkContract } from './lib/contract.mjs'
import { casePlan, passPlan } from './lib/passes.mjs'
import { loadRoles, noAccountRoles, REVIEW_REASONS, REVIEW_FIELDS } from './lib/roles.mjs'
import { planReview, planEnableRoles } from './lib/review-edit.mjs'
import { planRenameCase, planDeleteCase, planDeleteContext } from './lib/case-edit.mjs'
import { planMerge } from './lib/roles-merge.mjs'
import { todayLocal } from './lib/stale.mjs'
import { DEFAULT_MODELS, resolveModel, modelRowsDiff } from './lib/models.mjs'

export const USAGE = `Usage: runbooks.mjs <command> [options]

Commands:
  list          [--capability x] [--feature y] [--tag t] [--status s] [--path glob] [--role r] [--review] [--affected [base]]
  entries       [--slice name] [--path glob]
  requirements
  coverage      [--capability x | --feature y | --path glob | --slice name | --role r]
  check         <id> [--full]
  status        --current <draft|active|deprecated> --states <s1,s2,...> [--partial]
  junit         <id> --file <junit.xml> [--waive S03,S04] maps the JUnit report of an api runbook's
                script onto its steps: one state per step, parents resolved; a ui runbook with
                viewports gets one state per step and viewport (tests named "S01 title @ mobile"); with
                roles on, one state per step and role (tests named "S01 title as editor @ mobile");
                with cases, one per step, role and case ("S01 title as manager in vip-team @ mobile")
  fixtures      <id> loads the fixtures of a mocked ui runbook, counts them by source and, with
                upstream.schema set, checks each JSON response against the OpenAPI schema
  upstream      [--port n] [--mode mocked|live|record] [--runbook id] [--role name] [--case name] [--step Sxx]
                starts the plugin's upstream server from the config in the foreground and prints its address; stop it with
                Ctrl+C. It serves plugin development: a project starts its own copy with npm run runbooks:upstream
  upstream-copy prints upstream.serverFile when the copied server is there and from this plugin version; else prints
                why and exits 1
  package-script [--write] adds "runbooks:upstream": "node <upstream.serverFile>" to the scripts of package.json.
                A dry run unless --write
  contract      [--strict] checks the calls of every ui runbook against upstream.schema, and the fixtures of
                every mocked one against its calls and the schema (docs/adr/0005); --strict exits 1 on a finding
  move-to-calls [--source n] [--write] moves the endpoint ids of an upstream API in another repository
                from covers.entries to calls (docs/adr/0005): the ids of entries[n], or without --source the
                orphan ids shaped "METHOD /path". A dry run unless --write, which edits only those two keys
  mark-review   <id...> --reason r [--role n] [--key k] [--case c] [--context x] [--change text]
                [--date YYYY-MM-DD] [--write] adds a review entry to each runbook; r is roles-enabled,
                role-permissions, role-created, role-deleted, context-created (needs --context) or
                case-created (needs --case). <id...> --clear [--write] removes the review key. A dry run unless --write
  enable-roles  [--date YYYY-MM-DD] [--write] sets roles: all on every runbook that is not deprecated and
                adds a roles-enabled review entry to those that are not placeholders. A dry run unless --write
  roles         [name] lists the roles with their account, runbook count, reviews, guessed keys and last
                results, or shows one role: effective permissions and its runbooks
  roles         --affected --role r --key k [--case c] lists the runbooks a permission change reaches: the role
                and its heirs, per role. --role and --key are required; --case keeps the runbooks that run it
  contexts      [--json] lists the contexts with their keys, cases and runbook count
  contexts      --affected <name> [--key k] lists the runbooks of a context, narrowed to one key
  passes        <id> [--role a,b] [--case a,b] lists the passes of a runbook: role, case, the case whose data the
                pass builds, viewport and account. A role runs once (case *) when its permissions do not change
                by case, no role line names it with a case and no step has a Cases: line
  rename-case   <from> <to> [--write] renames a case in every runbook of its context (cases, Preconditions,
                step Cases lines, role lines) and moves its +<from> fixture folders. Refuses a <to> that is
                already a case. A dry run unless --write. It does not edit roles.json
  delete-case   <name> [--write] removes a case from every cases list, Cases line and role line, and deletes a
                role line left with no case. A runbook whose cases list only <name>, or that has a step
                running only in it, is skipped and not written. +<name> folders stay and are listed
  delete-context <name> [--write] removes cases, the Preconditions Cases lists, step Cases lines and role
                lines with cases from the runbooks of a context. A dry run unless --write
  roles         --citing r lists the runbooks that cite the role (roles, Roles:, role line, As:) and its heirs
  merge-roles   --file <json> [--write] merges a proposal of roles, contexts and permissions into roles.json:
                a key the proposal gives replaces the role's own entry, and what it leaves out stays. Removes
                only the keys its remove list names. A dry run unless --write
  last-run      <id> --report <name> [--merge] [--write] merges a run report into the last_run of a runbook,
                cell by cell, and moves status when no cell is pending or outdated. <name> is the file name or
                _runs/<name>. A partial report needs --merge. A dry run unless --write
  mark-outdated <id...> [--write] marks the last_run of each runbook and all its cells outdated. A runbook
                with no last_run is skipped. A dry run unless --write
  rename-role-cells <from> <to> [--write] renames the role in the last_run cells of every runbook and
                changes nothing else. Needs role tracking on. A dry run unless --write
  model         <command> [arguments...] prints the model the command runs on, from the models block of the
                config. --model <value> in the arguments forces it. --json prints { model, row, forced }
  models        [--json] prints the model table of the project: key, model and default
  models        --defaults [--json] prints the default table and needs no config
  models        --diff [--json] counts the default rows the config lacks and lists the rows whose model differs
  ui            [--port n] starts the read-only UI server on 127.0.0.1 (default port 4020) in the foreground
                and prints its address; stop it with Ctrl+C

Global options:
  --root <dir>     project root (default: current directory)
  --config <file>  config path relative to the root (default: docs/runbooks/runbooks.config.json)
  --json           print JSON instead of Markdown

Read-only, except move-to-calls, mark-review, enable-roles, merge-roles, rename-case, delete-case,
delete-context, last-run, mark-outdated and rename-role-cells with --write: prints to stdout, warnings to stderr. Exit 0 on success, 1 when
contract --strict has findings, 2 on error.
`

const json = (value) => `${JSON.stringify(value, null, 2)}\n`

const pick = (options, keys) =>
  Object.fromEntries(keys.filter((key) => typeof options[key] === 'string').map((key) => [key, options[key]]))

function commandList(root, config, options, warnings) {
  const runbooks = loadRunbooks(root, config)
  warnings.push(...runbookWarnings(runbooks, root, config))
  const entries = options.path || options.affected ? collect(root, config, 'entries', warnings) : []
  const entryFiles = new Map(entries.map((entry) => [entry.id, entry.file]))
  const selected = filterRunbooks(runbooks, { ...pick(options, ['capability', 'feature', 'tag', 'status', 'path', 'role']), review: options.review === true }, entryFiles)
  if (!options.affected) return options.json ? json(selected) : listMarkdown(selected)

  const base = options.affected === true ? config.git.base : options.affected
  const changed = changedFiles(root, base)
  const schema = schemaChanges(root, base, config.upstream?.schema, changed)
  const hits = affectedRunbooks({ runbooks: selected, entries, slices: config.slices, changed, schema })
  if (options.json) return json(hits.map(({ runbook, reasons }) => ({ ...runbook, reasons })))
  return listMarkdown(hits.map((hit) => hit.runbook), new Map(hits.map((hit) => [hit.runbook.id, hit.reasons])))
}

function commandItems(root, config, options, listName, warnings) {
  const items = collect(root, config, listName, warnings).filter((item) =>
    (typeof options.slice !== 'string' || item.slice === options.slice) &&
    (typeof options.path !== 'string' || (item.file !== null && matchesGlob(item.file, options.path))),
  )
  return options.json ? json(items) : itemsMarkdown(items)
}

function commandCoverage(root, config, options, warnings) {
  const filters = pick(options, ['capability', 'feature', 'path', 'slice', 'role'])
  if (filters.role !== undefined) {
    requireTracking(config)
    if (!loadRoles(root, config).names.includes(filters.role)) throw new Error(`no role "${filters.role}"`)
  }
  const result = coverageResult(root, config, filters, warnings)
  const scope = Object.entries(filters).map(([key, value]) => `${key} ${value}`).join(', ') || 'overall'
  return options.json ? json({ scope, ...result }) : coverageMarkdown(result, scope)
}

function commandCheck(root, config, options, positionals) {
  // parseArgs reads "--full <id>" as a value, so a string --full is the id.
  const id = typeof options.full === 'string' ? options.full : positionals[0]
  const full = options.full !== undefined
  if (!id) throw new Error('check needs a runbook id')
  const runbook = loadRunbooks(root, config).find((rb) => rb.id === id)
  if (!runbook) throw new Error(`no runbook with id "${id}"`)
  const latest = latestReport(root, config.paths.runbooks, id, { full })
  const lastRun = runbook.lastRun
  let pending = []
  if (lastRun && !lastRun.legacy) {
    const parts = splitFrontmatter(fs.readFileSync(path.resolve(root, runbook.path), 'utf8'))
    const steps = parseSteps(parts ? parts.body : '')
    const registry = rolesEnabled(config) ? loadRoles(root, config) : null
    pending = pendingCells(lastRun.cells, expectedCells(runbook, steps, { registry, config }))
  }
  const cited = (report) => latest !== null && typeof report === 'string' && `${config.paths.runbooks}/${report}` === latest.path
  const result = {
    id,
    title: runbook.title,
    status: runbook.status,
    lastRun: runbook.lastRun,
    full,
    latest,
    review: runbook.review,
    lastRunIsLatest: cited(lastRun?.report) || Object.values(lastRun?.runs ?? {}).some((entry) => cited(entry.report)),
    pending,
  }
  return options.json ? json(result) : checkMarkdown(result)
}

function commandStatus(options) {
  if (typeof options.current !== 'string' || typeof options.states !== 'string') {
    throw new Error('status needs --current and --states')
  }
  const states = options.states.split(',').map((state) => state.trim()).filter(Boolean)
  const status = nextStatus(options.current, states, { partial: options.partial === true })
  return options.json ? json({ status }) : `${status}\n`
}

function commandJunit(root, config, options, positionals) {
  const id = positionals[0]
  if (!id || typeof options.file !== 'string') throw new Error('junit needs a runbook id and --file <junit.xml>')
  const runbook = loadRunbooks(root, config).find((rb) => rb.id === id)
  if (!runbook) throw new Error(`no runbook with id "${id}"`)
  const file = path.resolve(root, options.file)
  if (!fs.existsSync(file)) throw new Error(`${options.file} not found: the test command wrote no JUnit report`)
  const parts = splitFrontmatter(fs.readFileSync(path.resolve(root, runbook.path), 'utf8'))
  const steps = parseSteps(parts ? parts.body : '')
  if (steps.length === 0) throw new Error(`${runbook.path} has no steps`)
  const waived = typeof options.waive === 'string' ? options.waive.split(',').map((s) => s.trim()) : []
  const tracking = rolesEnabled(config) ? { roles: runbook.roles, noAccount: noAccountRoles(config, runbook) } : {}
  if (rolesEnabled(config) && runbook.context) tracking.casesOf = casePlan(loadRoles(root, config), runbook, steps)
  const result = { id, ...stepStates(steps, parseJunit(fs.readFileSync(file, 'utf8')), { waived, viewports: runbook.viewports, ...tracking }) }
  return options.json ? json(result) : junitMarkdown(result)
}

function readSchema(root, schema) {
  const file = path.resolve(root, schema)
  if (!fs.existsSync(file)) throw new Error(`${schema} not found: upstream.schema points to a missing file`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`${schema} is not valid JSON: ${err.message}`)
  }
}

function commandContract(root, config, options) {
  if (!config.upstream) throw new Error('the config has no upstream block, so there is no contract to check')
  const schema = config.upstream.schema
  const doc = schema ? readSchema(root, schema) : null
  const result = { schema, ...checkContract({ root, config, runbooks: loadRunbooks(root, config), doc }) }
  const code = options.strict === true && result.findings.length > 0 ? 1 : 0
  return { code, stdout: options.json ? json(result) : contractMarkdown(result) }
}

function commandFixtures(root, config, options, positionals) {
  const id = positionals[0]
  if (!id) throw new Error('fixtures needs a runbook id')
  const runbook = loadRunbooks(root, config).find((rb) => rb.id === id)
  if (!runbook) throw new Error(`no runbook with id "${id}"`)
  if (runbook.surface !== 'ui') throw new Error(`${id} is not a ui runbook: only ui runbooks have fixtures`)
  const dir = fixturesDir(config, runbook)
  const { fixtures, problems } = loadFixtures(root, dir, { roles: loadRoles(root, config)?.names ?? null, cases: runbook.context ? (runbook.cases ?? []) : null })
  if (config.upstream?.schema) problems.push(...checkFixtures(fixtures, readSchema(root, config.upstream.schema)))
  const result = { id, dir, fixtures, sources: sourceCounts(fixtures), problems }
  return options.json ? json(result) : fixturesMarkdown(result)
}

function commandMoveToCalls(root, config, options) {
  const source = typeof options.source === 'string' ? options.source : undefined
  if (options.source !== undefined && source === undefined) throw new Error('--source needs the index of an entries source')
  const plan = moveToCalls(root, config, { source, write: options.write === true })
  return options.json ? json(plan) : moveToCallsMarkdown(plan)
}

function requireTracking(config) {
  if (!rolesEnabled(config)) throw new Error('role tracking is off; /runbooks:settings roles turns it on')
}

function dateOption(options) {
  if (options.date === undefined) return todayLocal()
  if (typeof options.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('--date needs a date as YYYY-MM-DD')
  return options.date
}

function commandMarkReview(root, config, options, ids) {
  requireTracking(config)
  if (ids.length === 0) throw new Error('mark-review needs at least one runbook id')
  const write = options.write === true
  if (options.clear === true) {
    const plan = planReview(root, config, ids, { clear: true, write })
    return options.json ? json(plan) : reviewPlanMarkdown({ title: 'Clears the review key.', write, ...plan })
  }
  const reason = options.reason
  if (typeof reason !== 'string') throw new Error(`mark-review needs --reason, one of ${REVIEW_REASONS.join(', ')}`)
  if (!REVIEW_REASONS.includes(reason)) throw new Error(`--reason "${reason}" must be one of ${REVIEW_REASONS.join(', ')}`)
  const entry = { reason }
  for (const field of ['role', 'key', 'case', 'context', 'change']) if (typeof options[field] === 'string') entry[field] = options[field]
  const missing = REVIEW_FIELDS[reason].filter((field) => !entry[field])
  if (missing.length > 0) throw new Error(`--reason ${reason} needs ${missing.map((field) => `--${field}`).join(', ')}`)
  entry.date = dateOption(options)
  const plan = planReview(root, config, ids, { entry, write })
  return options.json ? json(plan) : reviewPlanMarkdown({ title: `Adds a ${reason} review entry.`, write, ...plan })
}

function commandEnableRoles(root, config, options) {
  requireTracking(config)
  const write = options.write === true
  const plan = planEnableRoles(root, config, { date: dateOption(options), write })
  return options.json ? json(plan) : reviewPlanMarkdown({ title: 'Sets roles: all and marks the runbooks for review.', write, ...plan })
}

function commandRoles(root, config, options, positionals) {
  requireTracking(config)
  const registry = loadRoles(root, config)
  const runbooks = loadRunbooks(root, config)
  const known = (name) => {
    if (!registry.names.includes(name)) throw new Error(`no role "${name}"`)
    return name
  }
  if (options.affected === true) {
    for (const flag of ['role', 'key']) {
      if (typeof options[flag] !== 'string') throw new Error(`roles --affected needs --${flag}`)
    }
    if (options.case !== undefined && typeof options.case !== 'string') throw new Error('roles --affected --case needs a case name')
    const groups = affectedByChange(registry, runbooks, known(options.role), options.key, typeof options.case === 'string' ? options.case : null)
    return options.json ? json(groups) : affectedRolesMarkdown(groups, options)
  }
  if (options.citing !== undefined) {
    if (typeof options.citing !== 'string') throw new Error('roles --citing needs a role name')
    const result = citingRole(root, registry, runbooks, known(options.citing))
    return options.json ? json(result) : citingMarkdown(result, options.citing)
  }
  if (positionals.length > 0) {
    const detail = roleDetail(root, config, registry, runbooks, known(positionals[0]))
    return options.json ? json(detail) : roleMarkdown(detail)
  }
  const rows = roleRows(root, config, registry, runbooks)
  return options.json ? json(rows) : rolesMarkdown(rows)
}

function commandContexts(root, config, options, positionals) {
  requireTracking(config)
  const registry = loadRoles(root, config)
  const runbooks = loadRunbooks(root, config)
  if (options.affected !== undefined) {
    const name = typeof options.affected === 'string' ? options.affected : positionals[0]
    if (typeof name !== 'string') throw new Error('contexts --affected needs a context name')
    const ids = affectedByContext(registry, runbooks, name, { key: typeof options.key === 'string' ? options.key : undefined })
    return options.json ? json(ids) : affectedContextMarkdown(ids, name)
  }
  if (positionals.length > 0 && !Object.hasOwn(registry.contexts ?? {}, positionals[0])) throw new Error(`no context "${positionals[0]}"`)
  const rows = contextRows(registry, runbooks).filter((row) => positionals.length === 0 || row.name === positionals[0])
  return options.json ? json(rows) : contextsMarkdown(rows)
}

function commandCaseEdit(root, config, options, positionals, command) {
  requireTracking(config)
  const count = command === 'rename-case' ? 2 : 1
  if (positionals.length < count) throw new Error(command === 'rename-case' ? 'rename-case needs <from> and <to>' : `${command} needs a ${command === 'delete-case' ? 'case' : 'context'} name`)
  const registry = loadRoles(root, config)
  const write = options.write === true
  let title
  let result
  if (command === 'rename-case') {
    result = planRenameCase(root, config, registry, positionals[0], positionals[1], { write })
    title = `Renames the case ${positionals[0]} to ${positionals[1]}. Edit roles.json too.`
  } else if (command === 'delete-case') {
    result = planDeleteCase(root, config, registry, positionals[0], { write })
    title = `Deletes the case ${positionals[0]} from the runbooks. Edit roles.json too.`
  } else {
    result = planDeleteContext(root, config, registry, positionals[0], { write })
    title = `Deletes the context ${positionals[0]} from the runbooks. Edit roles.json too.`
  }
  return options.json ? json(result) : caseEditMarkdown({ title, write, ...result })
}

function commandPasses(root, config, options, positionals) {
  requireTracking(config)
  const id = positionals[0]
  if (!id) throw new Error('passes needs a runbook id')
  const registry = loadRoles(root, config)
  const runbook = loadRunbooks(root, config).find((rb) => rb.id === id)
  if (!runbook) throw new Error(`no runbook with id "${id}"`)
  const list = (flag, known, label) => {
    if (options[flag] === undefined) return undefined
    if (typeof options[flag] !== 'string') throw new Error(`--${flag} needs ${label} names, separated by commas`)
    const names = options[flag].split(',').map((n) => n.trim()).filter(Boolean)
    for (const name of names) if (!known.includes(name)) throw new Error(`${runbook.id} has no ${label} "${name}"`)
    return names
  }
  const roles = list('role', runbook.roles ?? [], 'role')
  const cases = list('case', runbook.cases ?? [], 'case')
  const parts = splitFrontmatter(fs.readFileSync(path.resolve(root, runbook.path), 'utf8'))
  const steps = parseSteps(parts ? parts.body : '')
  const result = { id, context: runbook.context ?? null, passes: passPlan(registry, config, runbook, steps, { roles, cases }) }
  return options.json ? json(result) : passesMarkdown(result)
}

// last-run: merges a report into one runbook's last_run. A dry run unless --write.
function commandLastRun(root, config, options, positionals) {
  // parseArgs reads "--merge <id>" and "--write <id>" as values, so a string flag is the id.
  const id = [options.merge, options.write, positionals[0]].find((value) => typeof value === 'string')
  const merge = options.merge !== undefined
  const write = options.write !== undefined
  if (!id || typeof options.report !== 'string') throw new Error('last-run needs a runbook id and --report <name>')
  const runbook = loadRunbooks(root, config).find((rb) => rb.id === id)
  if (!runbook) throw new Error(`no runbook with id "${id}"`)
  const name = options.report.replace(/^_runs\//, '')
  const report = reportByName(root, config.paths.runbooks, name)
  if (!report) throw new Error(`no report "${name}" in _runs`)
  if (report.runbook !== id) throw new Error(`report ${name} belongs to ${report.runbook}`)
  const file = path.resolve(root, runbook.path)
  const text = fs.readFileSync(file, 'utf8')
  const parts = splitFrontmatter(text)
  const steps = parseSteps(parts ? parts.body : '')
  const registry = rolesEnabled(config) ? loadRoles(root, config) : null
  const expected = expectedCells(runbook, steps, { registry, config })
  const merged = mergeLastRun(runbook.lastRun, report, expected, { merge, status: runbook.status })
  const status = { from: runbook.status, to: merged.status }
  const result = {
    id,
    report: name,
    merge,
    write,
    status,
    lastRun: merged.lastRun,
    changed: merged.changed,
    pending: pendingCells(merged.lastRun.cells, expected)
  }
  if (write) fs.writeFileSync(file, setLastRun(text, { lastRun: merged.lastRun, status: status.to === status.from ? undefined : status.to }))
  return options.json ? json(result) : lastRunPlanMarkdown(result)
}

// mark-outdated: marks the last_run of each runbook outdated. Every edit is computed before any file is written.
function commandMarkOutdated(root, config, options, positionals) {
  const ids = [options.write, ...positionals].filter((value) => typeof value === 'string')
  const write = options.write !== undefined
  if (ids.length === 0) throw new Error('mark-outdated needs at least one runbook id')
  const loaded = loadRunbooks(root, config)
  const result = { runbooks: [], skipped: [], written: [] }
  const edits = []
  for (const id of ids) {
    const rb = loaded.find((r) => r.id === id)
    if (!rb) throw new Error(`no runbook with id "${id}"`)
    if (!rb.lastRun) {
      result.skipped.push({ id, reason: 'no last_run' })
      continue
    }
    result.runbooks.push({ id, path: rb.path })
    const file = path.resolve(root, rb.path)
    try {
      edits.push([file, setLastRun(fs.readFileSync(file, 'utf8'), { lastRun: markOutdated(rb.lastRun) })])
    } catch (err) {
      throw new Error(`${rb.path}: ${err.message}. Nothing was written`)
    }
  }
  if (write) {
    for (const [file, text] of edits) fs.writeFileSync(file, text)
    result.written = result.runbooks.map((rb) => rb.path)
  }
  return options.json ? json(result) : markOutdatedMarkdown({ ...result, write })
}

// rename-role-cells: renames a role in the last_run cells of every runbook. Every edit is computed before any file is written.
function commandRenameRoleCells(root, config, options, positionals) {
  requireTracking(config)
  // parseArgs reads "--write <arg>" as a value, so a string --write is the first name.
  const names = [options.write, ...positionals].filter((value) => typeof value === 'string')
  const write = options.write !== undefined
  if (names.length !== 2) throw new Error('rename-role-cells needs <from> and <to>')
  const [from, to] = names
  if (from === to) throw new Error('rename-role-cells needs two different names')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(to)) throw new Error(`role "${to}" must be kebab-case`)
  const result = { runbooks: [], written: [] }
  const edits = []
  const loaded = loadRunbooks(root, config)
  for (const rb of loaded) {
    if (rb.lastRun?.cells.some((cell) => cell.role === to)) throw new Error(`${rb.path}: last_run already has cells for role "${to}". Nothing was written`)
  }
  for (const rb of loaded) {
    if (!rb.lastRun || !rb.lastRun.cells.some((cell) => cell.role === from)) continue
    const file = path.resolve(root, rb.path)
    try {
      edits.push([file, setLastRun(fs.readFileSync(file, 'utf8'), { lastRun: renameCells(rb.lastRun, { field: 'role', from, to }) })])
    } catch (err) {
      throw new Error(`${rb.path}: ${err.message}. Nothing was written`)
    }
    result.runbooks.push({ id: rb.id, path: rb.path })
  }
  if (write) {
    for (const [file, text] of edits) fs.writeFileSync(file, text)
    result.written = result.runbooks.map((rb) => rb.path)
  }
  return options.json ? json(result) : caseEditMarkdown({ title: `Renames the role ${from} to ${to} in last_run cells.`, ...result, write })
}

function commandMergeRoles(root, config, options) {
  requireTracking(config)
  if (typeof options.file !== 'string') throw new Error('merge-roles needs --file <json>')
  const file = path.resolve(root, options.file)
  if (!fs.existsSync(file)) throw new Error(`${options.file} not found`)
  loadRoles(root, config)
  const plan = { proposal: options.file, ...planMerge(root, config, fs.readFileSync(file, 'utf8'), { write: options.write === true }) }
  return options.json ? json(plan) : mergeRolesMarkdown(plan)
}

function commandModel(config, argv) {
  const invocation = []
  let seen = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' || argv[i] === '--config') i++
    else if (argv[i] === '--json') continue
    else if (!seen && argv[i] === 'model') seen = true
    else invocation.push(argv[i])
  }
  return resolveModel(config.models, invocation)
}

function commandModels(config, options) {
  if (options.diff) {
    const diff = modelRowsDiff(config.ownModels)
    return options.json ? json(diff) : modelsMarkdown({ diff })
  }
  return options.json ? json(config.models) : modelsMarkdown({ rows: config.models, defaults: DEFAULT_MODELS })
}

function commandPackageScript(root, config, options) {
  const { status, value, current } = packageScript(root, config, { write: options.write === true })
  if (status === 'no-package') return `no package.json: start the server with ${value}\n`
  if (status === 'differs' || status === 'replaced') return `${status}: "${PACKAGE_SCRIPT}" is "${current}", expected "${value}"\n`
  return `${status}: "${PACKAGE_SCRIPT}": "${value}"\n`
}

const PROJECT_COMMANDS = ['model', 'models', 'list', 'entries', 'requirements', 'coverage', 'check', 'junit', 'fixtures', 'move-to-calls', 'contract', 'upstream-copy', 'package-script', 'mark-review', 'enable-roles', 'roles', 'contexts', 'passes', 'rename-case', 'delete-case', 'delete-context', 'merge-roles', 'last-run', 'mark-outdated', 'rename-role-cells']

export function run(argv) {
  const stderr = []
  const finish = (code, stdout = '') => ({ code, stdout, stderr: stderr.length > 0 ? `${stderr.join('\n')}\n` : '' })
  const { command, options, positionals } = parseArgs(argv)
  try {
    if (!command || command === 'help' || (options.help && command !== 'model')) return finish(0, USAGE)
    if (command === 'status') return finish(0, commandStatus(options))
    if (command === 'models' && options.defaults) {
      return finish(0, options.json ? json(DEFAULT_MODELS) : modelsMarkdown({ rows: DEFAULT_MODELS }))
    }
    if (!PROJECT_COMMANDS.includes(command)) {
      stderr.push(`runbooks: unknown command "${command}"`)
      return finish(2, USAGE)
    }
    const root = path.resolve(typeof options.root === 'string' ? options.root : process.cwd())
    const config = loadConfig(root, typeof options.config === 'string' ? options.config : undefined)
    const warnings = ['list', 'coverage', 'entries', 'requirements'].includes(command) ? [...config.warnings] : []
    let stdout
    let code = 0
    if (command === 'model') {
      const result = commandModel(config, argv)
      stdout = options.json ? json(result) : `${result.model}\n`
    } else if (command === 'models') stdout = commandModels(config, options)
    else if (command === 'contract') ({ code, stdout } = commandContract(root, config, options))
    else if (command === 'upstream-copy') {
      const problem = copiedServerProblem(root, config, VERSION)
      code = problem ? 1 : 0
      stdout = `${problem ?? serverFileOf(config)}\n`
    } else if (command === 'package-script') stdout = commandPackageScript(root, config, options)
    else if (command === 'list') stdout = commandList(root, config, options, warnings)
    else if (command === 'coverage') stdout = commandCoverage(root, config, options, warnings)
    else if (command === 'check') stdout = commandCheck(root, config, options, positionals)
    else if (command === 'junit') stdout = commandJunit(root, config, options, positionals)
    else if (command === 'fixtures') stdout = commandFixtures(root, config, options, positionals)
    else if (command === 'move-to-calls') stdout = commandMoveToCalls(root, config, options)
    else if (command === 'mark-review') stdout = commandMarkReview(root, config, options, positionals)
    else if (command === 'enable-roles') stdout = commandEnableRoles(root, config, options)
    else if (command === 'roles') stdout = commandRoles(root, config, options, positionals)
    else if (command === 'contexts') stdout = commandContexts(root, config, options, positionals)
    else if (['rename-case', 'delete-case', 'delete-context'].includes(command)) stdout = commandCaseEdit(root, config, options, positionals, command)
    else if (command === 'passes') stdout = commandPasses(root, config, options, positionals)
    else if (command === 'merge-roles') stdout = commandMergeRoles(root, config, options)
    else if (command === 'last-run') stdout = commandLastRun(root, config, options, positionals)
    else if (command === 'mark-outdated') stdout = commandMarkOutdated(root, config, options, positionals)
    else if (command === 'rename-role-cells') stdout = commandRenameRoleCells(root, config, options, positionals)
    else stdout = commandItems(root, config, options, command, warnings)
    if (command === 'list' || command === 'coverage') {
      const copied = copiedServerWarning(root, config, VERSION)
      if (copied) warnings.push(copied)
    }
    stderr.push(...warnings.map((warning) => `warning: ${warning}`))
    return finish(code, stdout)
  } catch (err) {
    stderr.push(`runbooks: ${err.message}`)
    return finish(2)
  }
}

const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : null
if (invokedPath && invokedPath === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2)
  if (argv[0] === 'upstream' && !argv.includes('--help')) {
    try {
      const { options } = parseArgs(argv)
      const root = path.resolve(typeof options.root === 'string' ? options.root : process.cwd())
      const config = loadConfig(root, typeof options.config === 'string' ? options.config : undefined)
      serveUpstream(upstreamOptions(root, config, options))
    } catch (err) {
      process.stderr.write(`runbooks: ${err.message}\n`)
      process.exit(2)
    }
  } else if (argv[0] === 'ui' && !argv.includes('--help')) {
    try {
      const { options } = parseArgs(argv)
      const port = options.port === undefined ? 4020 : Number(options.port)
      if (options.port !== undefined && (typeof options.port !== 'string' || !/^\d+$/.test(options.port) || port > 65535)) {
        throw new Error('--port must be an integer from 0 to 65535')
      }
      const root = path.resolve(typeof options.root === 'string' ? options.root : process.cwd())
      const configPath = typeof options.config === 'string' ? options.config : undefined
      loadConfig(root, configPath)
      serveUi({ root, configPath, port })
    } catch (err) {
      process.stderr.write(`runbooks: ${err.message}\n`)
      process.exit(2)
    }
  } else {
    const result = run(argv)
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exitCode = result.code
  }
}
