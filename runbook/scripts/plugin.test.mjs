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
  const parts = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/runbook/SKILL.md'), 'utf8'))
  const data = parseYaml(parts.yaml)
  assert.equal(data.name, 'runbook')
  assert.equal(typeof data.description, 'string')
})

test('every command has a description and is user-invoked', () => {
  for (const rel of findFiles(PLUGIN_ROOT, 'commands/*.md')) {
    const parts = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'))
    assert.ok(parts, `${rel} has no frontmatter`)
    const data = parseYaml(parts.yaml)
    assert.equal(typeof data.description, 'string', `${rel} description`)
    assert.equal(data['disable-model-invocation'], true, `${rel} disable-model-invocation`)
  }
})

test('templates parse', () => {
  JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates/runbook.config.json'), 'utf8'))
  const runbook = splitFrontmatter(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates/runbook.md'), 'utf8'))
  assert.equal(parseYaml(runbook.yaml).status, 'draft')
})

test('all nine commands exist and none is a stub', () => {
  const commands = findFiles(PLUGIN_ROOT, 'commands/*.md').map((rel) => path.basename(rel, '.md'))
  assert.deepEqual(commands, ['audit-script', 'check', 'coverage', 'create', 'list', 'run', 'setup', 'to-script', 'update'])
  for (const name of commands) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, `commands/${name}.md`), 'utf8')
    assert.doesNotMatch(text, /Not implemented yet/, `${name}.md is still a stub`)
  }
})

test('every command is listed in the skill table and in both READMEs', () => {
  const commands = findFiles(PLUGIN_ROOT, 'commands/*.md').map((rel) => path.basename(rel, '.md'))
  for (const doc of ['skills/runbook/SKILL.md', 'README.md', 'templates/readme.md']) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, doc), 'utf8')
    for (const name of commands) {
      assert.match(text, new RegExp(`/runbook:${name}\\b`), `${doc} lists ${name}`)
    }
  }
})
