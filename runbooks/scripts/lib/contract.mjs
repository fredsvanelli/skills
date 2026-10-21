// The contract with an upstream API in another repository: the OpenAPI document it publishes, kept
// as upstream.schema. Calls and fixtures are checked against it, and a new version of it tells
// list --affected which runbooks it reaches; see docs/adr/0005.
import { isDeepStrictEqual } from 'node:util'
import { resolveRef } from './schema.mjs'
import { fixturesDir, loadFixtures, checkFixtures, serverPrefix } from './fixtures.mjs'
import { normalizeCall } from './calls.mjs'
import { loadRoles } from './roles.mjs'

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
// Parameter names do not change an operation: /quotes/{id} and /quotes/{quoteId} are one path.
const shape = (template) => template.replace(/\{[^}]+\}/g, '{}')
const splitCall = (call) => {
  const space = call.indexOf(' ')
  return [call.slice(0, space).toUpperCase(), call.slice(space + 1)]
}
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const deref = (node, doc) => (typeof node?.$ref === 'string' ? resolveRef(node.$ref, doc) : node)

// Every operation of the document, keyed "METHOD /template" as the document spells it.
function operations(doc) {
  const found = new Map()
  for (const [template, raw] of Object.entries(doc?.paths ?? {})) {
    const item = deref(raw, doc)
    for (const method of HTTP_METHODS) {
      if (item?.[method]) found.set(`${method.toUpperCase()} ${template}`, { method: method.toUpperCase(), template, item, operation: item[method] })
    }
  }
  return found
}

// The operation key a call names, also when the call keeps the server path (/v1/quotes); null when none.
export function matchCall(call, doc) {
  const [method, route] = splitCall(call)
  const prefix = serverPrefix(doc)
  const routes = [route, ...(prefix && route.startsWith(`${prefix}/`) ? [route.slice(prefix.length)] : [])]
  const ops = [...operations(doc).values()]
  for (const candidate of routes) {
    const op = ops.find((o) => o.method === method && shape(o.template) === shape(candidate))
    if (op) return `${op.method} ${op.template}`
  }
  return null
}

// Whether a call names a request the app sent; with a doc, its server path may lead the request path.
export function callServes(call, method, requestPath, doc = null) {
  const [callMethod, template] = splitCall(call)
  if (callMethod !== String(method).toUpperCase()) return false
  const pattern = new RegExp(`^${template.split(/\{[^}]+\}/).map(escapeRegex).join('[^/]+')}$`)
  const route = String(requestPath).split('?')[0]
  if (pattern.test(route)) return true
  const prefix = serverPrefix(doc)
  return Boolean(prefix) && route.startsWith(`${prefix}/`) && pattern.test(route.slice(prefix.length))
}

// Prose and vendor keys change no behavior. Inside these maps the keys are names (a property may be called "description").
const PROSE = new Set(['description', 'summary', 'title', 'example', 'examples', 'externalDocs', 'operationId', 'tags'])
const NAME_MAPS = new Set(['properties', 'patternProperties', 'responses', 'content', 'headers', 'encoding', 'links', 'callbacks'])

function canonical(node, doc, refs = [], names = false) {
  if (Array.isArray(node)) return node.map((item) => canonical(item, doc, refs))
  if (!node || typeof node !== 'object') return node
  if (!names && typeof node.$ref === 'string') {
    // A recursive schema stops at its second visit, so the comparison stays finite.
    const target = refs.includes(node.$ref) ? null : resolveRef(node.$ref, doc)
    return target === null ? { $ref: node.$ref } : canonical(target, doc, [...refs, node.$ref])
  }
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    if (!names && (PROSE.has(key) || key.startsWith('x-'))) continue
    out[key] = canonical(value, doc, refs, !names && NAME_MAPS.has(key))
  }
  return out
}

// The operation with the path item's parameters merged in, keyed by location and name.
function canonicalOperation({ item, operation }, doc) {
  const parameters = {}
  for (const raw of [...(item.parameters ?? []), ...(operation.parameters ?? [])]) {
    const parameter = canonical(raw, doc)
    parameters[`${parameter?.in}:${parameter?.name}`] = parameter
  }
  const { parameters: _, ...rest } = canonical(operation, doc)
  return { ...rest, parameters }
}

// [{ operation, change }] sorted by operation: added and changed carry the new document's key, removed the old one's.
export function changedOperations(before, after) {
  const byShape = (doc) => new Map([...operations(doc)].map(([key, op]) => [`${op.method} ${shape(op.template)}`, { key, op }]))
  const old = byShape(before)
  const next = byShape(after)
  const changes = []
  for (const [id, { key, op }] of next) {
    if (!old.has(id)) changes.push({ operation: key, change: 'added' })
    else if (!isDeepStrictEqual(canonicalOperation(old.get(id).op, before), canonicalOperation(op, after))) changes.push({ operation: key, change: 'changed' })
  }
  for (const [id, { key }] of old) if (!next.has(id)) changes.push({ operation: key, change: 'removed' })
  return changes.sort((a, b) => (a.operation < b.operation ? -1 : a.operation > b.operation ? 1 : 0))
}

// The ui runbooks that reach the upstream API: those with calls, and the mocked ones, whose fixtures answer for it.
export function checkContract({ root, config, runbooks, doc }) {
  const checked = runbooks.filter((rb) => rb.surface === 'ui' && rb.status !== 'deprecated' && (rb.calls.length > 0 || rb.upstream === 'mocked'))
  const findings = []
  // With role tracking on, @<role> fixture folders are read and checked like the others.
  const roles = loadRoles(root, config)?.names ?? null
  for (const rb of checked) {
    const add = (kind, message) => findings.push({ runbook: rb.id, kind, message })
    if (rb.upstream === 'mocked') {
      const { fixtures, problems } = loadFixtures(root, fixturesDir(config, rb), { roles })
      for (const problem of problems) add('fixture', problem)
      // In a monorepo a mocked runbook names its endpoints in covers.entries (docs/adr/0004).
      const names = [...rb.calls, ...rb.covers.entries.map(normalizeCall).filter(Boolean)]
      for (const fixture of fixtures) {
        const { method, path: requestPath } = fixture.request
        if (!names.some((call) => callServes(call, method, requestPath, doc))) {
          add('fixture', `${fixture.file}: requests ${String(method).toUpperCase()} ${String(requestPath).split('?')[0]}, which no call or entry of the runbook names`)
        }
        if (doc) for (const message of checkFixtures([fixture], doc)) add('fixture', message)
      }
    }
    if (doc) {
      for (const call of rb.calls.filter((c) => matchCall(c, doc) === null)) {
        add('call', `call ${call} matches no operation in ${config.upstream.schema}`)
      }
    }
  }
  return { runbooks: checked.map((rb) => rb.id), findings }
}
