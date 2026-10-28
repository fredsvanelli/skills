import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { findFiles } from './lib/glob.mjs'
import { splitFrontmatter, parseYaml } from './lib/yaml.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

test('Codex marketplace resolves both local plugin packages and all skill roots', () => {
  const catalog = readJson(path.join(repo, '.agents/plugins/marketplace.json'))
  assert.deepEqual(catalog.plugins.map((p) => p.name).sort(), ['runbooks', 'utils'])
  for (const entry of catalog.plugins) {
    const root = path.resolve(repo, entry.source.path)
    assert.equal(path.dirname(root), repo)
    const manifest = readJson(path.join(root, '.codex-plugin/plugin.json'))
    const claude = readJson(path.join(root, '.claude-plugin/plugin.json'))
    for (const key of ['name', 'version', 'description']) assert.equal(manifest[key], claude[key])
    const dirs = Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills]
    const skills = dirs.flatMap((dir) => findFiles(root, `${dir.replace(/^\.\//, '')}/*/SKILL.md`))
    assert.equal(skills.length, entry.name === 'runbooks' ? 28 : 3)
    const names = new Set()
    for (const file of skills) {
      const meta = parseYaml(splitFrontmatter(fs.readFileSync(path.join(root, file), 'utf8')).yaml)
      assert.ok(meta.name && meta.description, file)
      assert.ok(!names.has(meta.name), `duplicate name ${meta.name}`)
      names.add(meta.name)
    }
  }
})

test('each Codex command entry resolves its shared procedure and runtime reference', () => {
  const root = path.join(repo, 'runbooks')
  for (const command of findFiles(root, 'commands/**/*.md')) {
    const name = `runbooks-${command.slice('commands/'.length, -3).replaceAll('/', '-')}`
    const dir = path.join(root, 'codex-skills', name)
    const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
    const targets = [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => path.resolve(dir, m[1]))
    assert.ok(targets.includes(path.join(root, command)), `no shared procedure for ${name}`)
    assert.ok(targets.includes(path.join(root, 'skills/runbooks/references/runtime.md')))
    for (const target of targets) assert.ok(fs.existsSync(target), target)
    const policy = parseYaml(fs.readFileSync(path.join(dir, 'agents/openai.yaml'), 'utf8'))
    assert.equal(policy.policy.allow_implicit_invocation, false)
  }
})

test('a copied package executes its model helper from a consumer path containing spaces', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runbooks portable '))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const plugin = path.join(tmp, 'installed plugin')
  fs.cpSync(path.join(repo, 'runbooks'), plugin, { recursive: true })
  const project = path.join(tmp, 'consumer project')
  fs.mkdirSync(path.join(project, 'docs/runbooks'), { recursive: true })
  fs.writeFileSync(path.join(project, 'docs/runbooks/runbooks.config.json'), JSON.stringify({ version: 1, codex: { models: { create: 'test-model' } } }))
  const env = { ...process.env }
  delete env.CLAUDE_PLUGIN_ROOT
  const result = spawnSync(process.execPath, [path.join(plugin, 'scripts/runbooks.mjs'), 'model', 'create', '--runtime', 'codex'], { cwd: project, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'test-model')
})
