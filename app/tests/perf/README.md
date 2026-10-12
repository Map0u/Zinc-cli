# Zinc 前台卡顿基准（tests/perf）

用途：模拟「约 10 个标签、每个都在跑 Claude Code 式（Ink TUI）高频重绘程序」的真实场景，量化前台空闲标签的输入响应和渲染线程繁忙度，用于优化前后对比。

## 用法

```
pwsh -NoProfile -File app/tests/perf/run-bench.ps1                       # 依次跑 N=1、N=10（各约 1 分钟）
pwsh -NoProfile -File app/tests/perf/run-bench.ps1 -TabCounts 10 -MeasureSec 60 -Mode normal -Sync
pwsh -NoProfile -File app/tests/perf/run-bench.ps1 -TabCounts '1,10,20'   # 多个 N：用逗号分隔的字符串
```

常用参数：`-TabCounts`（逗号分隔字符串，默认 `'1,10'`；每个 N 必须在 1..20，超出立即报错；不要用 PowerShell 数组，`pwsh -File` 下数组参数会被误解析）、`-WarmupSec 5`、`-MeasureSec 30`、`-Fps 20`、`-Rows`（0=min(40,终端行数-1)）、`-Mode alt|normal`、`-TitleMs 150`、`-Sync`（DEC 2026）、`-InputIntervalMs 200`、`-InspectPort 9337`（0 关闭主进程测量）、`-OutRoot`（输出根目录，默认 `$env:RUNNER_TEMP` 或系统临时目录下的 `zinc-perf`）。

每个 N 都会起一个全新的隔离 dev 实例（`ZINC_TEST_ISOLATED` / `ZINC_TEST_USER_DATA` 指向临时目录、`ZINC_TEST_SILENT`，CDP 端口 9336），N-1 个标签跑 `fake-tui.mjs`，另 1 个空闲 PowerShell 标签做前台。连上 CDP 后会核对 browser 进程 PID 属于本次启动的进程树，否则中止；结束后 `taskkill /T` 只关自己的进程树。结果写入 `<OutRoot>/<时间戳>-n<N>/result.json`（同目录有 dev 日志），并在终端打印摘要。

单独看假 TUI 的形态：`node app/tests/perf/fake-tui.mjs --fps=20 --rows=40 --mode=alt|normal --title-ms=150 --duration=10 [--sync]`

## 指标含义（均只统计测量窗口，不含预热）

- **输入延迟**：每 200ms 按固定时间表经 CDP `Input.insertText` 向前台终端发 1 个字符，到该字符回显进入 xterm 缓冲区的时间（页面内 `onWriteParsed` 读光标偏移，不依赖 DOM，换渲染器后仍可用）。含 CDP 投递、渲染线程排队、IPC、shell 回显。`超时` = 2s 内未出现。**最直接的“手感”指标。**
- **帧间隔**：页面 `requestAnimationFrame` 回调间隔。空闲时等于显示器刷新周期，变大说明渲染线程被占。
- **long task**：渲染主线程 >50ms 的任务次数、总时长、阻塞时长（超出 50ms 的部分之和）、最大值。
- **渲染主线程忙%**：CDP `Performance.getMetrics` 的 TaskDuration 增量 / 窗口时长（附 script / layout / style 占比），比 long task 更灵敏。
- **进程 CPU**：各 Chromium 进程（browser = Electron 主进程、renderer、GPU 等）CPU 占单核的百分比。
- **主进程事件循环延迟**：用 `--inspect` 连主进程跑 `monitorEventLoopDelay`。Windows 定时器粒度约 15.6ms，所以 p50 约 15ms 是底噪，看“超底噪”的 p99/max。
- `backgroundFeed`：后台 fake-tui 在窗口内的实际帧数增量，用来确认后台确实在持续输出。

## 限制

- 跑的是 `npm run dev`（未打包、Vite/React 开发构建，只有它开 CDP 和 `__zincRegistry`），绝对数字比发布版差，只适合同环境前后对比。
- 窗口在测试模式下被放到屏幕外（-3000,0）且不抢焦点，渲染仍正常（visibilityState=visible）。
- 输入延迟里包含 CDP 投递，与真实键盘事件路径略有差异；跑基准时尽量别同时做别的重活，结果有几 ms 到几十 ms 的波动，建议每组多跑几次。
- fake-tui 是对 Ink 输出形态的近似（整区重绘、24 位色/256 色/40 背景、框线、中文、spinner、OSC 0 标题），不是真实 Claude Code。
