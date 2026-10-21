import fs from 'node:fs'
import path from 'node:path'
import { rolesEnabled, rolesFileOf } from './config.mjs'

export class RolesError extends Error {}

export const BASE_ACTIONS = ['view', 'create', 'edit', 'delete']
export const OUTCOMES = ['allowed', 'read-only', 'hidden', 'denied', 'partial']
export const API_OUTCOMES = ['allowed', 'denied', 'partial']
export const CLOSING_OUTCOMES = ['read-only', 'hidden', 'denied']
export const ORIGINS = ['code', 'contract', 'guess']
// Each review reason and the fields an entry with that reason needs besides reason and date.
export const REVIEW_FIELDS = {
  'roles-enabled': [],
  'role-permissions': ['role', 'key', 'change'],
  'role-created': ['role'],
  'role-deleted': ['role'],
}
export const REVIEW_REASONS = Object.keys(REVIEW_FIELDS)
export const ROLE_NAME = /^[a-z0-9][a-z0-9-]*$/

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

// A key is "<capability>/<feature>" or "<capability>/*". Neither part is empty or holds a slash.
function splitKey(key) {
  const parts = key.split('/')
  return parts.length === 2 && parts[0] && parts[1] ? parts : null
}

function parseRole(name, entry, actions) {
  if (!isObject(entry)) throw new RolesError(`role "${name}" must be an object`)
  const inherits = entry.inherits ?? []
  const found = entry.found ?? []
  const permissions = entry.permissions ?? {}
  const origins = entry.origins ?? {}
  if (!isStringList(inherits)) throw new RolesError(`${name}: inherits must be a list of role names`)
  if (!isStringList(found)) throw new RolesError(`${name}: found must be a list of strings`)
  if (!isObject(permissions)) throw new RolesError(`${name}: permissions must map each key to a list of actions`)
  if (!isObject(origins)) throw new RolesError(`${name}: origins must map each key to ${ORIGINS.join(', ')}`)
  for (const [key, list] of Object.entries(permissions)) {
    if (!splitKey(key)) throw new RolesError(`${name}: key "${key}" must be <capability>/<feature> or <capability>/*`)
    if (!isStringList(list)) throw new RolesError(`${name} "${key}": actions must be a list of strings`)
    for (const action of list) {
      if (!actions.includes(action)) throw new RolesError(`${name} "${key}": action "${action}" is not in actions`)
    }
  }
  for (const [key, origin] of Object.entries(origins)) {
    if (!Object.hasOwn(permissions, key)) throw new RolesError(`${name}: origins key "${key}" is not in permissions`)
    if (!ORIGINS.includes(origin)) throw new RolesError(`${name}: origin "${origin}" for "${key}" must be one of ${ORIGINS.join(', ')}`)
  }
  return {
    name,
    description: typeof entry.description === 'string' ? entry.description : '',
    inherits: [...inherits],
    found: [...found],
    permissions: Object.fromEntries(Object.entries(permissions).map(([key, list]) => [key, [...list]])),
    origins: { ...origins },
  }
}

// Depth-first walk over `inherits`. The path names the cycle when one closes.
function checkCycles(roles) {
  const done = new Set()
  const visit = (name, trail) => {
    if (trail.includes(name)) throw new RolesError(`inheritance cycle: ${[...trail.slice(trail.indexOf(name)), name].join(' -> ')}`)
    if (done.has(name)) return
    for (const parent of roles[name].inherits) visit(parent, [...trail, name])
    done.add(name)
  }
  for (const name of Object.keys(roles)) visit(name, [])
}

export function parseRoles(raw, { accounts } = {}) {
  if (!isObject(raw)) throw new RolesError('the registry must be a JSON object')
  if (raw.version !== 1) throw new RolesError(`unsupported version ${raw.version}, expected 1`)
  const extra = raw.actions ?? []
  if (!isStringList(extra)) throw new RolesError('actions must be a list of strings')
  const actions = [...BASE_ACTIONS, ...extra.filter((action) => !BASE_ACTIONS.includes(action))]
  const entries = raw.roles ?? {}
  if (!isObject(entries)) throw new RolesError('roles must map each role name to its entry')
  for (const name of Object.keys(entries)) {
    if (!ROLE_NAME.test(name)) throw new RolesError(`role "${name}" must be kebab-case`)
  }
  const roles = {}
  for (const [name, entry] of Object.entries(entries)) roles[name] = parseRole(name, entry, actions)
  if (!Object.hasOwn(roles, 'anonymous')) {
    roles.anonymous = { name: 'anonymous', description: 'No session', inherits: [], found: [], permissions: {}, origins: {} }
  }
  if (roles.anonymous.inherits.length > 0) throw new RolesError('anonymous inherits nothing')
  for (const role of Object.values(roles)) {
    for (const parent of role.inherits) {
      if (!Object.hasOwn(roles, parent)) throw new RolesError(`${role.name} inherits "${parent}", which is not a registered role`)
    }
  }
  checkCycles(roles)
  for (const account of Object.keys(accounts ?? {})) {
    if (account === 'anonymous') throw new RolesError('accounts.anonymous is not allowed, because anonymous has no session')
    if (!Object.hasOwn(roles, account)) throw new RolesError(`accounts.${account} is not a registered role`)
  }
  return { version: 1, actions, names: Object.keys(roles), roles }
}

