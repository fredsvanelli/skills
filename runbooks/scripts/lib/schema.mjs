// A minimal OpenAPI 3 JSON-schema validator: type, nullable, properties, required, items, enum,
// local $ref, allOf, oneOf and anyOf. Other keywords are ignored.
function typeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function resolveRef(ref, doc) {
  if (!ref.startsWith('#/')) return null
  let node = doc
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]
  }
  return node ?? null
}

function typeMatches(type, value) {
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  return typeName(value) === type
}

function check(value, schema, doc, where, depth) {
  if (!schema || typeof schema !== 'object' || depth > 50) return []
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, doc)
    if (!target) return [`${where}: cannot resolve ${schema.$ref}`]
    return check(value, target, doc, where, depth + 1)
  }
  if (value === null && schema.nullable === true) return []
  const problems = []
  for (const sub of schema.allOf ?? []) problems.push(...check(value, sub, doc, where, depth + 1))
  for (const key of ['oneOf', 'anyOf']) {
    const branches = schema[key]
    if (Array.isArray(branches) && branches.length > 0
      && !branches.some((branch) => check(value, branch, doc, where, depth + 1).length === 0)) {
      problems.push(`${where}: matches no branch of ${key}`)
    }
  }
  if (typeof schema.type === 'string' && !typeMatches(schema.type, value)) {
    problems.push(`${where}: expected ${schema.type}, got ${typeName(value)}`)
    return problems
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    problems.push(`${where}: ${JSON.stringify(value)} is not one of ${schema.enum.map((o) => JSON.stringify(o)).join(', ')}`)
  }
  if (typeName(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${where}.${key}: required, missing`)
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...check(value[key], sub, doc, `${where}.${key}`, depth + 1))
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => problems.push(...check(item, schema.items, doc, `${where}[${index}]`, depth + 1)))
  }
  return problems
}

export function validateSchema(value, schema, doc) {
  return check(value, schema, doc, 'body', 0)
}
