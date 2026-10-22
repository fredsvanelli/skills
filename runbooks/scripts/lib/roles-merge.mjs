// A proposal of roles, contexts and permissions merged into roles.json. /runbooks:roles:generate reads a
// document, writes the proposal as JSON, and this module checks it, merges it and reports what changes.
import fs from 'node:fs'
import { parseRoles, readRolesFile, splitKey, contextOfKey, RolesError, BASE_ACTIONS } from './roles.mjs'

const PROPOSAL_FIELDS = ['actions', 'contexts', 'roles', 'remove']
const ROLE_FIELDS = ['description', 'inherits', 'found', 'permissions', 'origins']
const CONTEXT_FIELDS = ['description', 'keys', 'cases']
const ACTION_NAME = /^[a-z][a-z0-9-]*$/

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item))

function checkFields(entry, allowed, label) {
  if (!isObject(entry)) throw new RolesError(`${label} must be an object`)
  const unknown = Object.keys(entry).filter((field) => !allowed.includes(field))
  if (unknown.length > 0) throw new RolesError(`${label}: unknown field ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`)
}

// The shape of the proposal. The registry rules (kebab-case names, known actions, cases of the context,
// cycles) are checked later, on the merged registry, by the loader.
function checkProposal(proposal, raw) {
  checkFields(proposal, PROPOSAL_FIELDS, 'the proposal')
  const actions = proposal.actions ?? []
  if (!isStringList(actions)) throw new RolesError('actions must be a list of action names')
  for (const action of actions) {
    if (!ACTION_NAME.test(action)) throw new RolesError(`action "${action}" must be lowercase English, like approve`)
  }
  const contexts = proposal.contexts ?? {}
  if (!isObject(contexts)) throw new RolesError('contexts must map each context name to its entry')
  for (const [name, entry] of Object.entries(contexts)) {
    checkFields(entry, CONTEXT_FIELDS, `context "${name}"`)
    const known = Object.hasOwn(raw.contexts ?? {}, name)
    if (entry.keys !== undefined && !isStringList(entry.keys)) throw new RolesError(`context "${name}": keys must be a list of matrix keys`)
    if (entry.cases !== undefined && (!isObject(entry.cases) || !Object.values(entry.cases).every((text) => typeof text === 'string'))) {
      throw new RolesError(`context "${name}": cases must map each case to a description`)
    }
    if (!known && (entry.keys === undefined || entry.cases === undefined)) throw new RolesError(`context "${name}" is new, so it needs keys and cases`)
  }
  const roles = proposal.roles ?? {}
  if (!isObject(roles)) throw new RolesError('roles must map each role name to its entry')
  for (const [name, entry] of Object.entries(roles)) {
    checkFields(entry, ROLE_FIELDS, `role "${name}"`)
    const current = raw.roles?.[name]
    if (current !== undefined || name === 'anonymous') {
      const parents = current?.inherits ?? []
      if (entry.inherits !== undefined && !(isStringList(entry.inherits) && sameSet(entry.inherits, parents))) {
        throw new RolesError(`role "${name}" is registered, so its parents change with /runbooks:roles:update`)
      }
      if (entry.found !== undefined) throw new RolesError(`role "${name}" is registered, so found applies to a new role only`)
    } else if (typeof entry.description !== 'string' || entry.description.trim() === '') {
      throw new RolesError(`role "${name}" is new, so it needs a description`)
    }
    if (entry.permissions !== undefined && !isObject(entry.permissions)) throw new RolesError(`${name}: permissions must map each key to a list of actions`)
    const permissions = entry.permissions ?? {}
    for (const key of Object.keys(permissions)) {
      if (!splitKey(key)) throw new RolesError(`${name}: key "${key}" must be <capability>/<feature> or <capability>/*`)
    }
    const origins = entry.origins ?? {}
    if (!isObject(origins)) throw new RolesError(`${name}: origins must map each key to guess`)
    for (const [key, origin] of Object.entries(origins)) {
      if (origin !== 'guess') throw new RolesError(`${name}: origin "${origin}" for "${key}" must be guess; a key the source states has no origin`)
      if (!Object.hasOwn(permissions, key)) throw new RolesError(`${name}: origins key "${key}" is not in permissions`)
    }
  }
  const remove = proposal.remove ?? []
  if (!Array.isArray(remove)) throw new RolesError('remove must be a list of { role, key }')
  const removed = new Set()
  for (const item of remove) {
    if (!isObject(item) || typeof item.role !== 'string' || typeof item.key !== 'string') throw new RolesError('remove must be a list of { role, key }')
    if (!Object.hasOwn(raw.roles?.[item.role]?.permissions ?? {}, item.key)) throw new RolesError(`remove: ${item.role} has no own key "${item.key}"`)
    if (Object.hasOwn(roles[item.role]?.permissions ?? {}, item.key)) throw new RolesError(`${item.role} "${item.key}" is both in permissions and in remove`)
    const id = `${item.role}\n${item.key}`
    if (removed.has(id)) throw new RolesError(`remove: ${item.role} "${item.key}" appears twice`)
    removed.add(id)
  }
}

