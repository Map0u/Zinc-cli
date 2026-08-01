/**
 * Drives `src/renderer/src/update/updateNotes.ts` (and its changelogEntries
 * dependency) without reimplementing strip / resolve rules.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const updateNotesPath = join(root, 'src/renderer/src/update/updateNotes.ts')
const changelogPath = join(root, 'src/renderer/src/update/changelogEntries.ts')

const { code } = transformSync(
  `${readFileSync(changelogPath, 'utf8')}\n${readFileSync(updateNotesPath, 'utf8').replace(
    /^import\s+\{[^}]+\}\s+from\s+['"]\.\/changelogEntries['"]\s*;?\s*$/m,
    ''
  )}`,
  {
    loader: 'ts',
    format: 'cjs',
    target: 'node22'
  }
)

const require = createRequire(import.meta.url)
const module = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('exports', 'require', 'module', code)(module.exports, require, module)
const {
  stripReleaseNotesHtml,
  resolveUpdateNotes,
  RELEASE_NOTES_MAX_CHARS,
  CHANGELOG_ENTRIES
} = module.exports

const SAMPLE_GITHUB_HTML = `
<p>Zinc is a <strong>lightweight multi-shell Windows terminal launcher</strong>: vertical
tab<br>
rail.</p>
<div class="highlight highlight-source-powershell">
<pre><span class="pl-c1">Get-FileHash</span> .\\Zinc-0.6.3-Setup.exe</pre>
</div>
<ul>
<li><strong>Copy polish</strong> in Settings and About.</li>
<li>About tagline aligned with the product pitch.</li>
</ul>
<p>Compare against A &amp; B and &quot;quoted&quot; text.</p>
`

test('stripReleaseNotesHtml leaves plain text unchanged', () => {
  assert.equal(stripReleaseNotesHtml('  Fixed updater UX.  '), 'Fixed updater UX.')
})

test('stripReleaseNotesHtml collapses GitHub-style HTML into readable text', () => {
  const text = stripReleaseNotesHtml(SAMPLE_GITHUB_HTML)
  assert.ok(!/<[a-zA-Z/!]/.test(text), `unexpected tag residue: ${text}`)
  assert.match(text, /lightweight multi-shell Windows terminal launcher/)
  assert.match(text, /Get-FileHash/)
  assert.match(text, /Copy polish/)
  assert.match(text, /About tagline/)
  assert.ok(!text.includes('highlight-source-powershell'))
  assert.ok(!text.includes('pl-c1'))
})

test('stripReleaseNotesHtml decodes common entities', () => {
  assert.equal(stripReleaseNotesHtml('A &amp; B &lt;C&gt; &quot;q&quot; &#39;s&#39;'), 'A & B <C> "q" \'s\'')
})

test('stripReleaseNotesHtml returns empty for nullish or blank input', () => {
  assert.equal(stripReleaseNotesHtml(null), '')
  assert.equal(stripReleaseNotesHtml(undefined), '')
  assert.equal(stripReleaseNotesHtml('   \n  '), '')
  assert.equal(stripReleaseNotesHtml('<p><br></p>'), '')
})

test('stripReleaseNotesHtml truncates long remote notes', () => {
  const long = `<p>${'x'.repeat(RELEASE_NOTES_MAX_CHARS + 50)}</p>`
  const text = stripReleaseNotesHtml(long)
  assert.equal(text.length, RELEASE_NOTES_MAX_CHARS + 1)
  assert.ok(text.endsWith('…'))
})

test('resolveUpdateNotes prefers local bilingual bullets over remote HTML', () => {
  const notes = resolveUpdateNotes('0.6.3', SAMPLE_GITHUB_HTML, 'zh')
  assert.equal(notes.kind, 'bullets')
  assert.ok(Array.isArray(notes.items) && notes.items.length >= 1)
  assert.ok(notes.items.some((item) => item.includes('文案') || item.includes('关于')))
  assert.ok(!notes.items.some((item) => item.includes('<')))
})

test('resolveUpdateNotes uses English local bullets when language is en', () => {
  const notes = resolveUpdateNotes('v0.6.3', SAMPLE_GITHUB_HTML, 'en')
  assert.equal(notes.kind, 'bullets')
  assert.ok(notes.items.some((item) => /copy polish|tagline|resume/i.test(item)))
})

test('resolveUpdateNotes strips remote HTML when no local entry exists', () => {
  const notes = resolveUpdateNotes('9.9.9', SAMPLE_GITHUB_HTML, 'zh')
  assert.equal(notes.kind, 'text')
  assert.ok(notes.text.includes('Copy polish'))
  assert.ok(!/<[a-zA-Z/!]/.test(notes.text))
})

test('resolveUpdateNotes returns empty text when both sources are missing', () => {
  assert.deepEqual(resolveUpdateNotes('9.9.9', null, 'zh'), { kind: 'text', text: '' })
  assert.deepEqual(resolveUpdateNotes('9.9.9', '   ', 'en'), { kind: 'text', text: '' })
  assert.deepEqual(resolveUpdateNotes(null, null, 'zh'), { kind: 'text', text: '' })
})

test('changelogEntries includes 0.6.3 for About and the update dialog', () => {
  const entry = CHANGELOG_ENTRIES.find((item) => item.version === '0.6.3')
  assert.ok(entry)
  assert.equal(entry.date, '2026-08-01')
  assert.ok(entry.zh.length >= 1)
  assert.ok(entry.en.length >= 1)
})
