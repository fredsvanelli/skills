import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findFiles } from './lib/glob.mjs'
import { splitFrontmatter, parseYaml } from './lib/yaml.mjs'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const markdownFiles = () => findFiles(PLUGIN_ROOT, '**/*.md').filter((rel) => !rel.startsWith('scripts/__fixtures__/'))

test('every ${CLAUDE_PLUGIN_ROOT} path in the plugin docs exists', () => {
  const missing = []
  for (const rel of markdownFiles()) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8')
    for (const match of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      const target = match[1].replace(/[.]+$/, '')
      if (!fs.existsSync(path.join(PLUGIN_ROOT, target))) missing.push(`${rel} -> ${target}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('the runbook skill has a name and a description', () => {
  const parts = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/runbooks/SKILL.md'), 'utf8'))
  const data = parseYaml(parts.yaml)
  assert.equal(data.name, 'runbooks')
  assert.equal(typeof data.description, 'string')
})

test('the scenarios skill is invoked by the model only', () => {
  const parts = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/scenarios/SKILL.md'), 'utf8'))
  const data = parseYaml(parts.yaml)
  assert.equal(data.name, 'scenarios')
  assert.equal(typeof data.description, 'string')
  assert.equal(data['user-invocable'], false)
  assert.match(fs.readFileSync(path.join(PLUGIN_ROOT, 'commands/create.md'), 'utf8'), /`runbooks:scenarios`/)
})

test('every command has a description and is user-invoked', () => {
  for (const rel of findFiles(PLUGIN_ROOT, 'commands/**/*.md')) {
    const parts = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'))
    assert.ok(parts, `${rel} has no frontmatter`)
    const data = parseYaml(parts.yaml)
    assert.equal(typeof data.description, 'string', `${rel} description`)
    assert.equal(data['disable-model-invocation'], true, `${rel} disable-model-invocation`)
  }
})

test('templates parse', () => {
  JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates/runbooks.config.json'), 'utf8'))
  const runbook = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates/runbook.md'), 'utf8'))
  assert.equal(parseYaml(runbook.yaml).status, 'draft')
  assert.equal(parseYaml(runbook.yaml).surface, 'ui')
  const api = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates/runbook-api.md'), 'utf8'))
  assert.deepEqual([parseYaml(api.yaml).status, parseYaml(api.yaml).surface], ['draft', 'api'])
  const placeholder = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates/placeholder.md'), 'utf8'))
  assert.equal(parseYaml(placeholder.yaml).status, 'placeholder')
})

const ROLES_COMMANDS = ['create', 'delete', 'list', 'manage-contexts', 'manage-permissions', 'update']

test('all sixteen commands exist and none is a stub', () => {
  const commands = findFiles(PLUGIN_ROOT, 'commands/*.md').map((rel) => path.basename(rel, '.md'))
  assert.deepEqual(commands, ['audit-runbooks', 'check', 'coverage', 'create', 'export-permissions', 'help', 'import-permissions', 'list', 'map', 'run', 'settings', 'setup', 'to-test', 'ui', 'update', 'upgrade'])
  for (const name of commands) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, `commands/${name}.md`), 'utf8')
    assert.doesNotMatch(text, /Not implemented yet/, `${name}.md is still a stub`)
    assert.match(text, /^## Parameters$/m, `${name}.md explains its parameters`)
  }
})

test('all six roles commands exist and none is a stub', () => {
  const commands = findFiles(PLUGIN_ROOT, 'commands/roles/*.md').map((rel) => path.basename(rel, '.md'))
  assert.deepEqual(commands, ROLES_COMMANDS)
  for (const name of commands) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, `commands/roles/${name}.md`), 'utf8')
    assert.doesNotMatch(text, /Not implemented yet/, `roles/${name}.md is still a stub`)
    assert.match(text, /^## Parameters$/m, `roles/${name}.md explains its parameters`)
  }
})

test('every command is listed in the skill table and in both READMEs', () => {
  const commands = findFiles(PLUGIN_ROOT, 'commands/*.md').map((rel) => path.basename(rel, '.md'))
  const rolesCommands = findFiles(PLUGIN_ROOT, 'commands/roles/*.md').map((rel) => path.basename(rel, '.md'))
  for (const doc of ['skills/runbooks/SKILL.md', 'README.md', 'templates/readme.md']) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, doc), 'utf8')
    for (const name of commands) {
      assert.match(text, new RegExp(`/runbooks:${name}\\b`), `${doc} lists ${name}`)
    }
    for (const name of rolesCommands) {
      assert.match(text, new RegExp(`/runbooks:roles:${name}\\b`), `${doc} lists roles:${name}`)
    }
  }
})

test('the upstream server version equals the plugin version', async () => {
  const { VERSION } = await import('./upstream-server.mjs')
  const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(VERSION, plugin.version)
})

test('the upstream reference has the sections the commands link to', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/runbooks/references/upstream.md'), 'utf8')
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1])
  assert.deepEqual(headings, ['Modes', 'Fixtures', 'Server', 'Control routes', 'Recording', 'Scripts', 'Contract'])
})