// contexts goes after actions, or after version when the file has no actions.
function withContexts(raw, contexts) {
  if (Object.hasOwn(raw, 'contexts')) return { ...raw, contexts }
  const anchor = Object.hasOwn(raw, 'actions') ? 'actions' : 'version'
  const next = {}
  for (const [field, value] of Object.entries(raw)) {
    next[field] = value
    if (field === anchor) next.contexts = contexts
  }
  return next
}

function mergeContexts(raw, proposed) {
  const contexts = { ...(raw.contexts ?? {}) }
  const added = []
  const changed = []
  for (const [name, entry] of Object.entries(proposed)) {
    const current = contexts[name]
    if (current === undefined) {
      contexts[name] = { description: entry.description ?? '', keys: [...entry.keys], cases: { ...entry.cases } }
      added.push({ name, keys: [...entry.keys], cases: Object.keys(entry.cases) })
      continue
    }
    const keysAdded = (entry.keys ?? []).filter((key) => !current.keys.includes(key))
    const cases = { ...current.cases }
    const casesAdded = []
    const described = []
    for (const [kase, text] of Object.entries(entry.cases ?? {})) {
      if (!Object.hasOwn(cases, kase)) casesAdded.push(kase)
      else if (cases[kase] !== text) described.push(kase)
      cases[kase] = text
    }
    const description = entry.description ?? current.description
    if (description !== current.description) described.unshift('description')
    if (keysAdded.length === 0 && casesAdded.length === 0 && described.length === 0) continue
    contexts[name] = { ...current, description, keys: [...current.keys, ...keysAdded], cases }
    changed.push({ name, keysAdded, casesAdded, described })
  }
  return { contexts, added, changed }
}

// Both entries expanded to a map over the cases of the key's context, so a list equals the full map of that list.
function sameEntry(registry, key, a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return sameSet(a, b)
  const context = contextOfKey(registry, key)
  if (context === null) return false
  const at = (value, kase) => (Array.isArray(value) ? value : Object.hasOwn(value, kase) ? value[kase] : [])
  return registry.contexts[context].cases.every((kase) => sameSet(at(a, kase), at(b, kase)))
}

// An entry in the order of the registry's actions, and a map in the order of its context's cases. An action
// or a case the registry lacks stays at the end, so the loader names it.
const inOrder = (order, items) => [...order.filter((item) => items.includes(item)), ...items.filter((item) => !order.includes(item))]

function sortEntry(registry, key, entry) {
  const sorted = (actions) => inOrder(registry.actions, actions)
  if (Array.isArray(entry)) return sorted(entry)
  const context = contextOfKey(registry, key)
  const cases = context === null ? Object.keys(entry) : inOrder(registry.contexts[context].cases, Object.keys(entry))
  return Object.fromEntries(cases.map((kase) => [kase, sorted(entry[kase])]))
}

// Keys keep their order in the file and new keys follow in proposal order. An unchanged key keeps its list and
// its origin. A key added or changed gets the proposal's origin, which is guess or none; a removed key loses it.
function mergeMatrix(registry, entry, proposed, removed) {
  const before = entry.permissions ?? {}
  const origins = { ...(entry.origins ?? {}) }
  const proposedKeys = proposed.permissions ?? {}
  const permissions = {}
  const changes = []
  const setOrigin = (key) => {
    if (proposed.origins?.[key] === 'guess') origins[key] = 'guess'
    else delete origins[key]
  }
  for (const [key, actions] of Object.entries(before)) {
    if (removed.includes(key)) {
      changes.push({ key, before: actions, after: null })
      delete origins[key]
    } else if (!Object.hasOwn(proposedKeys, key) || sameEntry(registry, key, actions, proposedKeys[key])) {
      permissions[key] = actions
    } else {
      const after = sortEntry(registry, key, proposedKeys[key])
      permissions[key] = after
      changes.push({ key, before: actions, after, guess: proposed.origins?.[key] === 'guess' })
      setOrigin(key)
    }
  }
  for (const [key, actions] of Object.entries(proposedKeys)) {
    if (Object.hasOwn(before, key)) continue
    const after = sortEntry(registry, key, actions)
    permissions[key] = after
    changes.push({ key, before: null, after, guess: proposed.origins?.[key] === 'guess' })
    setOrigin(key)
  }
  const next = { ...entry, permissions }
  if (Object.keys(origins).length > 0) next.origins = origins
  else delete next.origins
  return { next, changes }
}

