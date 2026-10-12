// 模拟 Claude Code（Ink TUI）的终端输出形态，用于 Zinc 前台卡顿基准。
// 用法: node fake-tui.mjs [--fps=20] [--rows=40] [--mode=alt|normal]
//        [--title-ms=150] [--duration=0] [--sync] [--tag=xxx]
//   --fps       每秒重绘帧数（默认 20，即每 50ms 一帧）
//   --rows      重绘区域行数（默认 40；不超过终端行数-1，显式给出则不夹取）
//   --mode      alt = 进入 alternate screen（\x1b[?1049h），按 CUP 整屏重绘；
//               normal = 留在普通缓冲区，Ink 式「光标上移 + 逐行擦除重写」
//   --title-ms  OSC 0 改标题间隔（默认 150ms，0 关闭），转动 ✳ ✶ ✻ ✽ ✢ 字符
//   --duration  运行秒数，0 = 一直运行到被杀（默认 0）
//   --sync      用 DEC 2026 同步输出（\x1b[?2026h/l）包裹每一帧
//   --tag       仅用于在命令行里标记本次启动，便于清理时精确识别
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)
const fps = Math.max(1, Number(args.fps ?? 20))
const mode = args.mode === 'normal' ? 'normal' : 'alt'
const titleMs = Number(args['title-ms'] ?? 150)
const durationSec = Number(args.duration ?? 0)
const sync = Boolean(args.sync)
const cols = Math.max(40, process.stdout.columns || 100)
const termRows = process.stdout.rows || 41
const rows = args.rows !== undefined ? Math.max(6, Number(args.rows)) : Math.max(6, Math.min(40, termRows - 1))
const W = cols - 1 // 留一列，避免自动换行

const ESC = '\x1b'
const RESET = `${ESC}[0m`
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TITLE_SPIN = ['✳', '✶', '✻', '✽', '✢', '·']
const CN = [
  '正在分析仓库结构并检查渲染线程的繁忙程度',
  '读取文件 src/renderer/src/terminal/TerminalHostRegistry.ts',
  '终端输出经过 node-pty 与 IPC 到达渲染进程再写入 xterm',
  '后台标签持续重绘会占用主线程并拖慢前台输入响应',
  '修改已完成，正在运行测试以确认没有引入回归问题'
]
const CODE = [
  'const entry = this.hosts.get(id)',
  'if (entry.state === "ready") this.fitTerminal(entry)',
  'requestAnimationFrame(() => entry.term.focus())',
  'for (const chunk of chunks) term.write(chunk)',
  'export async function runBench(opts: Options) {'
]

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cw = (ch) => {
  const c = ch.codePointAt(0)
  return (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xac00 && c <= 0xd7a3) ? 2 : 1
}
const width = (s) => {
  let n = 0
  for (const ch of s) n += cw(ch)
  return n
}
function fit(s, n) {
  let out = ''
  let w = 0
  for (const ch of s) {
    const x = cw(ch)
    if (w + x > n) break
    out += ch
    w += x
  }
  return out + ' '.repeat(n - w)
}
const fg = (r, g, b) => `${ESC}[38;2;${r};${g};${b}m`
const bg = (r, g, b) => `${ESC}[48;2;${r};${g};${b}m`

