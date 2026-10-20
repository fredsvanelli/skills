import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_CONFIG_PATH = 'docs/runbooks/runbooks.config.json'
// Where the config lived before the plugin was renamed from runbook to runbooks.
export const LEGACY_CONFIG_PATH = 'docs/runbooks/runbook.config.json'

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
  paths: { runbooks: 'docs/runbooks', evidence: '.runbooks/evidence', e2e: null },
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
  mcp: { headless: 'runbooks-playwright', headed: 'runbooks-playwright-headed', secretsFile: '.env.local' },
  viewports: {},
  design: null,
  upstream: null,
}

const DESIGN_SYSTEMS = ['figma', 'claude-design', 'adobe-xd', 'files', 'other']
// Where each design system's references come from: an MCP server, exported files, or either.
const DESIGN_NEEDS = { figma: ['mcp', 'files'], 'adobe-xd': ['files'], files: ['files'], other: ['mcp', 'files'] }

function validateDesign(design, stack) {
  if (design === null) return
  if (typeof design !== 'object' || Array.isArray(design)) throw new ConfigError('design must be an object with a "system"')
  if (!surfacesOf(stack).includes('ui')) throw new ConfigError(`design applies only to ui runbooks, and a ${stack} stack has none`)
  if (!DESIGN_SYSTEMS.includes(design.system)) throw new ConfigError(`design.system must be one of ${DESIGN_SYSTEMS.join(', ')}`)
  const needs = DESIGN_NEEDS[design.system] ?? []
  if (needs.length > 0 && !needs.some((key) => design[key])) {
    throw new ConfigError(`design: ${design.system} needs ${needs.map((key) => `"${key}"`).join(' or ')}`)
  }
}

const UPSTREAM_MODES = ['live', 'mocked']

// The upstream block is absent in live projects, so a missing block means live.
export const upstreamModeOf = (config) => config.upstream?.mode ?? 'live'

function validateUpstream(upstream, stack) {
  if (upstream === null) return
  if (typeof upstream !== 'object' || Array.isArray(upstream)) throw new ConfigError('upstream must be an object with a "mode"')
  if (!surfacesOf(stack).includes('ui')) throw new ConfigError(`upstream applies only to ui runbooks, and a ${stack} stack has none`)
  if (!UPSTREAM_MODES.includes(upstream.mode)) throw new ConfigError(`upstream.mode must be one of ${UPSTREAM_MODES.join(', ')}`)
  if (upstream.mode === 'mocked' && !upstream.urlEnv) {
    throw new ConfigError('upstream.urlEnv is required when upstream.mode is mocked')
  }
  if (!Number.isInteger(upstream.port) || upstream.port < 1 || upstream.port > 65535) {
    throw new ConfigError('upstream.port must be an integer from 1 to 65535')
  }
  if (upstream.schema !== null && !(typeof upstream.schema === 'string' && upstream.schema.endsWith('.json'))) {
    throw new ConfigError('upstream.schema must be a JSON file (a local OpenAPI 3 .json path)')
  }
  if (!Array.isArray(upstream.redactHeaders) || upstream.redactHeaders.some((name) => typeof name !== 'string' || !name)) {
    throw new ConfigError('upstream.redactHeaders must be a list of header names')
  }
}

const isSize = (value) => Number.isInteger(value) && value > 0

function validateViewports(viewports) {
  if (typeof viewports !== 'object' || viewports === null || Array.isArray(viewports)) {
    throw new ConfigError('viewports must map each name to { "width", "height" }')
  }
  for (const [name, size] of Object.entries(viewports)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new ConfigError(`viewports.${name}: names are kebab-case`)
    if (!isSize(size?.width) || !isSize(size?.height)) {
      throw new ConfigError(`viewports.${name}: width and height must be positive integers`)
    }
  }
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
    if (configPath === DEFAULT_CONFIG_PATH && fs.existsSync(path.resolve(projectRoot, LEGACY_CONFIG_PATH))) {
      throw new ConfigError(`${configPath} not found, but ${LEGACY_CONFIG_PATH} exists. Run /runbooks:setup to migrate it.`)
    }
    throw new ConfigError(`${configPath} not found. Run /runbooks:setup first.`)
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
  validateViewports(config.viewports)
  validateDesign(config.design, config.stack)
  if (raw.upstream != null) {
    config.upstream = {
      mode: 'live', baseUrl: '', start: [], root: null, urlEnv: '', port: 4010,
      fixtures: `${config.paths.runbooks}/_fixtures`, schema: null, redactHeaders: [], tokenEnv: '', serverFile: null,
      ...raw.upstream,
    }
  }
  validateUpstream(config.upstream, config.stack)
  for (const [type, policy] of Object.entries(config.commits)) {
    if (!COMMIT_POLICIES.includes(policy)) {
      throw new ConfigError(`commits.${type} must be one of ${COMMIT_POLICIES.join(', ')}`)
    }
  }
  return config
}