// The loader, with the file's errors named as the merge's.
function load(next, config) {
  try {
    return parseRoles(next, { accounts: config.accounts })
  } catch (err) {
    if (err instanceof RolesError) throw new RolesError(`the merged registry does not load: ${err.message}`)
    throw err
  }
}

export function planMerge(root, config, proposalText, { write = false } = {}) {
  const { rel, file, raw } = readRolesFile(root, config)
  let proposal
  try {
    proposal = JSON.parse(proposalText)
  } catch (err) {
    throw new RolesError(`the proposal is not valid JSON: ${err.message}`)
  }
  checkProposal(proposal, raw)

  const known = [...BASE_ACTIONS, ...(raw.actions ?? [])]
  const actionsAdded = [...new Set(proposal.actions ?? [])].filter((action) => !known.includes(action))
  let next = { ...raw, roles: { ...(raw.roles ?? {}) } }
  if (actionsAdded.length > 0) next.actions = [...(raw.actions ?? []), ...actionsAdded]
  const merged = mergeContexts(raw, proposal.contexts ?? {})
  if (Object.keys(merged.contexts).length > 0) {
    next = withContexts(next, merged.contexts)
    if (next.version === 1) next.version = 2
  }

  // New roles first, with no permissions, so the registry the entries are sorted against knows every name.
  const proposedRoles = proposal.roles ?? {}
  const rolesAdded = Object.keys(proposedRoles).filter((name) => !Object.hasOwn(raw.roles ?? {}, name) && name !== 'anonymous')
  for (const name of rolesAdded) {
    const entry = proposedRoles[name]
    next.roles[name] = {
      description: entry.description,
      ...(entry.inherits?.length ? { inherits: [...entry.inherits] } : {}),
      found: entry.found?.length ? [...entry.found] : ['user'],
      permissions: {},
    }
  }
  const registry = load({ ...next, roles: Object.fromEntries(Object.entries(next.roles).map(([name, entry]) => [name, { ...entry, permissions: {}, origins: {} }])) }, config)

  const removeOf = (name) => (proposal.remove ?? []).filter((item) => item.role === name).map((item) => item.key)
  const changes = []
  const rolesChanged = []
  const newMatrix = {}
  const touched = new Set([...Object.keys(proposedRoles), ...(proposal.remove ?? []).map((item) => item.role)])
  for (const name of touched) {
    const entry = Object.hasOwn(next.roles, name) ? next.roles[name] : { description: 'No session' }
    const proposed = proposedRoles[name] ?? {}
    const result = mergeMatrix(registry, entry, proposed, removeOf(name))
    const isNew = rolesAdded.includes(name)
    const described = !isNew && proposed.description !== undefined && proposed.description !== (entry.description ?? '')
    if (described) {
      rolesChanged.push({ name, before: entry.description ?? '', after: proposed.description })
      result.next.description = proposed.description
    }
    if (result.changes.length === 0 && !described && !isNew) continue
    next.roles[name] = result.next
    if (isNew) newMatrix[name] = result.changes
    else changes.push(...result.changes.map((change) => ({ role: name, ...change })))
  }
  const loaded = load(next, config)

  // A map that leaves out a case: the maps the proposal wrote, and the maps of a context that gained a case.
  const writtenKeys = new Set([...changes, ...Object.entries(newMatrix).flatMap(([role, list]) => list.map((change) => ({ role, ...change })))]
    .map((change) => `${change.role}\n${change.key}`))
  const casesAddedTo = Object.fromEntries(merged.changed.map((context) => [context.name, context.casesAdded]))
  const missingCases = []
  for (const name of loaded.names) {
    for (const [key, actions] of Object.entries(loaded.roles[name].permissions)) {
      if (Array.isArray(actions)) continue
      const context = contextOfKey(loaded, key)
      const written = writtenKeys.has(`${name}\n${key}`)
      const missing = loaded.contexts[context].cases.filter((kase) => !Object.hasOwn(actions, kase)
        && (written || (casesAddedTo[context] ?? []).includes(kase)))
      if (missing.length > 0) missingCases.push({ role: name, key, cases: missing })
    }
  }

  const plan = {
    file: rel,
    actionsAdded,
    contextsAdded: merged.added,
    contextsChanged: merged.changed,
    rolesAdded: rolesAdded.map((name) => ({
      name,
      description: next.roles[name].description,
      inherits: next.roles[name].inherits ?? [],
      found: next.roles[name].found,
      permissions: next.roles[name].permissions,
      guesses: Object.keys(next.roles[name].origins ?? {}),
    })),
    rolesChanged,
    changes,
    missingCases,
    written: false,
  }
  const empty = actionsAdded.length === 0 && merged.added.length === 0 && merged.changed.length === 0
    && rolesAdded.length === 0 && rolesChanged.length === 0 && changes.length === 0
  if (write && !empty) {
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
    plan.written = true
  }
  return plan
}
