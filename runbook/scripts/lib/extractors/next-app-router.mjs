const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const DEFAULT_DROP = ['[locale]', '[lang]']

export function routeFromFile(file, dropSegments = DEFAULT_DROP) {
  const segments = file.split('/')
  const appIndex = segments.indexOf('app')
  if (appIndex === -1) return null
  const routeSegments = segments
    .slice(appIndex + 1, -1)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .filter((segment) => !segment.startsWith('@'))
    .filter((segment) => !dropSegments.includes(segment))
  return `/${routeSegments.join('/')}`
}

export function handlersFromSource(source) {
  const found = new Set()
  const declarations = /export\s+(?:async\s+)?(?:function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g
  for (const match of source.matchAll(declarations)) found.add(match[1])
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (METHODS.includes(name)) found.add(name)
    }
  }
  return METHODS.filter((method) => found.has(method))
}

export function nextAppRouterItems(file, content, source) {
  const base = file.split('/').pop()
  const route = routeFromFile(file, source.dropSegments)
  if (route === null) return []
  if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(base)) return [{ id: route, kind: 'ui-route' }]
  if (/^route\.(ts|js)$/.test(base)) {
    return handlersFromSource(content).map((method) => ({ id: `${method} ${route}`, kind: 'api-endpoint' }))
  }
  return []
}
