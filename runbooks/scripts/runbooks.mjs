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
import { latestReport } from './lib/reports.mjs'
import { parseSteps, parseJunit, stepStates } from './lib/junit.mjs'
import { splitFrontmatter } from './lib/yaml.mjs'
import { fixturesDir, loadFixtures, sourceCounts, checkFixtures } from './lib/fixtures.mjs'
import { upstreamOptions, copiedServerWarning } from './lib/upstream.mjs'
import { VERSION, serveUpstream } from './upstream-server.mjs'
import { serveUi } from './ui-server.mjs'
import { listMarkdown, itemsMarkdown, coverageMarkdown, checkMarkdown, junitMarkdown, fixturesMarkdown, moveToCallsMarkdown, contractMarkdown, reviewPlanMarkdown, rolesMarkdown, roleMarkdown, affectedRolesMarkdown, citingMarkdown } from './lib/format.mjs'
import { roleRows, roleDetail, affectedByChange, citingRole } from './lib/role-views.mjs'
import { moveToCalls } from './lib/move-to-calls.mjs'
import { checkContract } from './lib/contract.mjs'
import { loadRoles, noAccountRoles, REVIEW_REASONS, REVIEW_FIELDS } from './lib/roles.mjs'
import { planReview, planEnableRoles } from './lib/review-edit.mjs'
import { todayLocal } from './lib/stale.mjs'

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
                roles on, one state per step and role (tests named "S01 title as editor @ mobile")
  fixtures      <id> loads the fixtures of a mocked ui runbook, counts them by source and, with
                upstream.schema set, checks each JSON response against the OpenAPI schema
  upstream      [--port n] [--mode mocked|live|record] [--runbook id] [--role name] [--step Sxx]
                starts the upstream server from the config in the foreground and prints its address; stop it with Ctrl+C
  contract      [--strict] checks the calls of every ui runbook against upstream.schema, and the fixtures of
                every mocked one against its calls and the schema (docs/adr/0005); --strict exits 1 on a finding
  move-to-calls [--source n] [--write] moves the endpoint ids of an upstream API in another repository
                from covers.entries to calls (docs/adr/0005): the ids of entries[n], or without --source the
                orphan ids shaped "METHOD /path". A dry run unless --write, which edits only those two keys
  mark-review   <id...> --reason r [--role n] [--key k] [--change text] [--date YYYY-MM-DD] [--write]
                adds a review entry to each runbook; r is roles-enabled, role-permissions, role-created or
                role-deleted. <id...> --clear [--write] removes the review key. A dry run unless --write
  enable-roles  [--date YYYY-MM-DD] [--write] sets roles: all on every runbook that is not deprecated and
                adds a roles-enabled review entry to those that are not placeholders. A dry run unless --write
  roles         [name] lists the roles with their account, runbook count, reviews, guessed keys and last
                results, or shows one role: effective permissions and its runbooks
  roles         --affected --role r --key k lists the runbooks a permission change reaches: the role and
                its heirs, per role. Both flags are required
  roles         --citing r lists the runbooks that cite the role (roles, Roles:, role line, As:) and its heirs
  ui            [--port n] starts the read-only UI server on 127.0.0.1 (default port 4020) in the foreground
                and prints its address; stop it with Ctrl+C

Global options:
  --root <dir>     project root (default: current directory)
  --config <file>  config path relative to the root (default: docs/runbooks/runbooks.config.json)
  --json           print JSON instead of Markdown

Read-only, except move-to-calls, mark-review and enable-roles with --write: prints to stdout, warnings to stderr. Exit 0 on success, 1 when
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
  const result = {
    id,
    title: runbook.title,
    status: runbook.status,
    lastRun: runbook.lastRun,
    full,
    latest,
    review: runbook.review,
    lastRunIsLatest: latest !== null && `${config.paths.runbooks}/${runbook.lastRun?.report}` === latest.path,
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
  const { fixtures, problems } = loadFixtures(root, dir, { roles: loadRoles(root, config)?.names ?? null })
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
  for (const field of ['role', 'key', 'change']) if (typeof options[field] === 'string') entry[field] = options[field]
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
    const groups = affectedByChange(registry, runbooks, known(options.role), options.key)
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

const PROJECT_COMMANDS = ['list', 'entries', 'requirements', 'coverage', 'check', 'junit', 'fixtures', 'move-to-calls', 'contract', 'mark-review', 'enable-roles', 'roles']

export function run(argv) {
  const stderr = []
  const finish = (code, stdout = '') => ({ code, stdout, stderr: stderr.length > 0 ? `${stderr.join('\n')}\n` : '' })
  const { command, options, positionals } = parseArgs(argv)
  try {
    if (!command || command === 'help' || options.help) return finish(0, USAGE)
    if (command === 'status') return finish(0, commandStatus(options))
    if (!PROJECT_COMMANDS.includes(command)) {
      stderr.push(`runbooks: unknown command "${command}"`)
      return finish(2, USAGE)
    }
    const root = path.resolve(typeof options.root === 'string' ? options.root : process.cwd())
    const config = loadConfig(root, typeof options.config === 'string' ? options.config : undefined)
    const warnings = ['list', 'coverage', 'entries', 'requirements'].includes(command) ? [...config.warnings] : []
    let stdout
    let code = 0
    if (command === 'contract') ({ code, stdout } = commandContract(root, config, options))
    else if (command === 'list') stdout = commandList(root, config, options, warnings)
    else if (command === 'coverage') stdout = commandCoverage(root, config, options, warnings)
    else if (command === 'check') stdout = commandCheck(root, config, options, positionals)
    else if (command === 'junit') stdout = commandJunit(root, config, options, positionals)
    else if (command === 'fixtures') stdout = commandFixtures(root, config, options, positionals)
    else if (command === 'move-to-calls') stdout = commandMoveToCalls(root, config, options)
    else if (command === 'mark-review') stdout = commandMarkReview(root, config, options, positionals)
    else if (command === 'enable-roles') stdout = commandEnableRoles(root, config, options)
    else if (command === 'roles') stdout = commandRoles(root, config, options, positionals)
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
