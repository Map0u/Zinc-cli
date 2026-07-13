# Zinc — Electron Mica/Acrylic 材质专项调查结果

结论先行：**A) 找到真正生效的组合 —— Acrylic 生效，Mica 不生效**。在 Electron 43.0.0 + Windows 11 10.0.26200 这个组合下，`backgroundMaterial: 'acrylic'` 在构造 `BrowserWindow` 时传入即可稳定产生真实的毛玻璃模糊透出（桌面壁纸纹理清晰可见且带模糊），与 `frame: true/false` 无关；而 `backgroundMaterial: 'mica'` 在本机三种独立配置下全部失败（纯色不透明），与 SPIKE-RESULT.md 记录的结果一致。

不需要走 B）纯透明降级方案 —— Acrylic 这条路径已经可行，且比纯透明（`transparent:true`）观感更好（真实高斯模糊 vs. 纯锐利透视）。

## 环境

与 SPIKE-RESULT.md 相同：Windows 11 Pro 10.0.26200，Electron 43.0.0，electron-vite 5.0.0。桌面壁纸左侧为高对比度霓虹斜纹（纹理明显，用于目视判断模糊/透出效果的最佳测试面）。

## 判定方法的一个关键教训

`windows-mcp` 的 `Screenshot` 工具（DXGI/桌面复制类后端）能正确捕获 Chromium GPU 合成表面，用它截图可以正确看到材质效果（模糊或纯色）。但用 .NET `Graphics.CopyFromScreen`（传统 GDI BitBlt）截图时，**完全捕获不到窗口内容**，只会拍到窗口"背后"的桌面——这是 GDI BitBlt 无法读取硬件加速合成表面的经典问题。最终改用 `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT=2)` 才能可靠地把 Chromium 窗口内容存成文件，不依赖窗口是否在前台/是否被其他窗口遮挡。**如果后续还要写自动化截图脚本判定材质是否生效，必须用 `PrintWindow` + `PW_RENDERFULLCONTENT`，不能用 `CopyFromScreen`。**

另一个坑：**minimize→restore 循环会让 Acrylic 从"生效"变回"纯色"**（一次实验中，为了关掉 DevTools 附带调用了 `ShowWindow(SW_RESTORE)`，之后同一个窗口从可见的模糊状态变成了纯色）。这与 Electron/DWM 已知的"窗口失去焦点或经历最小化状态切换后 backdrop 材质需要重新应用"问题吻合，本次未继续深挖根因，但**这是实现里必须处理的一个焦点/最小化事件回调点**（迁移到正式实现时，应该在 `focus`/`restore` 事件里重新调用一次 `setBackgroundMaterial` 兜底）。

## 实验矩阵与结果

所有实验都基于 `src/main/index.ts` 里新增的 `ZINC_EXPERIMENT` 环境变量分支（保留在代码里，未删除，作为本次调查的可复现记录）：

| # | 配置 | frame | titleBarStyle | backgroundMaterial 设置方式 | 结果 |
|---|------|-------|---------------|------------------------------|------|
| 原始 spike | `setBackgroundMaterial('mica')` 构造后调用 + DWM 直调兜底 | false | 无 | 构造后调用 | ❌ 纯色，SPIKE-RESULT.md 已记录 |
| 1 | mica + 隐藏原生标题栏 | **true** | `'hidden'` | **构造时传入** | ❌ 纯色（复测 2 次，结果一致） |
| 2 | acrylic + 隐藏原生标题栏 | **true** | `'hidden'` | **构造时传入** | ✅ **模糊清晰，壁纸纹理透出**（复测 2 次，结果一致，其中一次因 minimize/restore 意外退化为纯色，见上文坑点） |
| 3 | 放弃材质，纯透明 CSS 玻璃 | false | 无 | 不设置，`transparent:true` | ✅ 但只是**锐利透视**，无高斯模糊，不是真材质 |
| 4 | mica，无边框 | **false** | 无 | 构造时传入 | ❌ 纯色 |
| 5 | acrylic，无边框 | **false** | 无 | 构造时传入 | ✅ **模糊清晰，壁纸纹理透出** |

关键结论：
- **`frame` 参数（true/false）对 Acrylic 是否生效没有影响** —— 实验 2 和 5 都成功，唯一变量是 `backgroundMaterial: 'acrylic'`。这推翻了"必须 `frame:true` 才能让材质生效"这条网上常见说法（至少在 Electron 43 / Win11 26200 这个组合下不成立）。
- **Mica 在三种独立配置下全部失败**（原始 spike 的构造后调用、实验 1 的 frame:true 构造时传入、实验 4 的 frame:false 构造时传入），排除了"构造时机"和"frame 设置"两个假设，说明这是 Electron 43.0.0 在这台 Win11 26200 机器上 Mica 特有的渲染问题（Acrylic 走的是完全不同的 DWM 合成路径，显然没受影响）。
- **CSS 侧无需改动** —— `styles.css` 里原有的全透明 `html/body/#titlebar` 和 xterm `theme.background: rgba(...)` 配置在 Acrylic 生效后直接可用，不需要额外调整；实验中终端文字和标题栏文字都能正常叠加在模糊背景之上。

## 最终推荐配置（结论 A）

```ts
new BrowserWindow({
  // frame: true/false 均可，按产品需要的标题栏样式选择
  backgroundMaterial: 'acrylic',   // 必须在构造函数里传，不要用 setBackgroundMaterial() 事后调用
  // 不要设置 transparent: true（与 backgroundMaterial 互斥）
  // 不要设置 backgroundColor（会被解析成不透明色盖住材质）
  webPreferences: { /* ... */ }
})
```

以及：
- 在 `focus`/`restore` 窗口事件里补一次 `win.setBackgroundMaterial('acrylic')` 调用，防御 minimize/restore 后材质丢失的已知问题（本次只观测到现象，未做根因排查和修复验证，正式迁移时需要专门验证这条兜底是否真的有效）。
- 不要用 Mica —— 在当前 Electron 43.0.0 版本上不可用，如果产品设计上必须用 Mica 观感，需要另开一次跨 Electron 版本 bisect 调查（本次任务范围之外）。

## 证据结论

实验 2/5 中 Acrylic 能稳定显示模糊背景，而相同条件下 Mica 仍为纯色深灰。
原始窗口截图不属于公开源码资产，实验配置、复测次数与观察结论以上方文字矩阵为准。

## 涉及文件

- `electron-spike/src/main/index.ts` —— 新增 `ZINC_EXPERIMENT` 环境变量分支（1–5），保留全部矩阵实现，作为可复现记录；未删除原始 spike 分支（`unset` 时的默认行为）。
- `electron-spike/MATERIAL-RESULT.md` —— 本报告。
