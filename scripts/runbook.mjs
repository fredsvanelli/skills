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
import { listMarkdown, itemsMarkdown, coverageMarkdown } from './lib/format.mjs'

export const USAGE = `Usage: runbook.mjs <command> [options]

Commands:
  list          [--capability x] [--feature y] [--tag t] [--status s] [--path glob] [--affected [base]]
  entries       [--slice name] [--path glob]
  requirements
  coverage      [--capability x | --feature y | --path glob | --slice name]
  status        --current <draft|active|deprecated> --states <s1,s2,...> [--partial]

Global options:
  --root <dir>     project root (default: current directory)
  --config <file>  config path relative to the root (default: docs/runbooks/runbook.config.json)
  --json           print JSON instead of Markdown

Read-only: prints to stdout, warnings to stderr. Exit 0 on success, 2 on error.
`

const json = (value) => `${JSON.stringify(value, null, 2)}\n`

const pick = (options, keys) =>
  Object.fromEntries(keys.filter((key) => typeof options[key] === 'string').map((key) => [key, options[key]]))

function collect(root, config, listName, warnings) {
  const { items, warnings: found } = extractItems(root, config[listName], listName)
  warnings.push(...found)
  return items.map((item) => ({ ...item, slice: sliceOf(item.file, config.slices) }))
}

function runbookWarnings(runbooks) {
  return runbooks.flatMap((rb) => rb.problems.map((problem) => `${rb.path}: ${problem}`))
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

function commandCoverage(root, config, options, warnings) {
  const runbooks = loadRunbooks(root, config)
  const sourceWarnings = []
  const entries = collect(root, config, 'entries', sourceWarnings)
  const requirements = collect(root, config, 'requirements', sourceWarnings)
  warnings.push(...sourceWarnings, ...runbookWarnings(runbooks))
  const filters = pick(options, ['capability', 'feature', 'path', 'slice'])
  const result = computeCoverage({
    runbooks,
    entries,
    requirements,
    requirementsConfigured: config.requirements.length > 0,
    slices: config.slices,
    filters,
  })
  result.warnings = sourceWarnings
  const scope = Object.entries(filters).map(([key, value]) => `${key} ${value}`).join(', ') || 'overall'
  return options.json ? json({ scope, ...result }) : coverageMarkdown(result, scope)
}

function commandStatus(options) {
  if (typeof options.current !== 'string' || typeof options.states !== 'string') {
    throw new Error('status needs --current and --states')
  }
  const states = options.states.split(',').map((state) => state.trim()).filter(Boolean)
  const status = nextStatus(options.current, states, { partial: options.partial === true })
  return options.json ? json({ status }) : `${status}\n`
}

const PROJECT_COMMANDS = ['list', 'entries', 'requirements', 'coverage']

export function run(argv) {
  const stderr = []
  const finish = (code, stdout = '') => ({ code, stdout, stderr: stderr.length > 0 ? `${stderr.join('\n')}\n` : '' })
  const { command, options } = parseArgs(argv)
  try {
    if (!command || command === 'help' || options.help) return finish(0, USAGE)
    if (command === 'status') return finish(0, commandStatus(options))
    if (!PROJECT_COMMANDS.includes(command)) {
      stderr.push(`runbook: unknown command "${command}"`)
      return finish(2, USAGE)
    }
    const root = path.resolve(typeof options.root === 'string' ? options.root : process.cwd())
    const config = loadConfig(root, typeof options.config === 'string' ? options.config : undefined)
    const warnings = []
    let stdout
    if (command === 'list') stdout = commandList(root, config, options, warnings)
    else if (command === 'coverage') stdout = commandCoverage(root, config, options, warnings)
    else stdout = commandItems(root, config, options, command, warnings)
    stderr.push(...warnings.map((warning) => `warning: ${warning}`))
    return finish(0, stdout)
  } catch (err) {
    stderr.push(`runbook: ${err.message}`)
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
