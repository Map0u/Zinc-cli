# Zinc — Electron 换壳可行性 Spike 结果

结论先行：**材质 ✗（Mica/Acrylic/DWM 直调三种手段 API 全部"调用成功"但视觉上均未生效，最终定性为失败）× 半透明叠加 ✓（xterm.js 自身的 rgba 背景可用，只是没有真实的系统背景材质可透）× node-pty ✓ 完全跑通 × CDP ✓ 完全跑通**。

即：这次 spike 没能拿到"验收门"要求的那一个画面（终端区域透出 Mica/acrylic）。窗口本身、无边框、xterm.js + WebGL 渲染、node-pty + pwsh 7、二进制 IPC 通道、CDP 调试链路全部按要求跑通且工作正常；唯独最核心的视觉验收项——Mica/acrylic 材质透出——始终只呈现纯色（深灰/近黑），没有任何桌面壁纸纹理透出的迹象。

## 环境

- Windows 11, build 10.0.26200（远高于 Mica 最低要求的 22000/22621）
- `EnableTransparency=1`，深色主题，桌面壁纸有明显纹理/颜色（用于目视判断 Mica 是否真的采样了壁纸）
- Electron 43.0.0（当前 latest stable）、electron-vite 5.0.0、TypeScript 5.7、Node 22.16
- node-pty 1.1.0、@xterm/xterm 5.5.0、@xterm/addon-webgl 0.18.0
- 机器无预装 VC++ 生成工具（仅有 Visual Studio 2026 Community 主体，未装 C++ workload），且当前用户**非管理员**，无法弹 UAC 交互式安装 —— 这一点后面会展开

## 逐项验收结果

### 1. 材质（Mica/Acrylic/DWM 直调）—— 失败

按文档要求的降级顺序全部尝试并如实记录：

1. `win.setBackgroundMaterial('mica')` — 调用**不抛异常**，`backdrop-log.txt` 记录 "call succeeded (no throw)"。
2. 由于 (1) 报告成功，未触发到 acrylic 分支（正常降级逻辑下 mica"成功"就不会再试 acrylic）。
3. 额外加了 `ZINC_FORCE_DWM_DIRECT=1` 环境变量强制同时跑一遍**绕过 Electron、直接 koffi 调 `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE=38, DWMSBT_MAINWINDOW=2)`**，返回 `HRESULT=0`（即 Win32 API 层面确认调用成功）。

三种手段（Electron 高层 API 声称成功 / 强制走底层 DWM 原生调用确认成功）都通过了"调用不报错"的门槛，但**视觉上窗口从始至终都是一块近似纯色的深灰/黑色背景，看不到任何桌面壁纸纹理、噪点或模糊透出的痕迹**——用 windows-mcp Screenshot 反复截图验证（含移除 `backgroundColor: '#00000000'`、移除 `titleBarStyle: 'hidden'` 两轮排除实验，结果不变）。

排除过的假设：
- ❌ `backgroundColor` 8 位十六进制被误解析成不透明黑 → 移除该属性后现象不变。
- ❌ `titleBarStyle: 'hidden'` 与无边框窗口冲突导致材质类被覆盖 → 去掉后现象不变。
- ❌ DWM 参数/HRESULT 层面调用失败 → 直调返回 `HRESULT=0`，Win32 层确认接受了这个属性设置，现象依然不变。

**定性结论**：这不是参数配置问题，更像是 Electron/Chromium 合成器层面的已知历史坑——Chromium 为渲染进程的 HWND 子窗口默认绘制不透明合成表面，即使原生 DWM backdrop 材质属性被成功设置在顶层 HWND 上，Chromium 自己的 GPU 合成层仍然在客户区画出一块不透明背景，把材质完全盖住。这与任务背景里提到的"已知 Electron 的 Mica 有历史坑（与 transparent:true 互斥、闪烁等）"一致，只是本次遇到的具体表现是"完全不透明"而不是"闪烁"。

未尝试、留给正式迁移评估的方向：
- `transparent: true` + `backgroundMaterial` 同开（文档说互斥，但某些 Electron 版本组合下有人报告部分生效，值得单独起一个实验分支验证）。
- 更新/更旧的 Electron 版本对照（当前用的是刚发布的 43.0.0，是否是新引入的回归，还是从来没在 Electron 上真正稳定过，需要一次跨版本 bisect）。
- `win.setVibrancy` 这条 macOS 专用 API 在 Windows 上不适用，未测试。

### 2. 半透明叠加（终端 rgba 背景）—— 部分成立