export function loadRoles(projectRoot, config) {
  if (!rolesEnabled(config)) return null
  const rel = rolesFileOf(config)
  const file = path.join(projectRoot, rel)
  if (!fs.existsSync(file)) throw new RolesError(`${rel} not found`)
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new RolesError(`${rel} is not valid JSON: ${err.message}`)
  }
  try {
    return parseRoles(raw, { accounts: config.accounts })
  } catch (err) {
    if (err instanceof RolesError) throw new RolesError(`${rel}: ${err.message}`)
    throw err
  }
}

export function keyMatches(key, capability, feature) {
  const parts = splitKey(key)
  if (!parts || parts[0] !== capability) return false
  return parts[1] === '*' || parts[1] === feature
}

const unique = (list) => [...new Set(list)]

// Effective matrix of one role. An own entry replaces the inherited one for the same key.
// Keys only some parents have are the union of their actions.
export function effectivePermissions(registry, name) {
  const memo = new Map()
  const resolve = (roleName) => {
    if (memo.has(roleName)) return memo.get(roleName)
    const role = registry.roles[roleName]
    const inherited = {}
    for (const parent of role.inherits) {
      for (const [key, entry] of Object.entries(resolve(parent))) {
        const slot = (inherited[key] ??= { actions: [], from: [] })
        slot.actions = unique([...slot.actions, ...entry.actions])
        slot.from.push(parent)
      }
    }
    const result = {}
    for (const [key, slot] of Object.entries(inherited)) {
      result[key] = { actions: slot.actions, source: 'inherited', from: slot.from }
    }
    for (const [key, actions] of Object.entries(role.permissions)) {
      const parents = inherited[key]
      result[key] = { actions: [...actions], source: parents ? 'overridden' : 'own', from: parents ? parents.from : [] }
    }
    memo.set(roleName, result)
    return result
  }
  return resolve(name)
}

// The runbook's own key wins over "capability/*". A runbook without a feature uses "capability/*" only.
export function allowedActions(registry, name, capability, feature) {
  const matrix = effectivePermissions(registry, name)
  const entry = (feature !== null && feature !== undefined && matrix[`${capability}/${feature}`]) || matrix[`${capability}/*`]
  return entry ? [...entry.actions] : []
}

// Every role that inherits from `name`, directly or not.
export function heirsOf(registry, name) {
  const heirs = new Set()
  const walk = (target) => {
    for (const role of Object.values(registry.roles)) {
      if (role.inherits.includes(target) && !heirs.has(role.name)) {
        heirs.add(role.name)
        walk(role.name)
      }
    }
  }
  walk(name)
  return [...heirs].sort()
}

// Roles a ui runbook runs as that have no login in the config. API runbooks need no account.
export function noAccountRoles(config, runbook) {
  if (runbook.surface !== 'ui' || !Array.isArray(runbook.roles)) return []
  return runbook.roles.filter((role) => role !== 'anonymous' && !Object.hasOwn(config.accounts ?? {}, role))
}

// Catches typos: a key that matches no runbook and no slice.
export function matrixWarnings(registry, runbooks, slices) {
  const sliceNames = Array.isArray(slices) ? slices : Object.keys(slices ?? {})
  const warnings = []
  for (const name of registry.names) {
    for (const key of Object.keys(registry.roles[name].permissions)) {
      const capability = key.split('/')[0]
      const hit = runbooks.some((rb) => keyMatches(key, rb.capability, rb.feature)) || sliceNames.includes(capability)
      if (!hit) warnings.push(`roles.json: ${name} "${key}" matches no runbook or slice`)
    }
  }
  return warnings
}
