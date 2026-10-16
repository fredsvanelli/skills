import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { routeFromFile, handlersFromSource, nextAppRouterItems } from './lib/extractors/next-app-router.mjs'
import { regexItems } from './lib/extractors/regex.mjs'
import { extractItems } from './lib/extract.mjs'
import { loadConfig } from './lib/config.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/project', import.meta.url))

test('routeFromFile drops groups and locale, keeps dynamic segments', () => {
  assert.equal(routeFromFile('src/app/[locale]/(dashboard)/deliveries/[id]/page.tsx'), '/deliveries/[id]')
  assert.equal(routeFromFile('src/app/[locale]/page.tsx'), '/')
  assert.equal(routeFromFile('app/@modal/settings/page.tsx'), '/settings')
  assert.equal(routeFromFile('src/app/admin/invoices/route.ts'), '/admin/invoices')
  assert.equal(routeFromFile('src/app/[tenant]/x/page.tsx', ['[tenant]']), '/x')
  assert.equal(routeFromFile('lib/foo/page.tsx'), null)
})

test('handlersFromSource reads every export style and ignores other exports', () => {
  const source = [
    'export const GET = () => 1',
    'export async function POST() {}',
    'export function PATCH() {}',
    'const h = () => 1',
    'export { h as DELETE, other }',
    "export const runtime = 'nodejs'",
  ].join('\n')
  assert.deepEqual(handlersFromSource(source), ['GET', 'POST', 'PATCH', 'DELETE'])
})

test('nextAppRouterItems: pages are ui-route, route handlers are api-endpoint, others nothing', () => {
  assert.deepEqual(nextAppRouterItems('src/app/[locale]/x/page.tsx', '', {}), [{ id: '/x', kind: 'ui-route' }])
  assert.deepEqual(nextAppRouterItems('src/app/api/x/route.ts', 'export const GET = 1', {}), [{ id: 'GET /api/x', kind: 'api-endpoint' }])
  assert.deepEqual(nextAppRouterItems('src/app/[locale]/x/layout.tsx', '', {}), [])
})

test('regexItems uses the id, method and title groups', () => {
  const content = '- REQ-1: One\n- REQ-2: Two\n- nope\n'
  assert.deepEqual(regexItems(content, { pattern: '^- (?<id>REQ-\\d+): (?<title>.+)$' }), [
    { id: 'REQ-1', title: 'One' },
    { id: 'REQ-2', title: 'Two' },
  ])
  const routes = "router.get('/a')\nrouter.post('/b')\n"
  assert.deepEqual(regexItems(routes, { pattern: "router\\.(?<method>get|post)\\('(?<id>[^']+)'\\)" }), [
    { id: 'GET /a', title: '' },
    { id: 'POST /b', title: '' },
  ])
})

test('extractItems over the fixture: local pages plus the sibling API', () => {
  const config = loadConfig(FIXTURE)
  const { items, warnings } = extractItems(FIXTURE, config.entries, 'entries')
  assert.deepEqual(warnings, [])
  assert.deepEqual(items.map((i) => `${i.kind} ${i.id} <- ${i.file}`), [
    'ui-route /deliveries/[id] <- src/app/[locale]/(dashboard)/deliveries/[id]/page.tsx',
    'ui-route /deliveries <- src/app/[locale]/(dashboard)/deliveries/page.tsx',
    'ui-route /financeiro/faturas/[id] <- src/app/[locale]/(dashboard)/financeiro/faturas/[id]/page.tsx',
    'ui-route /financeiro/faturas <- src/app/[locale]/(dashboard)/financeiro/faturas/page.tsx',
    'ui-route /settings <- src/app/[locale]/(dashboard)/settings/page.tsx',
    'ui-route / <- src/app/[locale]/page.tsx',
    'api-endpoint DELETE /admin/invoices/[id] <- ../api/src/app/admin/invoices/[id]/route.ts',
    'api-endpoint GET /admin/invoices <- ../api/src/app/admin/invoices/route.ts',
    'api-endpoint POST /admin/invoices <- ../api/src/app/admin/invoices/route.ts',
  ])
})

test('extractItems reads requirements', () => {
  const config = loadConfig(FIXTURE)
  const { items } = extractItems(FIXTURE, config.requirements, 'requirements')
  assert.deepEqual(items, [
    { id: 'REQ-1', title: 'Admin issues an invoice', kind: 'requirement', file: 'docs/specs/billing.md' },
    { id: 'REQ-2', title: 'Admin cancels an invoice', kind: 'requirement', file: 'docs/specs/billing.md' },
    { id: 'REQ-3', title: 'Partner downloads an invoice PDF', kind: 'requirement', file: 'docs/specs/billing.md' },
  ])
})

test('a missing sibling root warns and the other sources still count', () => {
  const sources = [
    { extractor: 'next-app-router', root: '../missing-repo', glob: 'src/app/**/route.ts' },
    { extractor: 'next-app-router', glob: 'src/app/[locale]/**/page.tsx' },
  ]
  const { items, warnings } = extractItems(FIXTURE, sources, 'entries')
  assert.deepEqual(warnings, ['entries[0]: root "../missing-repo" does not exist, source skipped'])
  assert.equal(items.length, 6)
})

test('command sources read a JSON array and warn on failure', () => {
  const ok = extractItems(FIXTURE, [{ extractor: 'command', command: `node -p "JSON.stringify([{id:'T-1',title:'One'},{id:'T-2'},{nope:1}])"` }], 'requirements')
  assert.deepEqual(ok.items, [
    { id: 'T-1', title: 'One', kind: 'requirement', file: null },
    { id: 'T-2', title: '', kind: 'requirement', file: null },
  ])
  const failed = extractItems(FIXTURE, [{ extractor: 'command', command: 'node -e "process.exit(3)"' }], 'requirements')
  assert.match(failed.warnings[0], /^requirements\[0\]: command failed: /)
  const notJson = extractItems(FIXTURE, [{ extractor: 'command', command: 'node -p "1 + 1"' }], 'requirements')
  assert.deepEqual(notJson.warnings, ['requirements[0]: command failed: output is not a JSON array'])
})
