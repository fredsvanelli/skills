import fs from 'node:fs'
import path from 'node:path'
import { findFiles } from './glob.mjs'
import { splitFrontmatter, parseYaml } from './yaml.mjs'
import { surfacesOf } from './config.mjs'

const STATUSES = ['placeholder', 'draft', 'active', 'deprecated']

const asList = (value) => {
  if (value === null || value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map(String)
}

const SURFACES = ['ui', 'api']

function readRunbook(file, rel, runbooksDir, stack) {
  const segments = rel.split('/')
  const flow = segments.join('.').replace(/\.md$/, '')
  const runbook = {
    id: flow,
    path: `${runbooksDir}/${rel}`,
    title: '',
    capability: segments[0],
    surface: 'ui',
    feature: null,
    tags: [],
    roles: [],
    covers: { entries: [], requirements: [] },
    sources: [],
    scripts: [],
    status: null,
    lastRun: null,
    problems: [],
  }
  if (segments.length !== 2) runbook.problems.push('runbooks live exactly one folder deep: <capability>/<flow>.md')

  const parts = splitFrontmatter(fs.readFileSync(file, 'utf8'))
  if (!parts) {
    runbook.problems.push('missing frontmatter block')
    return runbook
  }
  let data
  try {
    data = parseYaml(parts.yaml)
  } catch (err) {
    runbook.problems.push(`frontmatter: ${err.message}`)
    return runbook
  }

  if (data.id !== runbook.id) runbook.problems.push(`id "${data.id}" does not match the path, expected "${runbook.id}"`)
  if (data.capability !== runbook.capability) runbook.problems.push(`capability "${data.capability}" does not match the folder "${runbook.capability}"`)
  if (STATUSES.includes(data.status)) runbook.status = data.status
  else runbook.problems.push(`status "${data.status}" must be one of ${STATUSES.join(', ')}`)

  const surface = data.surface ?? 'ui'
  if (!SURFACES.includes(surface)) runbook.problems.push(`surface "${surface}" must be one of ${SURFACES.join(', ')}`)
  else if (!surfacesOf(stack).includes(surface)) runbook.problems.push(`surface "${surface}" is not allowed in a ${stack} stack`)
  else runbook.surface = surface

  runbook.title = data.title === null || data.title === undefined ? '' : String(data.title)
  runbook.feature = data.feature ?? null
  runbook.tags = asList(data.tags)
  runbook.roles = asList(data.roles)
  runbook.covers = { entries: asList(data.covers?.entries), requirements: asList(data.covers?.requirements) }
  runbook.sources = asList(data.sources)
  runbook.scripts = asList(data.scripts)
  runbook.lastRun = data.last_run ?? null
  return runbook
}

export function loadRunbooks(projectRoot, config) {
  const runbooksDir = config.paths.runbooks
  const dir = path.resolve(projectRoot, runbooksDir)
  return findFiles(dir, '**/*.md')
    .filter((rel) => rel.includes('/') && !rel.split('/').some((segment) => segment.startsWith('_')))
    .map((rel) => readRunbook(path.join(dir, rel), rel, runbooksDir, config.stack))
}
