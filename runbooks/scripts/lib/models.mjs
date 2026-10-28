import { parseArgs } from './args.mjs'

export const MODEL_VALUES = ['inline', 'haiku', 'sonnet', 'opus', 'fable']

export const COMMAND_NAMES = [
  'check', 'list', 'ui', 'upgrade', 'roles:list', 'contexts:list', 'help', 'setup', 'settings',
  'roles:create', 'roles:update', 'roles:delete',
  'contexts:create', 'contexts:update', 'contexts:delete',
  'permissions:manage', 'orchestrator',
  'coverage', 'run', 'whats-next', 'map', 'audit', 'roles:generate',
  'create', 'update', 'to-test',
]

export const DEFAULT_MODELS = {
  check: 'inline', list: 'inline', ui: 'inline', upgrade: 'inline',
  'roles:list': 'inline', 'contexts:list': 'inline', help: 'inline',
  setup: 'inline', settings: 'inline',
  'roles:create': 'inline', 'roles:update': 'inline', 'roles:delete': 'inline',
  'contexts:create': 'inline', 'contexts:update': 'inline', 'contexts:delete': 'inline',
  'permissions:manage': 'inline', orchestrator: 'inline', 'run --mode guided': 'inline',
  coverage: 'haiku', 'run --mode test': 'haiku', 'run --mode prompt': 'haiku', 'run --import': 'haiku',
  run: 'sonnet', 'help <question>': 'sonnet', 'whats-next': 'sonnet', map: 'sonnet',
  audit: 'sonnet', 'roles:generate': 'sonnet',
  'audit --fix': 'opus', create: 'opus', update: 'opus', 'to-test': 'opus',
}

export function parseKey(key) {
  const { command, options, positionals } = parseArgs(key.split(/\s+/).filter(Boolean))
  const placeholders = positionals.filter((token) => /^<[^<>]+>$/.test(token))
  if (placeholders.length !== positionals.length) throw new Error(`Invalid model row key: ${key}`)
  return { command, options, positional: placeholders.length > 0 }
}

function matches(parsed, invocation) {
  if (parsed.command !== invocation.command) return false
  if (parsed.positional && invocation.positionals.length === 0) return false
  return Object.entries(parsed.options).every(([name, value]) => {
    const given = invocation.options[name]
    return given !== undefined && (value === true || value === given)
  })
}

export function resolveModel(rows, argv) {
  const invocation = parseArgs(argv)
  if ('model' in invocation.options) {
    const model = invocation.options.model
    if (!MODEL_VALUES.includes(model)) throw new Error(`--model must be one of ${MODEL_VALUES.join(', ')}`)
    return { model, row: null, forced: true }
  }
  let best = null
  for (const [row, model] of Object.entries(rows)) {
    const parsed = parseKey(row)
    if (!matches(parsed, invocation)) continue
    const score = Object.keys(parsed.options).length + (parsed.positional ? 1 : 0)
    const rank = MODEL_VALUES.indexOf(model)
    if (!best || score > best.score || (score === best.score && rank > best.rank)) best = { row, model, score, rank }
  }
  if (!best) return { model: 'inline', row: null, forced: false }
  return { model: best.model, row: best.row, forced: false }
}

export function modelRowsDiff(own, defaults = DEFAULT_MODELS) {
  const missing = Object.keys(defaults).filter((key) => !(key in own))
  const differing = Object.entries(own)
    .filter(([key, value]) => key in defaults && defaults[key] !== value)
    .map(([key, value]) => ({ key, value, default: defaults[key] }))
  return { missing, differing }
}
