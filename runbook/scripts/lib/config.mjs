import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_CONFIG_PATH = 'docs/runbooks/runbook.config.json'

export class ConfigError extends Error {}

const COMMIT_POLICIES = ['never', 'ask', 'auto']
const STACKS = { frontend: ['ui'], backend: ['api'], fullstack: ['ui', 'api'] }

// The surfaces a stack allows runbooks to have.
export const surfacesOf = (stack) => STACKS[stack] ?? STACKS.frontend
const EXTRACTORS = {
  entries: ['next-app-router', 'regex'],
  requirements: ['regex', 'command'],
}

const DEFAULTS = {
  language: 'en',
  stack: 'frontend',
  tests: {},
  paths: { runbooks: 'docs/runbooks', evidence: '.runbook/evidence', e2e: null },
  app: { baseUrl: '', start: [] },
  accounts: {},
  uiText: [],
  data: { seedHint: '' },
  entries: [],
  requirements: [],
  slices: {},
  tickets: { fetch: '' },
  git: { base: 'main', protected: ['main'], messageFormat: 'docs(runbooks): {summary}' },
  commits: { runbooks: 'ask', setup: 'ask' },
  mcp: { headless: 'runbook-playwright', headed: 'runbook-playwright-headed', secretsFile: '.env.local' },
}

function validateSource(listName, source, index) {
  const label = `${listName}[${index}]`
  if (!EXTRACTORS[listName].includes(source.extractor)) {
    throw new ConfigError(`${label}: extractor must be one of ${EXTRACTORS[listName].join(', ')}`)
  }
  if (source.extractor === 'command') {
    if (!source.command) throw new ConfigError(`${label}: "command" is required`)
    return
  }
  if (!source.glob) throw new ConfigError(`${label}: "glob" is required`)
  if (source.extractor === 'regex') {
    if (!source.pattern) throw new ConfigError(`${label}: "pattern" is required`)
    try {
      RegExp(source.pattern)
    } catch (err) {
      throw new ConfigError(`${label}: invalid pattern: ${err.message}`)
    }
    if (!source.pattern.includes('(?<id>')) throw new ConfigError(`${label}: pattern needs a named group (?<id>...)`)
  }
}

export function loadConfig(projectRoot, configPath = DEFAULT_CONFIG_PATH) {
  const file = path.resolve(projectRoot, configPath)
  if (!fs.existsSync(file)) {
    throw new ConfigError(`${configPath} not found. Run /runbook:setup first.`)
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new ConfigError(`${configPath} is not valid JSON: ${err.message}`)
  }
  if (raw.version !== 1) throw new ConfigError(`${configPath}: unsupported version ${raw.version}, expected 1`)
  const config = { ...DEFAULTS, ...raw }
  for (const key of ['paths', 'app', 'data', 'tickets', 'git', 'commits', 'mcp']) {
    config[key] = { ...DEFAULTS[key], ...raw[key] }
  }
  if (!STACKS[config.stack]) throw new ConfigError(`stack must be one of ${Object.keys(STACKS).join(', ')}`)
  config.tests = { ...raw.tests }
  // Configs written before tests.ui kept the Playwright folder in paths.e2e.
  if (!config.tests.ui && config.paths.e2e) config.tests.ui = { framework: 'playwright', dir: config.paths.e2e }
  for (const listName of ['entries', 'requirements']) {
    config[listName].forEach((source, index) => validateSource(listName, source, index))
  }
  for (const [type, policy] of Object.entries(config.commits)) {
    if (!COMMIT_POLICIES.includes(policy)) {
      throw new ConfigError(`commits.${type} must be one of ${COMMIT_POLICIES.join(', ')}`)
    }
  }
  return config
}