xterm.js 的 `theme.background: 'rgba(12, 12, 12, 0.6)'` 本身正确生效（DOM 检查确认 `.xterm-viewport` 的内联样式就是这个值，WebGL renderer 激活后 canvas 也按这个颜色画底）。也就是说"终端本身是半透明的"这一半技术是成立的——**只是它现在透过去看到的是材质失败后留下的纯色背景，而不是 Mica**。如果材质问题解决，这条链路预计可以直接工作，不需要额外改造。

### 3. node-pty（pwsh 7 通过二进制通道）—— 完全成功

- `node-pty` 1.1.0 使用 N-API（ABI 稳定）预编译产物，`prebuilds/win32-x64/{pty.node,conpty.node,conpty_console_list.node}` 直接内置在 npm 包里，**不需要跑 `electron-rebuild` 针对 Electron ABI 重新编译**，也就完全绕开了本机没装 VC++ Build Tools 的问题。（细节见下方"坑"部分。）
- 走的是纯二进制通道：`main` 进程 `ptyProcess.onData` 收到字符串后 `Buffer.from(data, 'utf8')` 转成字节，`webContents.send('pty:data', bytes)` 通过 Electron IPC 的结构化克隆算法把 `Buffer`/`Uint8Array` 直接送到 renderer；renderer 侧用 `TextDecoder` 解码，全程**没有 Base64、没有 JSON 字符串包装**。输入方向（keystroke → pty）同理用 `TextEncoder` 编码成 `Uint8Array` 再 `ipcRenderer.send`。
- 实测：启动后自动 spawn `pwsh.exe`，通过 CDP 直接调用 `window.zinc.write(...)` 注入命令 `Write-Output ZINC_SPIKE_MARKER_12345`，2 秒后读取 xterm 的 `buffer.active` 内容，确认输出精确回显：

  ```
  PowerShell 7.6.3
  PS [workspace]> Write-Output ZINC_SPIKE_MARKER_12345
  ZINC_SPIKE_MARKER_12345
  PS [workspace]>
  ```

  也用 windows-mcp Screenshot 截图确认了同样内容在真实窗口里可见（见下方"证据"）。

### 4. CDP 远程调试链路 —— 完全成功

- 启动参数 `--remote-debugging-port=9336` 生效，`curl http://127.0.0.1:9336/json/version` 返回正常的 Chrome DevTools Protocol 信息（`Browser: Chrome/150.0.7871.46`, `Electron/43.0.0`）。
- `curl http://127.0.0.1:9336/json/list` 能拿到唯一的 page target，`webSocketDebuggerUrl` 可直接被外部脚本（本次用 Node + `ws` 写的独立诊断脚本）连接，执行 `Runtime.evaluate`、监听 `Runtime.consoleAPICalled`/`Runtime.exceptionThrown`，全程无障碍。这条链路也正是本次排查 preload 加载失败问题的关键手段（见下方"坑"）。

## 证据（windows-mcp Screenshot）

最终截图：无边框窗口，自定义标题栏文字 "Zinc — Electron Spike (Mica × xterm.js × node-pty)"，内嵌终端区域可见 `PowerShell 7.6.3` 提示符和刚才注入的 `ZINC_SPIKE_MARKER_12345` 回显。窗口背景（标题栏区域、终端容器内边距区域）为**纯深灰/近黑色，没有壁纸纹理透出**——这就是材质失败的直接视觉证据。截图过程中用不同窗口尺寸/位置重复验证了 3 次（含强制 DWM 直调那一轮），现象一致。

## 遇到的坑（按影响顺序）

