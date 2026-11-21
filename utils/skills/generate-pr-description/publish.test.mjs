// Runs the `### Publish` bash block from SKILL.md against a throwaway repo with a local bare remote.
// node --test utils/skills/generate-pr-description/publish.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'SKILL.md'), 'utf8');
const block = skill.split(/^### Publish$/m)[1]?.match(/```bash\n([\s\S]*?)```/)?.[1];

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function publish(work, shots, slug) {
  assert.ok(block, 'no ```bash block after "### Publish" in SKILL.md');
  return execFileSync('bash', ['-c', block], { cwd: work, env: { ...env, SHOTS: shots, SLUG: slug }, encoding: 'utf8' }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pr-assets-'));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const work = clone(root, remote, 'work');
  writeFileSync(join(work, 'README'), 'x');
  execFileSync('git', ['add', 'README'], { cwd: work });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: work, env });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: work });
  const shots = join(root, 'shots');
  mkdirSync(shots);
  writeFileSync(join(shots, '1-form-error.png'), 'png-v1');
  return { root, remote, work, shots };
}

function clone(root, remote, name) {
  const dir = join(root, name);
  execFileSync('git', ['clone', '-q', remote, dir]);
  return dir;
}

test('first run creates an orphan pr-assets', () => {
  const { work, shots } = fixture();
  const sha = publish(work, shots, 'feat-x');
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(git(work, 'rev-list', '--count', sha), '1');
  assert.match(git(work, 'ls-remote', 'origin', 'pr-assets'), new RegExp(`^${sha}\\s`));
  assert.equal(git(work, 'show', `${sha}:feat-x/1-form-error.png`), 'png-v1');
});

test('second run stacks on the tip', () => {
  const { work, shots } = fixture();
  const sha1 = publish(work, shots, 'feat-x');
  writeFileSync(join(shots, '1-form-error.png'), 'png-v2');
  const sha2 = publish(work, shots, 'feat-x');
  assert.equal(git(work, 'rev-parse', `${sha2}^`), sha1);
  assert.equal(git(work, 'cat-file', '-t', sha1), 'commit');
  assert.equal(git(work, 'show', `${sha2}:feat-x/1-form-error.png`), 'png-v2');
});

test('builds on the remote tip, not a stale local ref', () => {
  const { root, remote, work, shots } = fixture();
  publish(work, shots, 'feat-x');
  const other = clone(root, remote, 'other');
  publish(other, shots, 'feat-y');
  const sha = publish(work, shots, 'feat-x');
  assert.deepEqual(git(work, 'ls-tree', '--name-only', sha).split('\n'), ['feat-x', 'feat-y']);
});

test('leaves index and working tree untouched', () => {
  const { work, shots } = fixture();
  writeFileSync(join(work, 'README'), 'staged');
  execFileSync('git', ['add', 'README'], { cwd: work });
  writeFileSync(join(work, 'untracked'), 'u');
  const before = [git(work, 'status', '--porcelain'), git(work, 'diff', '--cached')];
  publish(work, shots, 'feat-x');
  assert.deepEqual([git(work, 'status', '--porcelain'), git(work, 'diff', '--cached')], before);
});
