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

// design maps a name to a frame link or a file; "<name>.<viewport>" is the variant used at that viewport.
function readDesign(runbook, design, surface, system) {
  if (design === null || design === undefined) return
  if (typeof design !== 'object' || Array.isArray(design)) {
    runbook.problems.push('design must map each name to a reference')
    return
  }
  if (surface !== 'ui') runbook.problems.push('design applies only to ui runbooks')
  else if (!system) runbook.problems.push('design references need a design system in the config')
  for (const [key, ref] of Object.entries(design)) {
    if (typeof ref !== 'string' || ref === '') runbook.problems.push(`design "${key}" needs a reference`)
    const dot = key.indexOf('.')
    if (dot !== -1 && !runbook.viewports.includes(key.slice(dot + 1))) {
      runbook.problems.push(`design "${key}": "${key.slice(dot + 1)}" is not one of the runbook's viewports`)
    }
  }
  runbook.design = design
}

function readRunbook(file, rel, config) {
  const runbooksDir = config.paths.runbooks
  const stack = config.stack
  const viewports = config.viewports ?? {}
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
    viewports: [],
    design: {},
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

  runbook.viewports = asList(data.viewports)
  if (runbook.viewports.length > 0 && surface !== 'ui') runbook.problems.push('viewports apply only to ui runbooks')
  for (const name of runbook.viewports) {
    if (!Object.hasOwn(viewports, name)) runbook.problems.push(`viewport "${name}" is not in the config viewports`)
  }
  readDesign(runbook, data.design, surface, config.design ?? null)

  runbook.title = data.title === null || data.title === undefined ? '' : String(data.title)
  runbook.feature = data.feature ?? null
  runbook.tags = asList(data.tags)
  runbook.roles = asList(data.roles)
  runbook.covers = { entries: asList(data.covers?.entries), requirements: asList(data.covers?.requirements) }
  runbook.sources = asList(data.sources)
  runbook.scripts = asList(data.scripts)
  runbook.lastRun = data.last_run ?? null
  const outdated = runbook.lastRun?.outdated
  if (outdated !== undefined && typeof outdated !== 'boolean') runbook.problems.push('last_run.outdated must be true or false')
  return runbook
}

export function loadRunbooks(projectRoot, config) {
  const runbooksDir = config.paths.runbooks
  const dir = path.resolve(projectRoot, runbooksDir)
  return findFiles(dir, '**/*.md')
    .filter((rel) => rel.includes('/') && !rel.split('/').some((segment) => segment.startsWith('_')))
    .map((rel) => readRunbook(path.join(dir, rel), rel, config))
}
