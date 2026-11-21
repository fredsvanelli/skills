// Runs the `### Publish` bash block from SKILL.md against a throwaway repo with a local bare remote.
// node --test utils/skills/generate-pr-description/publish.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'SKILL.md'), 'utf8');
const block = skill.split(/^### Publish$/m)[1]?.match(/```bash\n([\s\S]*?)```/)?.[1];

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

// Prints `<sha>/<slug>`, the path that follows `blob/` in the image URL.
function run(work, shots, branch, shell = 'bash') {
  assert.ok(block, 'no ```bash block after "### Publish" in SKILL.md');
  return execFileSync(shell, ['-c', block], { cwd: work, env: { ...env, SHOTS: shots, BRANCH: branch }, encoding: 'utf8' }).trim();
}
const publish = (...args) => run(...args).split('/')[0];

function rejectPushes(remote, script) {
  const hook = join(remote, 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh\n${script}\n`);
  chmodSync(hook, 0o755);
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

const hasZsh = (() => { try { execFileSync('zsh', ['-c', 'true']); return true; } catch { return false; } })();

test('runs from zsh, the agent shell on macOS', { skip: !hasZsh && 'zsh not installed' }, () => {
  const { work, shots } = fixture();
  const sha1 = publish(work, shots, 'feat-x', 'zsh');
  const sha2 = publish(work, shots, 'feat-x', 'zsh');
  assert.equal(git(work, 'rev-parse', `${sha2}^`), sha1);
  assert.match(git(work, 'ls-remote', 'origin', 'pr-assets'), new RegExp(`^${sha2}\\s`));
});

test("skips the user's pre-push hook", () => {
  const { work, shots } = fixture();
  const hook = join(work, '.git', 'hooks', 'pre-push');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  assert.match(publish(work, shots, 'feat-x'), /^[0-9a-f]{40}$/);
});

test('prints the URL path with a slug made safe from the branch name', () => {
  const { work, shots } = fixture();
  const out = run(work, shots, 'Fix/#123 a?b%c');
  const [sha, slug] = out.split('/');
  assert.equal(slug, 'fix--123-a-b-c');
  assert.equal(git(work, 'show', `${sha}:fix--123-a-b-c/1-form-error.png`), 'png-v1');
});

test('rebuilds on the new tip when the first push is rejected', () => {
  const { root, remote, work, shots } = fixture();
  const x = publish(work, shots, 'feat-x');
  const y = publish(clone(root, remote, 'other'), shots, 'feat-y');
  git(remote, 'update-ref', 'refs/heads/pr-assets', x);
  // The first push meets a tip that moved to y meanwhile and is rejected; the retry must build on y.
  const flag = join(root, 'rejected-once');
  rejectPushes(remote, `[ -f '${flag}' ] && exit 0; touch '${flag}'; env -u GIT_QUARANTINE_PATH git update-ref refs/heads/pr-assets ${y}; exit 1`);
  const sha = publish(work, shots, 'feat-x');
  assert.equal(git(work, 'rev-parse', `${sha}^`), y);
  assert.deepEqual(git(work, 'ls-tree', '--name-only', sha).split('\n'), ['feat-x', 'feat-y']);
});

test('exits non-zero with git\'s error when every push is rejected', () => {
  const { remote, work, shots } = fixture();
  rejectPushes(remote, 'echo "denied by ruleset" >&2; exit 1');
  assert.throws(() => publish(work, shots, 'feat-x'), (e) => e.status !== 0 && /denied by ruleset/.test(e.stderr));
});
