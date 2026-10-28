// Renames and deletes cases and contexts across runbooks: frontmatter cases, Preconditions Cases bullets, step Cases lines,
// role lines with "in <case>", and the +<case> fixture folders. The plans never edit roles.json; the command does that after
// the script, because the plans read the registry that still has the old names. Without write they only plan.
import fs from 'node:fs'
import path from 'node:path'
import { loadRunbooks } from './runbooks.mjs'
import { fixturesDir } from './fixtures.mjs'
import { setRoleKeys, setLastRun } from './frontmatter-edit.mjs'
import { readLastRun, renameCells, requireReadableLastRun } from './last-run.mjs'
import { splitFrontmatter, parseYaml } from './yaml.mjs'
import { OUTCOMES } from './roles.mjs'

// The same patterns lib/steps.mjs reads with, with the text around the case list captured so it can be rewritten.
const STEP_HEADING = /^###\s+(S\d+)\.\s*(.*)$/
const FIELD_LINE = /^[A-Z][A-Za-z ]*:/
const SECTION_END = /^(---\s*$|#)/
const EXPECTED_LINE = /^Expected:/
const CASES_LINE = /^(Cases:\s*)(.*)$/
const ROLE_CASES_LINE = /^(\s*-\s+[a-z0-9][a-z0-9-]*\s+in\s+)([a-z0-9][a-z0-9-]*(?:\s*,\s*[a-z0-9][a-z0-9-]*)*)(:\s+)([a-z-]+)\b/
const PRECONDITIONS_HEADING = /^##\s+Preconditions\s*$/
const CASES_BULLET = /^-\s+Cases:\s*$/
const CASE_BULLET = /^(\s+-\s+)([a-z0-9][a-z0-9-]*)(:\s*.*)$/

const nameList = (text) => text.split(',').map((p) => p.trim().replace(/`/g, '')).filter((p) => p && p !== 'none')
const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i])
const unique = (list) => [...new Set(list)]
const indentOf = (line) => line.match(/^\s*/)[0].length

// Rewrites every case reference of a runbook with mapCases(list) -> list. With skipped reasons the text comes back unchanged.
export function rewriteCases(text, mapCases, { emptyStepLine = 'skip' } = {}) {
  const skipped = []
  const lines = text.split(/(?<=\n)/)
  const eolOf = (line) => line.match(/\r?\n$/)?.[0] ?? ''
  const bare = (line) => line.slice(0, line.length - eolOf(line).length)
  const close = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(bare(line)))
  const hasFrontmatter = bare(lines[0] ?? '').replace(/^﻿/, '') === '---' && close !== -1

  let head = text
  let from = 0
  if (hasFrontmatter) {
    const parts = splitFrontmatter(text)
    const written = parts ? parseYaml(parts.yaml).cases : undefined
    if (written !== undefined && written !== null && written !== 'all') {
      const list = (Array.isArray(written) ? written : [written]).map(String)
      const mapped = unique(mapCases(list))
      if (mapped.length === 0) skipped.push(`cases lists only ${list.join(', ')}`)
      else if (!sameList(mapped, list)) head = setRoleKeys(text, { cases: mapped })
    }
    from = close + 1
  }
  // setRoleKeys changes only the frontmatter, so its lines up to the closing --- replace the original ones.
  const headLines = head.split(/(?<=\n)/)
  const headClose = hasFrontmatter ? headLines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(bare(line))) : -1
  const frontLines = hasFrontmatter ? headLines.slice(0, headClose + 1) : []
  const body = lines.slice(from)

  const out = []
  let step = null
  let inExpected = false
  let inPreconditions = false
  let inCases = false
  let bullet = null // { index in out, kept, removed }
  let dropIndent = null // indent of a removed case bullet or role line whose continuation lines go with it

  const endBullet = () => {
    if (bullet && bullet.kept === 0 && bullet.removed > 0) out[bullet.index] = null
    bullet = null
    inCases = false
  }

  for (const line of body) {
    const eol = eolOf(line)
    const raw = bare(line)
    if (dropIndent !== null) {
      if (raw.trim() !== '' && indentOf(raw) > dropIndent) continue
      dropIndent = null
    }
    const heading = raw.match(STEP_HEADING)
    if (heading) {
      endBullet()
      inPreconditions = false
      step = heading[1]
      inExpected = false
      out.push(line)
      continue
    }
    if (step === null) {
      if (PRECONDITIONS_HEADING.test(raw)) {
        inPreconditions = true
        out.push(line)
        continue
      }
      if (inPreconditions) {
        if (SECTION_END.test(raw)) {
          endBullet()
          inPreconditions = false
        } else if (CASES_BULLET.test(raw)) {
          endBullet()
          inCases = true
          bullet = { index: out.length, kept: 0, removed: 0 }
          out.push(line)
          continue
        } else {
          const item = inCases ? raw.match(CASE_BULLET) : null
          if (item) {
            const mapped = unique(mapCases([item[2]]))
            if (mapped.length === 0) {
              bullet.removed += 1
              dropIndent = indentOf(raw)
              continue
            }
            bullet.kept += 1
            out.push(sameList(mapped, [item[2]]) ? line : `${item[1]}${mapped[0]}${item[3]}${eol}`)
            continue
          }
          if (/^\S/.test(raw)) endBullet()
        }
      }
      out.push(line)
      continue
    }

    if (EXPECTED_LINE.test(raw)) {
      inExpected = true
      out.push(line)
      continue
    }
    if (FIELD_LINE.test(raw) || SECTION_END.test(raw)) inExpected = false
    const cases = raw.match(CASES_LINE)
    if (cases) {
      const list = nameList(cases[2])
      const mapped = unique(mapCases(list))
      if (mapped.length === 0 && list.length > 0) {
        if (emptyStepLine === 'remove') continue
        skipped.push(`${step} runs only in ${list.join(', ')}`)
      } else if (!sameList(mapped, list)) {
        out.push(`${cases[1]}${mapped.join(', ')}${eol}`)
        continue
      }
      out.push(line)
      continue
    }
    if (inExpected) {
      const role = raw.match(ROLE_CASES_LINE)
      if (role && OUTCOMES.includes(role[4])) {
        const list = role[2].split(',').map((c) => c.trim())
        const mapped = unique(mapCases(list))
        if (mapped.length === 0) {
          dropIndent = indentOf(raw)
          continue
        }
        if (!sameList(mapped, list)) {
          out.push(`${role[1]}${mapped.join(', ')}${raw.slice(role[1].length + role[2].length)}${eol}`)
          continue
        }
      }
    }
    out.push(line)
  }
  endBullet()

  if (skipped.length > 0) return { text, skipped }
  return { text: frontLines.join('') + out.filter((line) => line !== null).join(''), skipped }
}

// The +<name> folders of a runbook's fixtures: at the runbook level, in S<nn>, in @<role> and in S<nn>/@<role>.
function caseFolders(root, config, runbook, name) {
  const base = fixturesDir(config, runbook)
  const subdirs = (dir, pattern) => {
    try {
      return fs.readdirSync(path.resolve(root, dir), { withFileTypes: true }).filter((e) => e.isDirectory() && pattern.test(e.name)).map((e) => e.name)
    } catch {
      return []
    }
  }
  const levels = [base]
  for (const step of subdirs(base, /^S\d+$/)) levels.push(`${base}/${step}`)
  for (const dir of [...levels]) for (const role of subdirs(dir, /^@[a-z0-9][a-z0-9-]*$/)) levels.push(`${dir}/${role}`)
  return levels.map((dir) => `${dir}/+${name}`).filter((dir) => fs.existsSync(path.resolve(root, dir))).sort()
}

const unreadableProblem = (rb) => rb.problems.find((problem) => problem.startsWith('frontmatter:') || problem === 'missing frontmatter block')

// Computes every edit before it writes anything, so a refused edit leaves every file and folder as it was.
function plan(root, config, runbooks, edit, { folders, write }) {
  const result = { runbooks: [], skipped: [], folders: [], written: [] }
  const edits = []
  for (const rb of runbooks) {
    const problem = unreadableProblem(rb)
    if (problem) {
      result.skipped.push({ id: rb.id, reason: problem })
      continue
    }
    const file = path.resolve(root, rb.path)
    const before = fs.readFileSync(file, 'utf8')
    let rewritten
    try {
      rewritten = edit(before)
    } catch (err) {
      throw new Error(`${rb.path}: ${err.message}. Nothing was written`)
    }
    if (rewritten.skipped.length > 0) result.skipped.push({ id: rb.id, reason: rewritten.skipped.join('; ') })
    else if (rewritten.text !== before) {
      result.runbooks.push({ id: rb.id, path: rb.path })
      edits.push([file, rewritten.text, rb.path])
    }
    for (const folder of folders(rb)) result.folders.push(folder)
  }
  for (const { to } of result.folders) {
    if (to !== null && fs.existsSync(path.resolve(root, to))) throw new Error(`${to} already exists. Nothing was written`)
  }
  if (write) {
    for (const [file, text] of edits) fs.writeFileSync(file, text)
    for (const { from, to } of result.folders) if (to !== null) fs.renameSync(path.resolve(root, from), path.resolve(root, to))
    result.written = edits.map(([, , rel]) => rel)
  }
  return result
}

const ownerOf = (registry, kase) => Object.values(registry.contexts ?? {}).find((context) => context.cases.includes(kase))?.name ?? null

// Renames the case in the last_run cells of a runbook text. A runbook with no cells comes back unchanged.
function renameCaseCells(text, from, to) {
  const parts = splitFrontmatter(text)
  const { lastRun } = readLastRun(parts ? parseYaml(parts.yaml).last_run ?? null : null)
  if (!lastRun || lastRun.legacy || lastRun.cells.length === 0) return text
  return setLastRun(text, { lastRun: renameCells(lastRun, { field: 'case', from, to }) })
}

export function planRenameCase(root, config, registry, from, to, { write = false } = {}) {
  const owner = ownerOf(registry, from)
  if (owner === null) throw new Error(`no case "${from}"`)
  if (ownerOf(registry, to) !== null) throw new Error(`"${to}" is already a case`)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(to)) throw new Error(`case "${to}" must be kebab-case`)
  const runbooks = loadRunbooks(root, config).filter((rb) => rb.context === owner)
  runbooks.forEach(requireReadableLastRun)
  const rename = (list) => list.map((name) => (name === from ? to : name))
  const edit = (text) => {
    const rewritten = rewriteCases(text, rename, { emptyStepLine: 'skip' })
    return rewritten.skipped.length > 0 ? rewritten : { ...rewritten, text: renameCaseCells(rewritten.text, from, to) }
  }
  return plan(root, config, runbooks, edit, {
    write,
    folders: (rb) => caseFolders(root, config, rb, from).map((dir) => ({ from: dir, to: `${dir.slice(0, dir.length - from.length - 1)}+${to}` })),
  })
}

export function planDeleteCase(root, config, registry, name, { write = false } = {}) {
  const owner = ownerOf(registry, name)
  if (owner === null) throw new Error(`no case "${name}"`)
  const runbooks = loadRunbooks(root, config).filter((rb) => rb.context === owner)
  runbooks.forEach(requireReadableLastRun)
  const drop = (list) => list.filter((item) => item !== name)
  return plan(root, config, runbooks, (text) => rewriteCases(text, drop, { emptyStepLine: 'skip' }), {
    write,
    folders: (rb) => caseFolders(root, config, rb, name).map((dir) => ({ from: dir, to: null })),
  })
}

export function planDeleteContext(root, config, registry, name, { write = false } = {}) {
  if (!Object.hasOwn(registry.contexts ?? {}, name)) throw new Error(`no context "${name}"`)
  const context = registry.contexts[name]
  const runbooks = loadRunbooks(root, config).filter((rb) => rb.context === name)
  const edit = (text) => rewriteCases(setRoleKeys(text, { cases: null }), () => [], { emptyStepLine: 'remove' })
  return plan(root, config, runbooks, edit, {
    write,
    folders: (rb) => context.cases.flatMap((kase) => caseFolders(root, config, rb, kase)).sort().map((dir) => ({ from: dir, to: null })),
  })
}
