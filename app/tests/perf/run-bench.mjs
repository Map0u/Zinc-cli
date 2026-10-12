// Zinc 前台卡顿基准：N 个标签（N-1 个跑 fake-tui，1 个空闲 PowerShell 做前台），
// 测前台标签的输入延迟、渲染线程 long task、rAF 帧间隔、渲染线程繁忙度、各进程 CPU、主进程事件循环延迟。
// 必须由 run-bench.ps1 启动（它负责起隔离的 dev 实例并传 --root-pid）。
// 参数见 README.md。
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)
const cfg = {
  tabs: Number(args.tabs ?? 10),
  warmupSec: Number(args.warmup ?? 5),
  measureSec: Number(args.measure ?? 30),
  fps: Number(args.fps ?? 20),
  rows: args.rows !== undefined ? Number(args.rows) : undefined,
  mode: args.mode === 'normal' ? 'normal' : 'alt',
  sync: Boolean(args.sync),
  titleMs: Number(args['title-ms'] ?? 150),
  inputIntervalMs: Number(args['input-interval'] ?? 200),
  inputTimeoutMs: Number(args['input-timeout'] ?? 2000),
  inspectPort: Number(args['inspect-port'] ?? 0), // 0 = 不测主进程
  endpoint: String(args.endpoint ?? 'http://127.0.0.1:9336'),
  rootPid: Number(args['root-pid'] ?? 0),
  nodeExe: String(args.node ?? process.execPath),
  outDir: String(
    args.out ?? join('D:/tmp/cf/zinc-perf', `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-n${args.tabs ?? 10}`)
  ),
  tag: String(args.tag ?? `zpb-${process.pid}`)
}