1. **Mica/Acrylic/DWM 直调三选一全灭，且没有任何一种给出可诊断的错误信息**——这是本次 spike 最大的坑，也是唯一没解决的验收项。API 层面"成功"和视觉层面"生效"之间没有任何反馈机制可以提前发现问题，只能靠肉眼截图判断，调试成本很高。
2. **sandboxed preload 不能用 ESM**：`package.json` 设了 `"type": "module"` 后，electron-vite 把 preload 编译成 `.mjs`（ESM），Electron 的 sandboxed preload loader 在加载 ESM 时直接报 `SyntaxError: Cannot use import statement outside a module` 而且**整个 preload 静默失败**——渲染进程正常显示，但 `window.zinc` 是 `undefined`，不会有任何明显崩溃提示，只能通过 CDP 抓 `Runtime.exceptionThrown`/主进程日志才发现。解决办法：去掉 `package.json` 的 `"type": "module"`，让 main/preload 按 CJS（`.js`）产出。这是正式迁移里必须踩一遍的坑，建议在项目脚手架阶段就把这条约定写进规范。
3. **electron-vite 5.x 的 config schema 变了**：旧写法里给 `main`/`preload`/`renderer` 各配 `build.rollupOptions.input` 在 v5 里直接类型报错（`rollupOptions` 已经不在 `MainBuildOptions`/`PreloadBuildOptions` 类型里）。改成完全依赖 electron-vite 的**约定式入口**（`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/index.html`）即可，不需要手写 `rollupOptions`。升级 electron-vite 大版本时要重新过一遍官方模板。
4. **VS Build Tools 不能自动化装上**：机器上只有 VS 2026 Community 主体，没装 "使用 C++ 的桌面开发" workload；当前用户不是管理员，`vs_installer.exe modify --add Microsoft.VisualStudio.Workload.VCTools` 无论 `--quiet`/`--passive` 都因为需要 UAC 提权而静默失败（无日志、无报错，进程直接消失）。**最终靠 node-pty 1.1.0 已经是 N-API 预编译产物、内置多平台 `prebuilds/`，完全绕过了这个坑**——但如果正式迁移选用的某个 native 模块没有 N-API 预编译（很多老依赖仍然是纯 node-gyp、按 Node/Electron ABI 各编一份的），这条路会走不通，必须提前拿到管理员权限装好 C++ workload，或者切到 CI 里预编译好再分发。这是**正式迁移前必须确认的环境前置条件**，不能假设开发机都能顺利装 VS Build Tools。
5. **`node-pty` 的 `electron-rebuild -f`（force）反而会触发不必要的源码编译**：`-f` 强制忽略已经内置的 prebuild 直接走 `node-gyp rebuild`，这时才会撞上 VS Build Tools 缺失的墙。教训：**不要无脑加 `-f`**，先跑一次不带 force 的安装，确认 prebuild 是否已经满足当前平台再决定要不要强制重新编译。
6. **@xterm/xterm 6.x 与 @xterm/addon-fit / @xterm/addon-webgl 的 peer dependency 还没跟上**：`npm install` 直接报 `ERESOLVE`（addon-fit 声明的 peer 是 `^5.0.0`，装 xterm 6 会冲突）。改用 xterm 5.5.0（当前稳定版）解决，等 xterm 生态的 addon 都放出对应 6.x peer 声明后再考虑升级。
7. **allowTransparency 选项在新版 xterm.js 里已被移除**（TS 编译期报错提示该属性不存在于 `ITerminalOptions`），改为完全依赖 `theme.background` 的 rgba alpha 通道即可达到同样效果，不需要额外配置。

## 正式迁移的注意事项清单

- **材质问题是阻断性的**，在决定"整体迁移 Electron"之前必须先把 Mica/Acrylic 到底能不能在 Electron 里稳定展示这件事查清楚（例如：换用更旧/更新的 Electron 版本 bisect、试 `transparent: true` 与 backgroundMaterial 组合、或者接受"仅用一层半透明纯色模拟毛玻璃观感、放弃真材质"这个降级方案）。当前这次 spike 的结果建议是：**先单独开一个更聚焦的"Electron Mica 到底能不能用"调查任务，再决定要不要推进整体迁移**，不要在材质问题没解决的情况下就基于其余三项全绿而直接批准迁移。
- native 模块优先选择/确认有 N-API 预编译（`prebuildify`/`node-gyp-build` 生态），可以完全跳过本机 C++ 编译环境依赖；如果某个依赖只能靠 node-gyp 现场编译，要提前确认目标开发机/CI 有管理员权限装好 VC++ Build Tools。
- 项目脚手架阶段就定好 `package.json` 是否要 `"type": "module"`，一旦涉及 sandboxed preload，就不能用 ESM 格式的 preload 产物；main 进程本身用不用 ESM 影响较小，但为了统一建议整个 electron-vite 项目都不设 `"type": "module"`，让工具链自动产出 CJS。
- IPC 二进制通道（Buffer/Uint8Array 经结构化克隆）已验证可行，正式迁移可以直接照搬这条路径，不需要再考虑 Base64/JSON 方案。
- CDP 调试链路稳定可用，后续可以把 `mcp__playwright__*`/自定义 CDP 脚本正式纳入这个项目的验证流程（比如换个自动化回归测试终端渲染是否正常）。

## 涉及文件

- `electron-spike/src/main/index.ts` — 窗口创建、材质降级尝试链、pty 二进制 IPC
- `electron-spike/src/preload/index.ts` / `electron-spike/src/preload/index.d.ts` — 类型化 contextBridge API
- `electron-spike/src/renderer/main.ts` / `electron-spike/src/renderer/index.html` / `electron-spike/src/renderer/styles.css` — xterm.js + WebGL + pty 绑定
- `electron-spike/electron.vite.config.ts`、`electron-spike/package.json`、`electron-spike/tsconfig*.json`
- `electron-spike/SPIKE-RESULT.md` — 本报告
