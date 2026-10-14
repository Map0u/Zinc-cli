/**
 * Source-level guards for how the settings pages are laid out: which page owns which card,
 * that the page list and its strings agree, and that the renderer only draws corners from the
 * two radius tokens (so a new card or menu cannot quietly invent its own radius again).
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const rendererSrc = join(root, 'src/renderer/src')
const page = readFileSync(join(rendererSrc, 'settings/SettingsPage.tsx'), 'utf8').replace(/\r\n/g, '\n')
const locales = {
  en: JSON.parse(readFileSync(join(rendererSrc, 'i18n/locales/en-US.json'), 'utf8')),
  zh: JSON.parse(readFileSync(join(rendererSrc, 'i18n/locales/zh-CN.json'), 'utf8'))
}

/** The source of `function <name>() {` up to the next top-level function. */
function sectionOf(name) {
  const start = page.indexOf(`function ${name}() {`)
  assert.notEqual(start, -1, `${name} exists`)
  const rest = page.slice(start + 1)
  const next = rest.search(/\n(?:export )?(?:function|const) [A-Za-z]/)
  return next === -1 ? rest : rest.slice(0, next)
}

test('the page list puts Tabs & AI between Terminal and Startup, and its strings exist in both languages', () => {
  const ids = [...page.matchAll(/\{ id: '(\w+)', labelKey: '(\w+)'/g)].map((m) => m[1])
  assert.deepEqual(ids, ['appearance', 'terminal', 'tabs', 'startup', 'shortcuts', 'about'])
  assert.match(page, /\{ id: 'tabs', labelKey: 'CatTabsAi'/)
  for (const key of ['CatTabsAi', 'GroupPerformance', 'GroupAiSessions']) {
    for (const [lang, strings] of Object.entries(locales)) {
      assert.equal(typeof strings[key], 'string', `${lang} has ${key}`)
      assert.notEqual(strings[key].trim(), '', `${lang} ${key} is not empty`)
    }
  }
})

test('Terminal keeps the terminal itself; image paste, precise AI status and auto grouping live on Tabs & AI', () => {
  const terminal = sectionOf('TerminalSection')
  const tabs = sectionOf('TabsSection')
  for (const id of ['setting-fontFamily', 'setting-fontSize', 'setting-cursorStyle', 'setting-cursorBlink', 'setting-gpuRendering', 'setting-scrollback']) {
    assert.ok(terminal.includes(`"${id}"`), `Terminal has ${id}`)
  }
  for (const id of ['setting-autoGroupTabs', 'setting-preciseAiStatus', 'setting-imagePaste']) {
    assert.ok(tabs.includes(`"${id}"`), `Tabs & AI has ${id}`)
    assert.ok(!terminal.includes(`"${id}"`), `Terminal no longer has ${id}`)
  }
  assert.ok(terminal.indexOf("GroupPerformance") < terminal.indexOf('setting-gpuRendering'), 'the performance cluster has its heading')
  assert.ok(tabs.indexOf('GroupAiSessions') < tabs.indexOf('setting-preciseAiStatus'), 'the AI cluster has its heading')
})

test('a card wraps long text inside its own column instead of pushing its control onto a row of its own', () => {
  const card = page.slice(page.indexOf('function Card('), page.indexOf('/** Off-state is a hollow'))
  assert.match(card, /min-w-0 flex-1 basis-64/)
  assert.match(card, /rounded-surface/)
})

test('the renderer draws corners only from the two radius tokens (or a full pill / a one-off brand shape)', () => {
  const css = readFileSync(join(rendererSrc, 'index.css'), 'utf8')
  assert.match(css, /--radius-control:\s*4px/)
  assert.match(css, /--radius-surface:\s*8px/)
  const offenders = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.tsx')) {
        // Comments talk about "rounded corners"; only class strings count. Blank them out, keeping the line numbers.
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
          .replace(/^\s*\/\/.*$/gm, '')
        code.split(/\r?\n/).forEach((line, i) => {
          for (const m of line.matchAll(/(?<![\w-])rounded(?:-([a-z0-9]+|\[[^\]]*\]))?(?![\w-])/g)) {
            const kind = m[1]
            if (kind === undefined || !(['control', 'surface', 'full'].includes(kind) || kind.startsWith('['))) {
              offenders.push(`${full.slice(rendererSrc.length + 1)}:${i + 1} ${m[0]}`)
            }
          }
        })
      }
    }
  }
  walk(rendererSrc)
  assert.deepEqual(offenders, [])
})