function buildLine(i, frame, r) {
  const inner = W - 2
  const spin = SPIN[frame % SPIN.length]
  const sec = Math.floor(frame / fps)
  const border = fg(120, 120, 130)
  const wrap = (body) => `${border}│${RESET}${body}${RESET}${border}│${RESET}`
  if (i === 0) return `${border}╭${'─'.repeat(inner)}╮${RESET}`
  if (i === rows - 1) return `${fg(150, 150, 150)}${fit('  ? 快捷键 · esc 中断 · FT-FRAME ' + frame, W)}${RESET}`
  if (i === rows - 2) return `${border}╰${'─'.repeat(inner)}╯${RESET}`
  if (i === rows - 3) {
    return wrap(`${bg(15, 15, 15)}${fg(215, 119, 87)}${fit(' > ' + CN[(frame >> 3) % CN.length].slice(0, 6) + '▌', inner)}`)
  }
  if (i === 1) {
    return wrap(
      `${bg(15, 15, 15)}${fg(215, 119, 87)}${fit(` ${spin} Working… (${sec}s · ↓ ${(frame * 37) % 9999} tokens · esc to interrupt)`, inner)}`
    )
  }
  switch (i % 5) {
    case 0: {
      const n = 100 + ((frame + i) % 900)
      return wrap(`${bg(12, 18, 12)}${fg(110, 200, 120)}${fit(` ${n} + ${CODE[(i + (frame >> 2)) % CODE.length]}`, inner)}`)
    }
    case 1: {
      const n = 100 + ((frame + i) % 900)
      return wrap(`${bg(24, 12, 12)}${fg(220, 110, 110)}${fit(` ${n} - ${CODE[(i + 1 + (frame >> 3)) % CODE.length]}`, inner)}`)
    }
    case 2:
      return wrap(`${fg(80 + ((r() * 175) | 0), 160, 220)}${fit(' ● ' + CN[(i + (frame >> 4)) % CN.length], inner)}`)
    case 3: {
      // 40 背景 + 256 色前景 + 粗体/暗淡混用
      const c = 16 + ((r() * 215) | 0)
      return wrap(
        `${ESC}[40m${ESC}[38;5;${c}m${ESC}[1m${fit(' ⎿ ', 5)}${ESC}[22;2m${fit('output line ' + ((r() * 99999) | 0), inner - 5)}`
      )
    }
    default: {
      const cells = []
      let used = 0
      while (used < inner - 12) {
        const t = ` ${((r() * 1e6) | 0).toString(16)}`
        cells.push(`${bg((r() * 30) | 0, (r() * 30) | 0, (r() * 30) | 0)}${fg(120 + ((r() * 135) | 0), 120 + ((r() * 135) | 0), 120 + ((r() * 135) | 0))}${t}`)
        used += t.length
      }
      return wrap(cells.join('') + RESET + ' '.repeat(Math.max(0, inner - used)))
    }
  }
}

function frameString(frame) {
  const r = rng(frame * 7919 + 1)
  const lines = []
  for (let i = 0; i < rows; i++) lines.push(buildLine(i, frame, r))
  let out = ''
  if (mode === 'alt') {
    out = lines.map((l, i) => `${ESC}[${i + 1};1H${ESC}[2K${l}`).join('')
  } else {
    // Ink 式 eraseLines：先上移到区域首行，再逐行擦除重写
    out = (frame === 0 ? '' : `\r${ESC}[${rows - 1}A`) + lines.map((l) => `${ESC}[2K${l}`).join('\n')
  }
  return sync ? `${ESC}[?2026h${out}${ESC}[?2026l` : out
}

process.stdout.on('error', () => process.exit(0))
let frame = 0
const t0 = Date.now()
let stopped = false
function cleanup() {
  if (stopped) return
  stopped = true
  process.stdout.write(`${RESET}${ESC}[?25h${mode === 'alt' ? `${ESC}[?1049l` : '\n'}`)
  process.stdout.write(`FT-DONE frames=${frame} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

process.stdout.write(`${ESC}[?25l`)
if (mode === 'alt') process.stdout.write(`${ESC}[?1049h${ESC}[2J`)
else process.stdout.write('\n')

let titleN = 0
if (titleMs > 0) {
  setInterval(() => {
    process.stdout.write(`${ESC}]0;${TITLE_SPIN[titleN++ % TITLE_SPIN.length]} Working\x07`)
  }, titleMs).unref?.()
}

const period = 1000 / fps
function tick() {
  if (durationSec > 0 && Date.now() - t0 >= durationSec * 1000) return cleanup()
  process.stdout.write(frameString(frame++))
  // 按绝对时间表排下一帧，避免累计漂移；落后时不补帧
  const next = t0 + frame * period
  setTimeout(tick, Math.max(0, next - Date.now()))
}
tick()
