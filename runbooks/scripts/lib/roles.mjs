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
export function splitKey(key) {
  const parts = key.split('/')
  return parts.length === 2 && parts[0] && parts[1] ? parts : null
}

// The context of `contexts` (a name-to-context object) that a matrix key belongs to, or null.
// A context lists the key itself or, for "<capability>/<feature>", "<capability>/*".
function contextIn(contexts, key) {
  const parts = splitKey(key)
  for (const context of Object.values(contexts)) {
    if (context.keys.includes(key) || (parts && parts[1] !== '*' && context.keys.includes(`${parts[0]}/*`))) return context
  }
  return null
}

function parseContexts(raw) {
  if (!isObject(raw)) throw new RolesError('contexts must map each context name to its entry')
  const contexts = {}
  const caseOwner = {}
  for (const [name, entry] of Object.entries(raw)) {
    if (!ROLE_NAME.test(name)) throw new RolesError(`context "${name}" must be kebab-case`)
    if (!isObject(entry)) throw new RolesError(`context "${name}" must be an object`)
    if (!isStringList(entry.keys)) throw new RolesError(`context "${name}": keys must be a list of matrix keys`)
    for (const key of entry.keys) {
      if (!splitKey(key)) throw new RolesError(`context "${name}": key "${key}" must be <capability>/<feature> or <capability>/*`)
    }
    if (!isObject(entry.cases) || !Object.values(entry.cases).every((text) => typeof text === 'string')) {
      throw new RolesError(`context "${name}": cases must map each case to a description`)
    }
    for (const kase of Object.keys(entry.cases)) {
      if (!ROLE_NAME.test(kase)) throw new RolesError(`case "${kase}" must be kebab-case`)
      if (Object.hasOwn(caseOwner, kase)) throw new RolesError(`case "${kase}" appears in contexts ${caseOwner[kase]} and ${name}`)
      caseOwner[kase] = name
    }
    contexts[name] = {
      name,
      description: typeof entry.description === 'string' ? entry.description : '',
      keys: [...entry.keys],
      cases: Object.keys(entry.cases),
      descriptions: { ...entry.cases },
    }
  }
  // Two contexts claim a key when they list the same key, or one lists "<capability>/*" and the other a key of that capability.
  const claims = Object.values(contexts).flatMap((context) => context.keys.map((key) => ({ context: context.name, key })))
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const [a, b] = [claims[i], claims[j]]
      if (a.context === b.context) continue
      const [partsA, partsB] = [splitKey(a.key), splitKey(b.key)]
      if (partsA[0] !== partsB[0]) continue
      if (a.key !== b.key && partsA[1] !== '*' && partsB[1] !== '*') continue
      const specific = partsA[1] === '*' ? b.key : a.key
      throw new RolesError(`key "${specific}" belongs to contexts ${a.context} and ${b.context}`)
    }
  }
  return contexts
}

