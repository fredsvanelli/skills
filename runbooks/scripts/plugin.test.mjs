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

test('no command or instruction starts the plugin copy of the upstream server', () => {
  const starts = markdownFiles()
    .filter((rel) => rel.startsWith('commands/') || rel.startsWith('skills/runbooks/instructions/'))
    .filter((rel) => /runbooks\.mjs" upstream(?![-\w])/.test(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8')))
  assert.deepEqual(starts, [])
})

test('no command or instruction starts the plugin copy of the UI server', () => {
  const starts = markdownFiles()
    .filter((rel) => rel.startsWith('commands/') || rel.startsWith('skills/runbooks/instructions/'))
    .filter((rel) => /runbooks\.mjs" ui(?![-\w])/.test(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8')))
  assert.deepEqual(starts, [])
})

const readPlugin = (rel) => fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8')

test('/runbooks:ui checks the copy and starts it through npm run runbooks:ui', () => {
  const ui = readPlugin('commands/ui.md')
  assert.match(ui, /runbooks\.mjs" ui-copy/)
  assert.match(ui, /npm run runbooks:ui/)
})

test('setup writes the UI copy for every stack before package-script', () => {
  const setup = readPlugin('commands/setup.md')
  const copy = setup.indexOf('ui-copy --write')
  assert.ok(copy !== -1 && copy < setup.indexOf('package-script'))
})

test('settings and setup run package-script only once the config is written, and commit package.json', () => {
  const settings = readPlugin('commands/settings.md')
  assert.match(settings.slice(settings.indexOf('## 4. Write'), settings.indexOf('## 5.')), /package-script/)
  assert.match(settings.slice(settings.indexOf('## 6. Commit'), settings.indexOf('Write in the config')), /`package\.json`/)
  assert.match(readPlugin('commands/setup.md'), /- npm scripts: once the config is written, because the command reads `paths\.runbooks` and `upstream\.serverFile` from it/)
})

test('a CI job in a UI tests repository starts the copy by its path in that repository', () => {
  const toTest = readPlugin('skills/runbooks/instructions/to-test.md')
  assert.doesNotMatch(toTest, /`node <upstream\.serverFile> --root/)
  assert.match(toTest, /`node <tests\.ui\.dir>\/runbooks-upstream\.mjs --root <path from tests\.ui\.root to this project>`/)
})

test('the main session checks the copy before it starts the server for a prompt group', () => {
  const run = readPlugin('commands/run.md')
  const line = run.split('\n').find((text) => text.includes('The main session owns the upstream server'))
  assert.match(line, /upstream-copy/)
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
  assert.match(fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/runbooks/instructions/create.md'), 'utf8'), /`runbooks:scenarios`/)
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

const DISPATCHING = ['run', 'coverage', 'help', 'whats-next', 'map', 'audit', 'roles:generate', 'create', 'update', 'to-test']

for (const name of DISPATCHING) {
  test(`${name} is a dispatch file with an instructions file`, () => {
    const file = name.replace(':', '/')
    const command = fs.readFileSync(path.join(PLUGIN_ROOT, `commands/${file}.md`), 'utf8')
    assert.match(command, /^## Dispatch$/m)
    assert.match(parseYaml(splitFrontmatter(command).yaml)['argument-hint'], /--model/)
    const instructions = fs.readFileSync(path.join(PLUGIN_ROOT, `skills/runbooks/instructions/${file}.md`), 'utf8')
    assert.equal(splitFrontmatter(instructions), null)
  })
}

for (const rel of findFiles(PLUGIN_ROOT, 'commands/**/*.md')) {
  const name = rel.replace(/^commands\//, '').replace(/\.md$/, '').replace('/', ':')
  test(`${name} accepts --model`, () => {
    const command = fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8')
    assert.match(parseYaml(splitFrontmatter(command).yaml)['argument-hint'], /--model/)
    assert.match(command, /^\| `--model/m)
    if (!DISPATCHING.includes(name) && name !== 'orchestrator') assert.match(command, /^## Model$/m)
  })
}

test('run escalates through its instructions file', () => {
  const instructions = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills/runbooks/instructions/run.md'), 'utf8')
  assert.match(instructions, /status: escalate/)
})

test('every default model row that is not inline names a dispatching command', async () => {
  const { DEFAULT_MODELS } = await import('./lib/models.mjs')
  for (const [row, model] of Object.entries(DEFAULT_MODELS)) {
    if (model === 'inline') continue
    assert.ok(DISPATCHING.includes(row.split(' ')[0]), `${row} is not a dispatching command`)
  }
})

test('orchestrator stages take the model of their command row', () => {
  const command = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands/orchestrator.md'), 'utf8')
  assert.doesNotMatch(command, /Choose the model/)
  assert.match(command, /runbooks\.mjs" model/)
  assert.match(command, /references\/agents\.md/)
  assert.doesNotMatch(command, /commands\/(map|create|update|to-test|run)\.md/)
})

test('setup writes the model table and settings has a models group', () => {
  const setup = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands/setup.md'), 'utf8')
  const settings = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands/settings.md'), 'utf8')
  assert.match(setup, /models --defaults --json/)
  assert.match(setup, /models --diff --json/)
  assert.match(settings, /^\| `models` \|/m)
})

test('every dispatch command names an instructions file that exists', () => {
  const missing = []
  for (const rel of findFiles(PLUGIN_ROOT, 'commands/**/*.md')) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8')
    if (!/^## Dispatch\b/m.test(text)) continue
    const named = [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(skills\/runbooks\/instructions\/[\w./-]+\.md)/g)]
    if (named.length === 0) missing.push(`${rel} names no instructions file`)
    for (const match of named) if (!fs.existsSync(path.join(PLUGIN_ROOT, match[1]))) missing.push(`${rel} -> ${match[1]}`)
  }
  assert.deepEqual(missing, [])
})
