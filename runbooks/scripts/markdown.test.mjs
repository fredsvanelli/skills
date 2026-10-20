import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from './lib/markdown.mjs'

test('escapes HTML everywhere', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  assert.ok(!renderMarkdown('| a |\n|---|\n| <img src=x onerror=y> |').includes('<img'))
  assert.ok(!renderMarkdown('`<b>`').includes('<b>'))
  assert.ok(!renderMarkdown('# <img src=x onerror=y>').includes('<img'))
  assert.ok(!renderMarkdown('- <img src=x onerror=y>').includes('<img'))
  assert.ok(!renderMarkdown('[<img src=x onerror=y>](https://a.b)').includes('<img'))
})
test('escapes quotes so an href cannot break out of its attribute', () => {
  const html = renderMarkdown('[x](https://a.b/"onmouseover="alert(1))')
  assert.ok(!html.includes('"onmouseover'))
  assert.ok(html.includes('&quot;onmouseover'))
  assert.equal(renderMarkdown("it's \"q\""), '<p>it&#39;s &quot;q&quot;</p>')
})
test('drops unsafe link targets', () => {
  assert.equal(renderMarkdown('[x](javascript:alert(1))'), '<p>x</p>')
  assert.equal(renderMarkdown('[x](https://a.b/c)'), '<p><a href="https://a.b/c" target="_blank" rel="noreferrer">x</a></p>')
  for (const target of ['  JaVaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'java\tscript:alert(1)']) {
    assert.ok(!renderMarkdown(`[x](${target})`).includes('<a'), target)
  }
  assert.ok(!renderMarkdown('[x](javascript:alert(1))').includes('href'))
})
test('keeps relative link targets', () => {
  for (const target of ['#x', '/x', 'x/y.md', 'http://a.b']) {
    assert.ok(renderMarkdown(`[t](${target})`).includes(`<a href="${target}"`), target)
  }
})
test('does not format inside code or hrefs', () => {
  assert.equal(renderMarkdown('`**a**`'), '<p><code>**a**</code></p>')
  assert.equal(renderMarkdown('[t](https://a.b/**x**)'), '<p><a href="https://a.b/**x**" target="_blank" rel="noreferrer">t</a></p>')
})
test('renders the blocks the templates write', () => {
  assert.equal(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>')
  assert.equal(renderMarkdown('- `x`: y'), '<ul><li><code>x</code>: y</li></ul>')
  assert.equal(renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |'), '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
  assert.equal(renderMarkdown('## Notes\n\nText **bold**.'), '<h2>Notes</h2><p>Text <strong>bold</strong>.</p>')
  assert.equal(renderMarkdown('```\na < b\n```'), '<pre><code>a &lt; b</code></pre>')
  assert.equal(renderMarkdown('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>')
  assert.equal(renderMarkdown(''), '')
})
test('formats code and bold inside a link label', () => {
  assert.equal(renderMarkdown('[`code`](http://x)'), '<p><a href="http://x" target="_blank" rel="noreferrer"><code>code</code></a></p>')
  assert.equal(renderMarkdown('[**b** `c`](http://x)'), '<p><a href="http://x" target="_blank" rel="noreferrer"><strong>b</strong> <code>c</code></a></p>')
})
test('drops a link whose target holds a code span', () => {
  assert.equal(renderMarkdown('[x](http://x/`y`)'), '<p>x</p>')
  assert.equal(renderMarkdown('[x](`javascript:alert(1)`)'), '<p>x</p>')
  assert.equal(renderMarkdown('[`a`](http://x/`y`)'), '<p><code>a</code></p>')
})
