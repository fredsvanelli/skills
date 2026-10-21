// A call is an operation of the upstream API that a ui runbook's screens reach: "METHOD /path".
// It never counts as coverage and never makes an orphan; see docs/adr/0005.
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const CALL = new RegExp(`^(${METHODS.join('|')}) (/\\S*)$`)

// Next.js segments ([id], [...path], [[...path]]) become OpenAPI parameters ({id}, {path}). Null when it is no call.
export function normalizeCall(text) {
  const match = CALL.exec(String(text).trim())
  if (!match) return null
  const route = match[2].replace(/\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\]/g, (_, a, b, c) => `{${a ?? b ?? c}}`)
  return `${match[1]} ${route}`
}