function parseRole(name, entry, actions, contexts) {
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
    const checkList = (items, label) => {
      if (!isStringList(items)) throw new RolesError(`${label}: actions must be a list of strings`)
      for (const action of items) {
        if (!actions.includes(action)) throw new RolesError(`${label}: action "${action}" is not in actions`)
      }
    }
    if (isObject(list)) {
      const context = contextIn(contexts, key)
      if (!context) throw new RolesError(`${name} "${key}": a map of cases needs a key that belongs to a context`)
      for (const [kase, items] of Object.entries(list)) {
        if (!context.cases.includes(kase)) throw new RolesError(`${name} "${key}": case "${kase}" is not a case of ${context.name}`)
        checkList(items, `${name} "${key}" in ${kase}`)
      }
    } else {
      checkList(list, `${name} "${key}"`)
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
    permissions: Object.fromEntries(Object.entries(permissions).map(([key, list]) => [key, Array.isArray(list)
      ? [...list]
      : Object.fromEntries(Object.entries(list).map(([kase, items]) => [kase, [...items]]))])),
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
  if (raw.version !== 1 && raw.version !== 2) throw new RolesError(`unsupported version ${raw.version}, expected 1 or 2`)
  if (raw.version === 1 && raw.contexts !== undefined) throw new RolesError('contexts need version 2')
  const contexts = raw.contexts === undefined ? {} : parseContexts(raw.contexts)
  const extra = raw.actions ?? []
  if (!isStringList(extra)) throw new RolesError('actions must be a list of strings')
  const actions = [...BASE_ACTIONS, ...extra.filter((action) => !BASE_ACTIONS.includes(action))]
  const entries = raw.roles ?? {}
  if (!isObject(entries)) throw new RolesError('roles must map each role name to its entry')
  for (const name of Object.keys(entries)) {
    if (!ROLE_NAME.test(name)) throw new RolesError(`role "${name}" must be kebab-case`)
  }
  const roles = {}
  for (const [name, entry] of Object.entries(entries)) roles[name] = parseRole(name, entry, actions, contexts)
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
  const caseNames = Object.values(contexts).flatMap((context) => context.cases)
  return { version: raw.version, actions, names: Object.keys(roles), roles, contexts, caseNames }
}

// The registry as written, for the commands that edit it and must keep the fields the loader drops.
export function readRolesFile(projectRoot, config) {
  const rel = rolesFileOf(config)
  const file = path.join(projectRoot, rel)
  if (!fs.existsSync(file)) throw new RolesError(`${rel} not found`)
  try {
    return { rel, file, raw: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (err) {
    throw new RolesError(`${rel} is not valid JSON: ${err.message}`)
  }
}

export function loadRoles(projectRoot, config) {
  if (!rolesEnabled(config)) return null
  const { rel, raw } = readRolesFile(projectRoot, config)
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

// The context name a matrix key belongs to, or null.
export function contextOfKey(registry, key) {
  return contextIn(registry.contexts, key)?.name ?? null
}

// The context with a key that matches the runbook, or null.
export function contextOfRunbook(registry, capability, feature) {
  for (const context of Object.values(registry.contexts)) {
    if (context.keys.some((key) => keyMatches(key, capability, feature))) return context.name
  }
  return null
}

// Effective matrix of one role. An own entry replaces the inherited one for the same key.
// Keys only some parents have are the union of their actions. On a key of a context the union
// is per case, a list counts as the same list in every case, and the entry carries `cases`.
// A key of no context has no `cases` property.
export function effectivePermissions(registry, name) {
  const memo = new Map()
  const casesOf = (key) => contextIn(registry.contexts, key)?.cases ?? null
  const perCase = (key, value) => {
    const names = casesOf(key)
    return Object.fromEntries(names.map((kase) => [kase, Array.isArray(value) ? [...value] : [...(Object.hasOwn(value, kase) ? value[kase] : [])]]))
  }
  const resolve = (roleName) => {
    if (memo.has(roleName)) return memo.get(roleName)
    const role = registry.roles[roleName]
    const inherited = {}
    for (const parent of role.inherits) {
      for (const [key, entry] of Object.entries(resolve(parent))) {
        const slot = (inherited[key] ??= { actions: [], cases: casesOf(key) ? Object.fromEntries(casesOf(key).map((kase) => [kase, []])) : null, from: [] })
        slot.actions = unique([...slot.actions, ...entry.actions])
        if (slot.cases) for (const kase of Object.keys(slot.cases)) slot.cases[kase] = unique([...slot.cases[kase], ...entry.cases[kase]])
        slot.from.push(parent)
      }
    }
    const result = {}
    const build = (key, actions, cases, source, from) => {
      result[key] = cases ? { actions: unique(Object.values(cases).flat()), cases, source, from } : { actions, source, from }
    }
    for (const [key, slot] of Object.entries(inherited)) {
      build(key, slot.actions, slot.cases, 'inherited', slot.from)
    }
    for (const [key, value] of Object.entries(role.permissions)) {
      const parents = inherited[key]
      const source = parents ? 'overridden' : 'own'
      const from = parents ? parents.from : []
      if (casesOf(key)) build(key, null, perCase(key, value), source, from)
      else build(key, [...value], null, source, from)
    }
    memo.set(roleName, result)
    return result
  }
  return resolve(name)
}

// The entry for a runbook with its key: the runbook's own key wins over "capability/*".
function entryFor(matrix, capability, feature) {
  const own = feature !== null && feature !== undefined ? `${capability}/${feature}` : null
  if (own && matrix[own]) return { key: own, entry: matrix[own] }
  const star = `${capability}/*`
  return matrix[star] ? { key: star, entry: matrix[star] } : null
}

// A runbook without a feature uses "capability/*" only. On a key of a context, `kase` picks the case.
export function allowedActions(registry, name, capability, feature, kase = null) {
  const found = entryFor(effectivePermissions(registry, name), capability, feature)
  if (!found) return []
  const { key, entry } = found
  if (!entry.cases) return [...entry.actions]
  const context = contextOfKey(registry, key)
  if (kase === null || kase === undefined) throw new RolesError(`"${key}" depends on context ${context}; pass a case`)
  return Object.hasOwn(entry.cases, kase) ? [...entry.cases[kase]] : []
}

// The actions of a role on a runbook in every case of its context, or null when the runbook has no context.
export function actionsByCase(registry, name, capability, feature) {
  const context = contextOfRunbook(registry, capability, feature)
  if (context === null) return null
  const found = entryFor(effectivePermissions(registry, name), capability, feature)
  return Object.fromEntries(registry.contexts[context].cases.map((kase) => {
    if (!found) return [kase, []]
    const { entry } = found
    return [kase, entry.cases ? [...(Object.hasOwn(entry.cases, kase) ? entry.cases[kase] : [])] : [...entry.actions]]
  }))
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
  for (const context of Object.values(registry.contexts)) {
    for (const key of context.keys) {
      const hit = runbooks.some((rb) => keyMatches(key, rb.capability, rb.feature)) || sliceNames.includes(key.split('/')[0])
      if (!hit) warnings.push(`roles.json: context ${context.name} key "${key}" matches no runbook or slice`)
    }
    if (context.cases.length < 2) warnings.push(`roles.json: context ${context.name} has fewer than two cases`)
  }
  return warnings
}
