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

const COMMANDS = {
  '': ['audit', 'check', 'coverage', 'create', 'help', 'list', 'map', 'orchestrator', 'run', 'settings', 'setup', 'to-test', 'ui', 'update', 'upgrade', 'whats-next'],
  roles: ['create', 'delete', 'generate', 'list', 'update'],
  contexts: ['create', 'delete', 'list', 'update'],
  permissions: ['manage'],
}

for (const [folder, names] of Object.entries(COMMANDS)) {
  const dir = folder ? `commands/${folder}` : 'commands'
  test(`the ${names.length} commands in ${dir} exist and none is a stub`, () => {
    const commands = findFiles(PLUGIN_ROOT, `${dir}/*.md`).map((rel) => path.basename(rel, '.md'))
    assert.deepEqual(commands, names)
    for (const name of commands) {
      const text = fs.readFileSync(path.join(PLUGIN_ROOT, `${dir}/${name}.md`), 'utf8')
      assert.doesNotMatch(text, /Not implemented yet/, `${dir}/${name}.md is still a stub`)
      assert.match(text, /^## Parameters$/m, `${dir}/${name}.md explains its parameters`)
    }
  })
}

test('every command is listed in the skill table and in both READMEs', () => {
  for (const doc of ['skills/runbooks/SKILL.md', 'README.md', 'templates/readme.md']) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, doc), 'utf8')
    for (const folder of Object.keys(COMMANDS)) {
      const dir = folder ? `commands/${folder}` : 'commands'
      for (const name of findFiles(PLUGIN_ROOT, `${dir}/*.md`).map((rel) => path.basename(rel, '.md'))) {
        const command = folder ? `${folder}:${name}` : name
        assert.match(text, new RegExp(`/runbooks:${command}\\b`), `${doc} lists ${command}`)
      }
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

test('the dispatch reference has the sections the commands link to', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/runbooks/references/agents.md'), 'utf8')
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1])
  assert.deepEqual(headings, [
    'Choosing the model',
    'Dispatch steps',
    'The brief',
    'The report',
    'Questions',
    'Calls to other commands',
    'Commits',
    'When the model cannot launch'
  ])
})

test('run is a dispatch file with an instructions file', () => {
  const command = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands/run.md'), 'utf8')
  assert.match(command, /^## Dispatch$/m)
  assert.match(command, /runbooks\.mjs" model run/)
  assert.match(parseYaml(splitFrontmatter(command).yaml)['argument-hint'], /--model/)
  const instructions = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/runbooks/instructions/run.md'), 'utf8')
  assert.equal(splitFrontmatter(instructions), null)
  assert.match(instructions, /status: escalate/)
})
