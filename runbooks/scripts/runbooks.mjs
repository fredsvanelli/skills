#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/args.mjs'
import { loadConfig } from './lib/config.mjs'
import { loadRunbooks } from './lib/runbooks.mjs'
import { filterRunbooks } from './lib/filter.mjs'
import { extractItems } from './lib/extract.mjs'
import { computeCoverage, sliceOf } from './lib/coverage.mjs'
import { nextStatus } from './lib/status.mjs'
import { changedFiles, affectedRunbooks } from './lib/affected.mjs'
import { matchesGlob } from './lib/glob.mjs'
import { latestReport } from './lib/reports.mjs'
import { outputRows, writeRuns, writeCoverage } from './lib/output.mjs'
import { parseSteps, parseJunit, stepStates } from './lib/junit.mjs'
import { splitFrontmatter } from './lib/yaml.mjs'
import { listMarkdown, itemsMarkdown, coverageMarkdown, checkMarkdown, junitMarkdown } from './lib/format.mjs'

export const USAGE = `Usage: runbooks.mjs <command> [options]

Commands:
  list          [--capability x] [--feature y] [--tag t] [--status s] [--path glob] [--affected [base]]
  entries       [--slice name] [--path glob]
  requirements
  coverage      [--capability x | --feature y | --path glob | --slice name]
  check         <id> [--full]
  status        --current <draft|active|deprecated> --states <s1,s2,...> [--partial]
  junit         <id> --file <junit.xml> [--waive S03,S04] maps the JUnit report of an api runbook's
                script onto its steps: one state per step, parents resolved; a ui runbook with
                viewports gets one state per step and viewport (tests named "S01 title @ mobile")
  output        [--coverage] writes runs.json and runs.html in the runbooks folder: every runbook
                with its last full run; with --coverage, also coverage.json and coverage.html (overall,
                with each slice's entries, their state and the scripts that test them)

Global options:
  --root <dir>     project root (default: current directory)
  --config <file>  config path relative to the root (default: docs/runbooks/runbooks.config.json)
  --json           print JSON instead of Markdown

Read-only except output: prints to stdout, warnings to stderr. Exit 0 on success, 2 on error.
`

const json = (value) => `${JSON.stringify(value, null, 2)}\n`

const pick = (options, keys) =>
  Object.fromEntries(keys.filter((key) => typeof options[key] === 'string').map((key) => [key, options[key]]))

function collect(root, config, listName, warnings, status = {}) {
  const { items, warnings: found, ran, complete } = extractItems(root, config[listName], listName)
  warnings.push(...found)
  Object.assign(status, { ran, complete })
  return items.map((item) => ({ ...item, slice: sliceOf(item.file, config.slices) }))
}

function runbookWarnings(runbooks) {
  return runbooks.flatMap((rb) => [...rb.problems, ...rb.warnings].map((problem) => `${rb.path}: ${problem}`))
}

function commandList(root, config, options, warnings) {
  const runbooks = loadRunbooks(root, config)
  warnings.push(...runbookWarnings(runbooks))
  const entries = options.path || options.affected ? collect(root, config, 'entries', warnings) : []
  const entryFiles = new Map(entries.map((entry) => [entry.id, entry.file]))
  const selected = filterRunbooks(runbooks, pick(options, ['capability', 'feature', 'tag', 'status', 'path']), entryFiles)
  if (!options.affected) return options.json ? json(selected) : listMarkdown(selected)

  const base = options.affected === true ? config.git.base : options.affected
  const hits = affectedRunbooks({ runbooks: selected, entries, slices: config.slices, changed: changedFiles(root, base) })
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

function coverageResult(root, config, filters, warnings, withItems = false) {
  const runbooks = loadRunbooks(root, config)
  const sourceWarnings = []
  const entriesStatus = {}
  const requirementsStatus = {}
  const entries = collect(root, config, 'entries', sourceWarnings, entriesStatus)
  const requirements = collect(root, config, 'requirements', sourceWarnings, requirementsStatus)
  warnings.push(...sourceWarnings, ...runbookWarnings(runbooks))
  const result = computeCoverage({
    runbooks,
    entries,
    requirements,
    requirementsConfigured: config.requirements.length > 0,
    requirementsRan: requirementsStatus.ran > 0,
    slices: config.slices,
    stack: config.stack,
    filters,
    unavailable: { entries: !entriesStatus.complete, requirements: !requirementsStatus.complete },
    withItems,
  })
  result.warnings = sourceWarnings
  return result
}

function commandCoverage(root, config, options, warnings) {
  const filters = pick(options, ['capability', 'feature', 'path', 'slice'])
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
  const result = { id, ...stepStates(steps, parseJunit(fs.readFileSync(file, 'utf8')), { waived, viewports: runbook.viewports }) }
  return options.json ? json(result) : junitMarkdown(result)
}

function commandOutput(root, config, options, warnings) {
  const runbooks = loadRunbooks(root, config)
  const written = writeRuns(root, config.paths.runbooks, outputRows(runbooks))
  if (options.coverage) {
    written.push(...writeCoverage(root, config.paths.runbooks, { scope: 'overall', ...coverageResult(root, config, {}, warnings, true) }))
  } else {
    warnings.push(...runbookWarnings(runbooks))
  }
  return `${written.join('\n')}\n`
}

const PROJECT_COMMANDS = ['list', 'entries', 'requirements', 'coverage', 'check', 'junit', 'output']

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
    const warnings = []
    let stdout
    if (command === 'list') stdout = commandList(root, config, options, warnings)
    else if (command === 'coverage') stdout = commandCoverage(root, config, options, warnings)
    else if (command === 'check') stdout = commandCheck(root, config, options, positionals)
    else if (command === 'junit') stdout = commandJunit(root, config, options, positionals)
    else if (command === 'output') stdout = commandOutput(root, config, options, warnings)
    else stdout = commandItems(root, config, options, command, warnings)
    stderr.push(...warnings.map((warning) => `warning: ${warning}`))
    return finish(0, stdout)
  } catch (err) {
    stderr.push(`runbooks: ${err.message}`)
    return finish(2)
  }
}

const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : null
if (invokedPath && invokedPath === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const result = run(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.code
}