const log = (...a) => console.log(`[bench n=${cfg.tabs}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null)
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100)
function stats(values) {
  const s = [...values].sort((a, b) => a - b)
  return {
    count: s.length,
    p50: r2(pct(s, 50)),
    p95: r2(pct(s, 95)),
    p99: r2(pct(s, 99)),
    max: r2(s.length ? s[s.length - 1] : null),
    mean: r2(s.length ? s.reduce((a, b) => a + b, 0) / s.length : null)
  }
}

// ---------- 隔离与身份校验 ----------
if (process.env.ZINC_TEST_ISOLATED !== '1' || !process.env.ZINC_TEST_USER_DATA?.trim()) {
  console.error('FAIL: 需要 ZINC_TEST_ISOLATED=1 与 ZINC_TEST_USER_DATA（请通过 run-bench.ps1 启动）。')
  process.exit(2)
}
if (!cfg.rootPid) {
  console.error('FAIL: 缺少 --root-pid（run-bench.ps1 启动的 npm run dev 进程 PID），无法确认连到的是自己启动的实例。')
  process.exit(2)
}

function processTable() {
  const out = execFileSync(
    'pwsh',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  return new Map(JSON.parse(out).map((p) => [p.ProcessId, p.ParentProcessId]))
}
function isDescendant(table, pid, rootPid) {
  for (let cur = pid, i = 0; cur && i < 40; i++) {
    if (cur === rootPid) return true
    cur = table.get(cur)
  }
  return false
}

// ---------- 页面内探针 ----------
// 输入延迟：Node 在固定时刻经 CDP Input.insertText 发一个字符；页面内用 xterm 的
// onWriteParsed 在每次解析完成后读缓冲区光标的绝对偏移（(baseY+cursorY)*cols+cursorX），
// 偏移每增加 1 即视为一个回显字符已进入缓冲区（不依赖 DOM / 渲染器类型，换成 WebGL 也适用）。
const PROBE_SRC = `(() => {
  const B = (window.__bench = { running: false })
  B.calib = () => performance.now()
  B.install = (fgId) => {
    const term = window.__zincRegistry.hosts.get(fgId).term
    B.term = term
    B.long = []
    B.frames = []
    B.arrive = []
    B.off = () => {
      const b = term.buffer.active
      return (b.baseY + b.cursorY) * term.cols + b.cursorX
    }
    B.base = 0
    B.writeParsed = term.onWriteParsed(() => {
      if (!B.running) return
      const cur = B.off() - B.base
      const t = performance.now()
      while (B.arrive.length < cur) B.arrive.push(t)
    })
    B.po = new PerformanceObserver((list) => {
      if (!B.running) return
      for (const e of list.getEntries()) B.long.push([e.startTime, e.duration])
    })
    B.po.observe({ entryTypes: ['longtask'] })
    const loop = (ts) => {
      if (B.running) B.frames.push(ts)
      B.raf = requestAnimationFrame(loop)
    }
    B.raf = requestAnimationFrame(loop)
  }
  B.start = () => {
    B.long = []
    B.frames = []
    B.arrive = []
    B.base = B.off()
    B.running = true
    return { t: performance.now(), cols: B.term.cols, rows: B.term.rows, vis: document.visibilityState, hasFocus: document.hasFocus() }
  }
  B.stop = () => {
    B.running = false
    const out = { t: performance.now(), long: B.long, frames: B.frames, arrive: B.arrive, finalOff: B.off() - B.base }
    B.writeParsed.dispose()
    B.po.disconnect()
    cancelAnimationFrame(B.raf)
    return out
  }
  return true
})()`

// ---------- 主进程事件循环延迟（可选，经 V8 inspector） ----------
async function connectMainInspector(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const wsUrl = list[0]?.webSocketDebuggerUrl
  if (!wsUrl) throw new Error('no inspector target')
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('inspector ws error'))
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const evaluate = (expression) =>
    new Promise((res, rej) => {
      const myId = ++id
      pending.set(myId, (m) =>
        m.error || m.result?.exceptionDetails
          ? rej(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails.exception?.description)))
          : res(m.result.result.value)
      )
      ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
  return { evaluate, close: () => ws.close() }
}
const LOOP_START = `(() => {
  const ph = process.getBuiltinModule ? process.getBuiltinModule('perf_hooks') : process.mainModule.require('perf_hooks')
  const h = ph.monitorEventLoopDelay({ resolution: 5 }); h.enable(); globalThis.__zincBenchLoop = h; return 'ok'
})()`
const LOOP_STOP = `(() => {
  const h = globalThis.__zincBenchLoop; h.disable()
  const ms = (n) => Math.round(n / 1e4) / 100
  return JSON.stringify({ samples: h.count, min: ms(h.min), mean: ms(h.mean), p50: ms(h.percentile(50)), p95: ms(h.percentile(95)), p99: ms(h.percentile(99)), p999: ms(h.percentile(99.9)), max: ms(h.max) })
})()`

// ---------- 主流程 ----------
const result = { schema: 1, config: cfg, startedAt: new Date().toISOString(), warnings: [] }
let browser
try {
  browser = await chromium.connectOverCDP(cfg.endpoint, { timeout: 20_000 })
  const context = browser.contexts()[0]
  const page = context.pages()[0] || (await context.waitForEvent('page', { timeout: 20_000 }))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(
    () => Boolean(window.__zincTabs && window.__zincRegistry && window.__zincTabs.tabs.length > 0),
    undefined,
    { timeout: 30_000 }
  )

  // 身份校验：CDP 里的 browser 进程 PID 必须是 run-bench.ps1 所启动进程树的后代
  const browserSession = await browser.newBrowserCDPSession()
  const procInfo0 = await browserSession.send('SystemInfo.getProcessInfo')
  const browserPid = procInfo0.processInfo.find((p) => p.type === 'browser')?.id
  const owned = browserPid ? isDescendant(processTable(), browserPid, cfg.rootPid) : false
  const initialTabs = await page.evaluate(() => window.__zincTabs.tabs.length)
  result.identity = {
    browserPid,
    rootPid: cfg.rootPid,
    ownedByThisRun: owned,
    userDataEnv: process.env.ZINC_TEST_USER_DATA,
    initialTabs
  }
  if (!owned) throw new Error(`连到的 CDP 实例（browser pid ${browserPid}）不属于本次启动的进程树（root ${cfg.rootPid}），中止。`)
  if (initialTabs !== 1) result.warnings.push(`隔离实例启动时有 ${initialTabs} 个标签（预期 1）`)
  log(`identity ok: browser pid ${browserPid} 属于 root pid ${cfg.rootPid}`)

  const tabIds = []
  const waitReady = (id) =>
    page.waitForFunction(
      (tid) => {
        const e = window.__zincRegistry.hosts?.get(tid)
        return Boolean(e && e.state === 'ready' && e.term.cols > 1 && e.term.rows > 0 && e.container.clientWidth > 0)
      },
      id,
      { timeout: 30_000 }
    )
  const bufferHas = (id, text, timeout = 30_000) =>
    page.waitForFunction(({ tid, t }) => window.__zincRegistry.getBufferText(tid).includes(t), { tid: id, t: text }, { timeout })

  tabIds.push(await page.evaluate(() => window.__zincTabs.activeId))
  await waitReady(tabIds[0])
  const fgId = tabIds[0]

  // 其余标签：每个跑 fake-tui（自带安全超时，万一没被杀也会自行退出）
  const safetySec = cfg.warmupSec + cfg.measureSec + 180
  const tuiArgs = [`--fps=${cfg.fps}`, `--mode=${cfg.mode}`, `--title-ms=${cfg.titleMs}`, `--duration=${safetySec}`, `--tag=${cfg.tag}`]
  if (cfg.rows !== undefined) tuiArgs.push(`--rows=${cfg.rows}`)
  if (cfg.sync) tuiArgs.push('--sync')
  const tuiScript = join(here, 'fake-tui.mjs').replace(/\\/g, '/')
  const tuiCmd = `& '${cfg.nodeExe.replace(/\\/g, '/')}' '${tuiScript}' ${tuiArgs.join(' ')}`
  for (let i = 1; i < cfg.tabs; i++) {
    const before = tabIds.slice()
    await page.evaluate(() => window.__zincTabs.addTab())
    await page.waitForFunction((ids) => window.__zincTabs.activeId && !ids.includes(window.__zincTabs.activeId), before, {
      timeout: 15_000
    })
    const id = await page.evaluate(() => window.__zincTabs.activeId)
    tabIds.push(id)
    await waitReady(id)
    // 等 shell 出提示符（缓冲区非空），再留一点余量让 PSReadLine 就绪
    await page.waitForFunction((tid) => window.__zincRegistry.getBufferText(tid).trim().length > 0, id, { timeout: 30_000 })
    await sleep(600)
    await page.evaluate((tid) => window.__zincRegistry.focus(tid), id)
    await page.keyboard.insertText(tuiCmd)
    await page.keyboard.press('Enter')
    await bufferHas(id, 'FT-FRAME', 30_000)
    log(`tab ${i + 1}/${cfg.tabs} 已运行 fake-tui`)
  }

  // 切回前台（空闲 PowerShell）
  await page.evaluate((id) => window.__zincTabs.switchTab(id), fgId)
  await page.waitForFunction((id) => window.__zincTabs.activeId === id, fgId)
  await waitReady(fgId)
  await page.evaluate((id) => window.__zincRegistry.focus(id), fgId)
  await sleep(300)

  await page.evaluate(PROBE_SRC)
  await page.evaluate((id) => window.__bench.install(id), fgId)

  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')

  let inspector = null
  if (cfg.inspectPort > 0) {
    try {
      inspector = await connectMainInspector(cfg.inspectPort)
      await inspector.evaluate('1+1')
    } catch (e) {
      result.warnings.push(`主进程事件循环延迟不可用: ${e.message}`)
      inspector = null
    }
  }

  // 时钟校准：页面 performance.now 与 Node performance.now 的偏移，取最小 RTT 的一次
  async function calibrate() {
    let best = null
    for (let i = 0; i < 40; i++) {
      const a = performance.now()
      const p = await page.evaluate(() => window.__bench.calib())
      const b = performance.now()
      if (!best || b - a < best.rtt) best = { rtt: b - a, offset: (a + b) / 2 - p }
      await sleep(5)
    }
    return best
  }

  log(`预热 ${cfg.warmupSec}s ...`)
  await sleep(cfg.warmupSec * 1000)
  const tuiTabs = tabIds.slice(1)
  const lastFrame = (id) =>
    page.evaluate((tid) => {
      const m = [...window.__zincRegistry.getBufferText(tid).matchAll(/FT-FRAME (\d+)/g)]
      return m.length ? Number(m[m.length - 1][1]) : null
    }, id)
  const calib = await calibrate()
  const frames0 = await Promise.all(tuiTabs.map(lastFrame))

  const m0 = (await cdp.send('Performance.getMetrics')).metrics
  const pi0 = (await browserSession.send('SystemInfo.getProcessInfo')).processInfo
  if (inspector) {
    await inspector.evaluate(LOOP_START).catch((e) => {
      result.warnings.push(`主进程监控启动失败: ${e.message}`)
      inspector = null
    })
  }
  const wall0 = performance.now()
  const startInfo = await page.evaluate(() => window.__bench.start())
  const startNode = performance.now()
  log(`测量 ${cfg.measureSec}s（前台 ${startInfo.cols}x${startInfo.rows}，输入间隔 ${cfg.inputIntervalMs}ms）...`)

  // 固定时间表发送输入：按名义时刻绝对排程，不等上一次响应
  const sends = []
  const total = Math.floor((cfg.measureSec * 1000) / cfg.inputIntervalMs)
  for (let k = 0; k < total; k++) {
    const target = startNode + (k + 1) * cfg.inputIntervalMs
    const wait = target - performance.now()
    if (wait > 0) await sleep(wait)
    sends.push(performance.now())
    cdp.send('Input.insertText', { text: 'x' }).catch(() => {})
  }
  const remain = startNode + cfg.measureSec * 1000 - performance.now()
  if (remain > 0) await sleep(remain)
  const wall1 = performance.now()
  const frames1 = await Promise.all(tuiTabs.map(lastFrame))
  await sleep(cfg.inputTimeoutMs + 200) // 等最后一个字符的回显或超时
  const probe = await page.evaluate(() => window.__bench.stop())
  const m1 = (await cdp.send('Performance.getMetrics')).metrics
  const pi1 = (await browserSession.send('SystemInfo.getProcessInfo')).processInfo
  let mainLoop = null
  if (inspector) {
    try {
      mainLoop = JSON.parse(await inspector.evaluate(LOOP_STOP))
      // Windows 定时器粒度约 15.6ms，p50 本身就是底噪；看「超出底噪」才有意义
      mainLoop.p99ExcessOverP50 = r2(mainLoop.p99 - mainLoop.p50)
      mainLoop.maxExcessOverP50 = r2(mainLoop.max - mainLoop.p50)
    } catch (e) {
      result.warnings.push(`主进程监控读取失败: ${e.message}`)
    }
    inspector.close()
  }
  const wallSec = (wall1 - wall0) / 1000

  // ---- 统计 ----
  const latencies = []
  let timeouts = 0
  for (let k = 0; k < sends.length; k++) {
    const arrive = probe.arrive[k]
    if (arrive === undefined) {
      timeouts++
      continue
    }
    const lat = arrive + calib.offset - sends[k]
    if (lat > cfg.inputTimeoutMs) timeouts++
    latencies.push(Math.max(0, lat))
  }
  const longTasks = probe.long.map(([, d]) => d)
  const f = probe.frames
  const intervals = []
  for (let i = 1; i < f.length; i++) intervals.push(f[i] - f[i - 1])
  const metric = (arr, name) => arr.find((m) => m.name === name)?.value ?? 0
  const dMetric = (name) => metric(m1, name) - metric(m0, name)
  const procCpu = {}
  for (const p1 of pi1) {
    const p0 = pi0.find((p) => p.id === p1.id)
    if (!p0) continue
    procCpu[p1.type] = r2((procCpu[p1.type] ?? 0) + ((p1.cpuTime - p0.cpuTime) / wallSec) * 100)
  }

  result.environment = {
    foregroundCols: startInfo.cols,
    foregroundRows: startInfo.rows,
    visibilityState: startInfo.vis,
    documentHasFocus: startInfo.hasFocus,
    tuiTabCount: tuiTabs.length,
    clockCalibrationRttMs: r2(calib.rtt),
    build: 'electron-vite dev（未打包的 React/Vite 开发构建，绝对数字比发布版差，用于前后对比）'
  }
  result.measuredSeconds = r2(wallSec)
  result.longTasks = {
    over50ms: longTasks.length,
    totalMs: r2(longTasks.reduce((a, b) => a + b, 0)),
    blockingMs: r2(longTasks.reduce((a, b) => a + (b - 50), 0)),
    maxMs: r2(Math.max(0, ...longTasks)),
    over100ms: longTasks.filter((d) => d > 100).length
  }
  result.frameIntervalMs = {
    frames: f.length,
    avgFps: r2(f.length / wallSec),
    ...stats(intervals),
    over33ms: intervals.filter((d) => d > 33.4).length,
    over50ms: intervals.filter((d) => d > 50).length,
    over100ms: intervals.filter((d) => d > 100).length
  }
  result.inputLatencyMs = {
    sent: sends.length,
    received: latencies.length,
    timeouts,
    timeoutMs: cfg.inputTimeoutMs,
    ...stats(latencies)
  }
  result.rendererMainThread = {
    busyPercent: r2((dMetric('TaskDuration') / wallSec) * 100),
    scriptPercent: r2((dMetric('ScriptDuration') / wallSec) * 100),
    layoutPercent: r2((dMetric('LayoutDuration') / wallSec) * 100),
    styleRecalcPercent: r2((dMetric('RecalcStyleDuration') / wallSec) * 100),
    jsHeapUsedMB: r2(metric(m1, 'JSHeapUsedSize') / 1048576),
    domNodes: metric(m1, 'Nodes')
  }
  result.processCpuPercentOfOneCore = procCpu
  result.mainProcessEventLoopDelayMs = mainLoop ?? '未测（未开 inspector 或不可用）'
  result.backgroundFeed = {
    expectedFramesPerTab: Math.round(cfg.fps * wallSec),
    observedFrameAdvance: tuiTabs.map((_, i) => (frames0[i] != null && frames1[i] != null ? frames1[i] - frames0[i] : null))
  }
  if (probe.finalOff < sends.length) result.warnings.push(`前台终端只回显了 ${probe.finalOff}/${sends.length} 个字符`)
  if (startInfo.vis !== 'visible') result.warnings.push(`document.visibilityState=${startInfo.vis}，rAF/渲染可能被节流`)
  result.finishedAt = new Date().toISOString()
} catch (e) {
  result.error = String(e?.stack ?? e)
  process.exitCode = 1
} finally {
  mkdirSync(cfg.outDir, { recursive: true })
  writeFileSync(join(cfg.outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8')
  try {
    await browser?.close()
  } catch {
    /* 实例由 ps1 关闭 */
  }
}

if (result.error) {
  console.error(`FAIL n=${cfg.tabs}: ${result.error}`)
} else {
  const L = result.longTasks
  const F = result.frameIntervalMs
  const I = result.inputLatencyMs
  const R = result.rendererMainThread
  const M = result.mainProcessEventLoopDelayMs
  console.log(`\n=== n=${cfg.tabs} 标签（${cfg.tabs - 1} 个 fake-tui ${cfg.mode} ${cfg.fps}fps），测量 ${result.measuredSeconds}s ===`)
  console.log(`输入延迟 ms    p50 ${I.p50}  p95 ${I.p95}  p99 ${I.p99}  max ${I.max}  超时 ${I.timeouts}/${I.sent}`)
  console.log(`帧间隔 ms      p50 ${F.p50}  p95 ${F.p95}  p99 ${F.p99}  max ${F.max}  >50ms ${F.over50ms}  >100ms ${F.over100ms}  平均 ${F.avgFps}fps`)
  console.log(`long task      >50ms ${L.over50ms} 次  总 ${L.totalMs}ms  阻塞 ${L.blockingMs}ms  最大 ${L.maxMs}ms`)
  console.log(`渲染主线程     忙 ${R.busyPercent}%  (script ${R.scriptPercent}% layout ${R.layoutPercent}% style ${R.styleRecalcPercent}%)`)
  console.log(`进程 CPU(%核)  ${JSON.stringify(result.processCpuPercentOfOneCore)}`)
  console.log(`主进程循环延迟 ${typeof M === 'string' ? M : `p50 ${M.p50}(底噪)  p99 ${M.p99}  max ${M.max} ms，超底噪 p99 +${M.p99ExcessOverP50} max +${M.maxExcessOverP50}`}`)
  if (result.warnings.length) console.log(`警告: ${result.warnings.join(' | ')}`)
  console.log(`结果: ${join(cfg.outDir, 'result.json').replace(/\\/g, '/')}`)
}
