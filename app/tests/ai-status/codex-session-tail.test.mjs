import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const sourceUrl = new URL('../../src/main/services/aiStatus.ts', import.meta.url)
const source = await readFile(sourceUrl, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
const { readCodex } = await import(moduleUrl)

const roots = []

async function createRoot(lines, config = '') {
  const root = await mkdtemp(join(tmpdir(), 'zinc-codex-tail-'))
  roots.push(root)
  const day = join(root, 'sessions', '2026', '07', '11')
  await mkdir(day, { recursive: true })
  await writeFile(join(root, 'config.toml'), config, 'utf8')
  await writeFile(join(day, 'session.jsonl'), lines, 'utf8')
  return root
}

function tokenEvent(totalTokens = 4321) {
  return JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: { total_tokens: totalTokens } },
      rate_limits: {
        primary: { used_percent: 17.5, resets_at: 123 },
        secondary: { used_percent: '42', resets_at: '456' }
      }
    }
  })
}

test('reads valid records after a bounded tail starts inside a multibyte line', async () => {
  // Exceeds the 256 KiB production tail bound and deliberately puts its cut
  // point inside UTF-8 text. The parser must discard that partial first line,
  // then decode and parse only complete later JSONL records.
  const oversizedUnicodeLine = `${'界'.repeat(100_000)}\n`
  const root = await createRoot([
    oversizedUnicodeLine,
    tokenEvent(),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-test', effort: 'high' } }),
    '{"type":"event_msg","payload":',
    ''
  ].join('\n'))

  assert.deepEqual(readCodex([root]), {
    label: 'Codex',
    model: 'gpt-test',
    effort: 'high',
    contextTokens: 4321,
    primary: { usedPercent: 17.5, resetsAtEpoch: 123 },
    secondary: { usedPercent: 42, resetsAtEpoch: 456 },
    dailyCost: null,
    weeklyCost: null
  })
})

test('skips truncated and malformed newest JSONL while retaining config fallback', async () => {
  const root = await createRoot([
    tokenEvent(99),
    '{not-json}',
    '{"type":"turn_context","payload":{"model":"incomplete"}',
    ''
  ].join('\n'), 'model = "configured-model"\nmodel_reasoning_effort = "medium"\n')

  const snapshot = readCodex([root])
  assert.equal(snapshot?.model, 'configured-model')
  assert.equal(snapshot?.effort, 'medium')
  assert.equal(snapshot?.contextTokens, 99)
})

test('ignores non-roots and falls through to the first usable Codex root', async () => {
  const emptyRoot = await createRoot('{"type":"turn_context","payload":{"model":"no-token"}}\n')
  const usableRoot = await createRoot(`${tokenEvent(777)}\n`)
  assert.equal(readCodex(['/definitely/missing', emptyRoot, usableRoot])?.contextTokens, 777)
})

test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})
