export interface ChangelogEntry {
  version: string
  date: string
  zh: string[]
  en: string[]
}

/** Local release notes used by About and the update dialog fallback. */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: '0.8.1',
    date: '2026-10-14',
    zh: [
      '设置页重新分了页：新增“标签与 AI”页，收纳“项目自动分组”“精确 AI 状态”“图片粘贴”；“终端”页只保留字体、光标和性能相关的设置。“按项目分组标签”现在叫“项目自动分组”，“Grok 全屏配色适配”叫“Grok 全屏配色”。',
      '设置页文案缩短：只在标题和选项说不清时才留一句说明，重复下拉选项的说明已删除。',
      '界面圆角统一为两档：卡片、菜单、弹窗、窗口卡片 8 px，输入框、按钮、标签行 4 px。',
      '修复：“图片粘贴”的下拉框会冲出卡片边缘。较长的说明现在留在控件左侧，不再把控件挤到单独一行。'
    ],
    en: [
      'Settings has a new "Tabs & AI" page holding "Auto-group by project", "Precise AI status" and "Image paste"; Terminal keeps font, cursor and performance. "Group tabs by project" is now "Auto-group by project" and "Grok full-screen surface tint" is "Grok full-screen tint".',
      'Settings text is shorter: a description stays only where the title and the options do not already say it, and the ones that repeated their control are gone.',
      'Corner radii come in two steps: cards, menus, dialogs and the window card are 8 px; fields, buttons and rail rows are 4 px.',
      'Fixed: the Image paste dropdown no longer opens past the edge of its card; a long description now stays beside the control instead of pushing it onto its own row.'
    ]
  },
  {
    version: '0.8.0',
    date: '2026-10-14',
    zh: [
      '标签分组：侧栏里可以把标签归成组，组头可折叠、展开（带短动画）、重命名、解散；折叠后显示组内标签数和最需要你注意的状态。可以把标签拖进、拖出或在组内拖动，也可以整组拖动，拖动时其他行让位，Esc 一键放回。分组、组名、折叠状态和标签重命名重启后都会恢复。',
      '按项目自动分组：在同一个项目文件夹（Git 根目录，否则就是该文件夹）里工作的标签会自动归成一组，无论是在那里启动的 Claude Code，还是 cd 进去的 shell，组名取自文件夹名。你亲手拖过、分过组或移出组的标签不会再被自动挪动，标签菜单里的“自动分组”可以把它交还给自动分组。设置里的“按项目分组标签”（默认开启）可以整体关闭。',
      'AI 会话标签有了状态图标：工作中（转动）、等你操作、已完成、出错。新的“精确的 AI 状态”设置（默认开启，仅对新标签生效）让 Claude Code 如实报告这些状态，做法是让标签运行在 Zinc 内置的控制台宿主上；关闭时只能凭标题猜“工作中”和“空闲”。标题只有转圈符号或默认 AI 名称的标签，现在显示所在项目文件夹。',
      '粘贴图片：Ctrl+V 时剪贴板里的图片直接交给 Claude Code、Codex、Kimi 或 Grok，由它们自己读取剪贴板（显示为 [Image #1]），不再保存文件；普通 shell、WSL，或在设置里选“始终保存为文件”时，仍粘贴已保存图片的路径。',
      '更省内存：所有终端共用一个输出读取线程，开 12 个标签约省 81 MB，开 20 个约省 135 MB（开发版实测）；新安装的默认滚动缓冲从 10000 行降到 3000 行（已保存的设置不变）；工作中图标改为分步转动，满屏工作中的会话不再让显卡持续忙碌。',
      '移除：Kimi 全屏模式的滚轮翻页。若使用 Kimi 的 tui_mode = "fullscreen"，滚轮现在会回溯 Kimi 的输入历史，而不是滚动画面。'
    ],
    en: [
      'Tab groups: gather tabs into groups in the rail. A group header collapses and expands (with a short animation), and can be renamed or dissolved; collapsed, it shows the tab count and the status that most needs you. Drag a tab into, out of or within a group, or drag a whole group; rows slide aside as you drag and Esc puts everything back. Groups, their names, collapsed state and tab renames are restored after a restart.',
      'Automatic grouping by project: tabs working in the same project folder (the Git root, else the folder itself) are grouped for you, whether it is Claude Code launched there or a shell that cd-s into it, and the group is named after the folder. A tab you have dragged, grouped or taken out yourself is never moved again; "Group automatically" in its menu hands it back. The "Group tabs by project" setting (on by default) turns it all off.',
      'Tabs running an AI CLI show a status icon: working (spinning), waiting for you, done, or failed. The new "Precise AI status" setting (on by default, new tabs only) lets Claude Code report these exactly by running the tab on the console host bundled with Zinc; off, only working and idle are guessed from the title. A tab whose title is only a spinner or a default AI name now shows its project folder.',
      'Image paste: Ctrl+V with an image on the clipboard hands it straight to Claude Code, Codex, Kimi or Grok, which read the clipboard themselves (shown as [Image #1]); no file is saved. A plain shell or WSL, or the "Always save as a file" choice in Settings, still pastes the path of a saved copy.',
      'Lighter on memory: all terminals share one output-reading worker, about 81 MB less with 12 tabs and about 135 MB less with 20 (development-build measurement); the default scrollback for a fresh install is 3000 lines instead of 10000 (a stored setting is kept); the working icon turns in steps, so a window full of working sessions no longer keeps the GPU busy.',
      'Removed: wheel paging for Kimi\'s fullscreen mode. With Kimi\'s tui_mode = "fullscreen" the mouse wheel now recalls Kimi\'s input history instead of scrolling.'
    ]
  },
  {
    version: '0.7.4',
    date: '2026-10-12',
    zh: [
      '终端默认改回原来的绘制方式：0.7.3 把当前标签改成显卡绘制（WebGL）后，文字比以前偏细偏淡。现在显卡绘制是设置里的可选项（“GPU 渲染”），默认关闭；打开后会把字重微调到 Medium，笔画浓度与默认绘制相差在 2% 以内（JetBrains Mono 17 px、150% 缩放下实测，浅色和深色主题都一致）。',
      '隐藏标签停止绘制的改动保留，0.7.3 的流畅提升主要来自这一条。'
    ],
    en: [
      'Terminals draw with the original DOM renderer by default again: after 0.7.3 moved the visible tab to GPU drawing (WebGL), text looked thinner and lighter than before. GPU drawing is now an optional "GPU rendering" setting, off by default; when on, the glyph weight is nudged to Medium so its ink coverage stays within 2% of the default renderer (measured with JetBrains Mono 17 px at 150% scaling, light and dark themes).',
      'Hidden tabs still stop painting, which is where most of the 0.7.3 responsiveness gain comes from.'
    ]
  },
  {
    version: '0.7.3',
    date: '2026-10-12',
    zh: [
      '多个标签同时忙时窗口不再卡顿：切到后台的标签停止绘制（输出照常接收，切回来就是最新画面），不再和你的打字、滚动抢同一条线程。在开发版基准测试中（9 个后台标签模拟 Claude 式持续刷屏），界面线程占用从 88% 降到 15%，按键延迟 p95 从 80 毫秒降到 32 毫秒。',
      '当前标签改用显卡绘制（WebGL），持续刷屏的开销降到约四分之一；显卡不可用时自动退回原来的绘制方式。标签标题动画改为批量更新（每秒最多 4 次），隐藏的设置页不再跟着重绘。',
      '修复后台标签启动完成时抢走键盘焦点；修复透明背景下颜色错乱；滚动查看历史时不再被拉回；“进程已退出”提示总在最后一行输出之后；粘贴大图片不再卡住窗口。'
    ],
    en: [
      'The window stays responsive when many tabs are busy: hidden tabs stop painting (their output is still read and is current when you switch back) instead of competing with your typing and scrolling. In a development-build benchmark with nine simulated Claude-style redrawing background tabs, the interface thread went from 88% to 15% busy and p95 keystroke latency from 80 ms to 32 ms.',
      'The visible tab now draws with the GPU (WebGL), cutting the cost of a constantly redrawing tab to about a quarter, with automatic fallback. Animated tab titles are applied in batches (at most four times a second) and no longer re-render the hidden Settings page.',
      'Fixed a background tab stealing keyboard focus when it finished starting, wrong colors with the transparent background, scroll position jumping during output, the exit notice appearing before final output, and large image pastes blocking the window.'
    ]
  },
  {
    version: '0.7.2',
    date: '2026-10-02',
    zh: [
      '修复 Claude 对话被移到后台（agents 视图、← 键）后，重启 Zinc 恢复错对话或报“is running in the background”：Claude 会把这类对话复制成新 ID 的后台任务，Zinc 记录的 ID 随之过时。现在恢复时沿 Claude 的交接记录找到当前对话，后台仍在运行就用 claude attach 接回，已结束则恢复最新副本。Zinc 不会启动、停止或改动任何后台任务；查不到后台信息时按原方式恢复。'
    ],
    en: [
      'Fixed Claude tabs whose conversation was moved to the background (agents view, ←) restoring a stale copy or failing with “is running in the background”: Claude forks such a conversation into a background job with a new ID, which made Zinc’s saved ID stale. Restore now follows Claude’s hand-off record, attaches a live job with claude attach, and resumes the newest copy once the job has ended. Zinc never starts, stops or changes background jobs; without job information it restores as before.'
    ]
  },
  {
    version: '0.7.1',
    date: '2026-10-01',
    zh: [
      '修复已退出 Claude 的标签不恢复：对话本身保存在磁盘上，没有正在运行的 Claude 进程不再清除该标签记录的会话 ID。此前只有仍在运行的标签会恢复对话，闲置数小时的标签重启后只是普通终端。'
    ],
    en: [
      'Fixed tabs whose Claude had already quit not resuming: a conversation lives on disk, so the absence of a live Claude process no longer discards the tab’s saved session ID. Previously only tabs with Claude still running came back, and tabs left idle for hours reopened as plain shells.'
    ]
  },
  {
    version: '0.7.0',
    date: '2026-09-29',
    zh: [
      '同一项目目录的多个 Claude 标签可按各自的会话 ID 精确恢复，不再都接到最新一条。Zinc 通过进程专属设置中的会话钩子记录 ID；交互提示符直接输入 claude 可被包装捕获，全路径、脚本和 WSL 手动启动不在覆盖范围内。身份不确定时保守地打开终端，避免误接他人的对话。',
      '改进退出保存、终端进程识别、Shell 探测与失败恢复；更新检查、贴图与外链出错时不再默默忽略。'
    ],
    en: [
      'Claude tabs in one project directory can resume their own conversation IDs instead of all attaching to the newest one. A per-process SessionStart hook records each ID; typing claude directly at an interactive prompt is covered, while full-path launches, scripts and manual WSL launches are not. Unknown identities reopen conservatively to avoid joining another tab’s conversation.',
      'Improves shutdown persistence, terminal process detection, shell discovery and error handling for updates, image paste and external links.'
    ]
  },
  {
    version: '0.6.11',
    date: '2026-09-19',
    zh: [
      '新增可选开关「Grok 全屏配色适配」：Grok 全屏界面出现时，终端卡片底色改用 Grok 自己的灰，不再在它周围留一圈别的颜色，切换时平滑过渡。'
    ],
    en: [
      'New optional "Grok full-screen surface tint" setting: the terminal card takes Grok’s own surface colour while its full-screen TUI is on screen, fading in and out instead of leaving a differently coloured frame around it.'
    ]
  },
  {
    version: '0.6.10',
    date: '2026-09-19',
    zh: [
      '浅色配色下，终端里的反白文字（Claude Code 会整块这样画）不再变成一条纯色块、字全看不见。'
    ],
    en: [
      'Inverse terminal text is readable again on light colour schemes instead of rendering as a solid bar with the text invisible inside it.'
    ]
  },
  {
    version: '0.6.9',
    date: '2026-09-19',
    zh: [
      '中文输入法连打长串时，终端不会再被推到左边、左侧文字被裁掉。',
      '恢复对话不再塌缩：同一个目录下的多个 tab 只有一个接着上次的对话，其余回到该目录起一个干净的终端。',
      '认得 Kimi Code 了，Kimi 的 tab 不再存成「没有工具」、下次打开也能接着聊。',
      '滚轮翻页只在 Kimi 全屏界面生效，vim、less、htop 和 Codex / Grok 的界面恢复正常行滚。'
    ],
    en: [
      'A long IME composition no longer pushes the terminal off to the left with no way to scroll back.',
      'Session restore no longer collapses several tabs onto one conversation: only one tab per tool and directory resumes, the rest reopen as a plain shell there.',
      'Kimi Code is now detected and restored like the other CLIs.',
      'Full-screen wheel paging applies to Kimi only; vim, less, htop and the Codex/Grok TUIs keep native line scrolling.'
    ]
  },
  {
    version: '0.6.8',
    date: '2026-08-25',
    zh: [
      '修好 Kimi 全屏滚轮：独占滚轮，一格翻一页，不再跟终端行滚抢同一个手势。'
    ],
    en: [
      'Kimi full-screen wheel paging now owns the wheel: one notch is one page, without fighting terminal line-scroll.'
    ]
  },
  {
    version: '0.6.7',
    date: '2026-08-25',
    zh: [
      '新增可选开关「Kimi 全屏滚轮适配」：Kimi 全屏 TUI 时滚轮按 PageUp/PageDown 整页翻对话，不再一行行滚。',
      '带 UTF-8 BOM 的 settings.json（Windows PowerShell 默认写法）会正常加载，不再整份回落到默认值。'
    ],
    en: [
      'New optional "Kimi full-screen wheel paging" setting: the wheel sends PageUp/PageDown inside Kimi\u2019s full-screen TUI instead of line-scrolling.',
      'settings.json files with a UTF-8 BOM load again instead of being discarded as corrupt.'
    ]
  },
  {
    version: '0.6.6',
    date: '2026-08-23',
    zh: [
      '更新弹窗和更新日志改为不透明底板，关于页文字不再透上来叠在一起。',
      '关于页只保留标志、版本、检查更新和底部链接，去掉运行时版本格和法律长文。',
      '没有本地摘要时，不再把 GitHub 安装包名和校验和整段塞进更新弹窗。'
    ],
    en: [
      'Update and changelog dialogs use an opaque surface so About text no longer shows through.',
      'About keeps the mark, version, update action, and quiet legal links; the runtime grid and warranty paragraphs are gone.',
      'GitHub installer names and checksums are no longer dumped into the update dialog when local notes are missing.'
    ]
  },
  {
    version: '0.6.5',
    date: '2026-08-23',
    zh: [
      '会话恢复改为运行中定时落盘，并在标签变化后补写，断电或强杀不再只能靠上次干净退出。',
      '记住已看到的工作目录和 AI 工具；扫不到进程时不再用错误目录或清成空工具。',
      '多个 Codex 标签不再各自敲 codex resume --last；能识别到 session id 时按 id 恢复。'
    ],
    en: [
      'Session restore now writes on a running-app interval and after tab changes, so a crash or power loss no longer depends on a clean quit.',
      'Last-seen working directories and AI tools are kept when a later process scan misses.',
      'Multiple Codex tabs no longer each run codex resume --last; a command-line session id is used when present.'
    ]
  },
  {
    version: '0.6.4',
    date: '2026-08-02',
    zh: [
      '更新弹窗优先显示本地中英更新摘要，不再整段塞入 GitHub Release 下载页说明。',
      '远端更新说明若含 HTML 会先剥成纯文本，避免标签原文出现在弹窗里。'
    ],
    en: [
      'The update dialog prefers local bilingual release bullets over the full GitHub Release download-page notes.',
      'Remote release notes that arrive as HTML are stripped to plain text so markup tags no longer appear in the dialog.'
    ]
  },
  {
    version: '0.6.3',
    date: '2026-08-01',
    zh: [
      '设置 / 关于 / 更新弹窗文案收紧（中英）：标签更短，透明度、shell、会话恢复表述更清楚。',
      '关于页一句话与产品定位对齐：轻量 Windows 终端、默认垂直标签。',
      'AI 会话续聊说明写清：仅在本地键入 continue / resume，不代跑 agent、不上传终端内容。'
    ],
    en: [
      'Settings, About, and update-dialog copy polish (Chinese and English): shorter labels and clearer opacity / shell / session-restore wording.',
      'About tagline aligned with the product pitch: lightweight Windows terminal with vertical tabs by default.',
      'AI conversation resume copy states clearly: Zinc types local continue / resume only; it does not run an agent or upload terminal content.'
    ]
  },
  {
    version: '0.6.2',
    date: '2026-07-25',
    zh: [
      '更新体验：启动静默检查 GitHub Releases；设置旁更新角标；居中更新弹窗展示日志。',
      '发现更新后自动下载；关于页仅保留检查 / 重启以更新，去掉分步下载按钮。',
      '终端 OSC 8 / CLI 超链接直接用系统浏览器打开，不再弹出危险确认框。'
    ],
    en: [
      'Update UX: quiet startup check against GitHub Releases, rail badge next to Settings, and a centered update dialog with notes.',
      'Updates download automatically when found; About keeps a single check / restart path instead of separate download and install buttons.',
      'OSC 8 / CLI hyperlinks open in the system browser immediately — no dangerous-link confirm dialog.'
    ]
  },
  {
    version: '0.6.1',
    date: '2026-07-24',
    zh: [
      '左侧标签支持拖拽重排：自由水平/垂直跟手、空隙让位、插入指示线。',
      '落点按幽灵卡片中心判定，视觉上已在两行之间时会真正插入。',
      '标签序号始终为位置 1…n；标签文字不可选中。'
    ],
    en: [
      'Drag to reorder left-rail tabs: free X/Y follow-hand ghost, sibling gap, and insertion line.',
      'Drop targeting uses the floating card center so between-row inserts actually commit.',
      'Tab numbers stay positional 1…n; rail labels are non-selectable.'
    ]
  },
  {
    version: '0.6.0',
    date: '2026-07-24',
    zh: [
      '产品定位为轻量多 shell Windows 终端启动器：现代界面、低占用、按标签选择 shell。',
      '移除 AI 用量状态栏、自定义 Electron 安装器套娃，以及 AOD / OLED 防烧屏等残留。',
      '仅发布 NSIS 安装包；会话恢复支持 Grok；测试 shell 不再污染本机历史。'
    ],
    en: [
      'Positioned Zinc as a lightweight multi-shell Windows terminal launcher with a modern UI and low overhead.',
      'Removed the AI usage status bar, the nested Electron custom installer, and AOD / OLED leftovers.',
      'NSIS-only distribution; Grok session resume; isolated test shells no longer pollute host history.'
    ]
  },
  {
    version: '0.5.0',
    date: '2026-07-11',
    zh: [
      '补齐中英文开源项目文档、贡献与行为准则、安全、隐私、支持、故障排除和第三方声明。',
      '加入可重复运行的公开仓库隐私与密钥检查、Dependabot，以及 GitHub Issue / Pull Request 模板。',
      '加入自定义安装器载荷校验、Windows 安装矩阵、GitHub Releases 更新控制与确定性校验和。',
      '将正式版精简为专注的终端功能集，并统一为 AGPL-3.0-only 授权。',
      '修复窗口与标签切换期间终端输入在左侧被裁切，以及状态栏大字号内容被裁切的问题。',
      '加强渲染器导航、终端 IPC、发布树隐私检查和安装载荷的安全边界。'
    ],
    en: [
      'Completed English and Simplified Chinese open-source documentation, contribution and conduct guides, security, privacy, support, troubleshooting, and third-party notices.',
      'Added repeatable public-tree privacy and secret checks, Dependabot, and GitHub issue and pull-request templates.',
      'Added custom-installer payload verification, a Windows installation matrix, GitHub Releases update controls, and deterministic checksums.',
      "Focused the formal release on Zinc's terminal feature set and standardized licensing as AGPL-3.0-only.",
      'Fixed terminal input clipping at the left edge during window and tab transitions, plus large status-bar font clipping.',
      'Strengthened renderer navigation, terminal IPC, release-tree privacy checks, and installer payload boundaries.'
    ]
  },
  {
    version: '0.3.7',
    date: '2026-07-07',
    zh: [
      '新增 Windows 打包与自定义安装器流程，安装包图标、快捷方式与应用 AUMID 对齐 Zinc 品牌。',
      '新增启动闪屏。',
      '终端标签页支持读取 Codex、Claude、Cursor 等工具输出的 OSC 标题；手动重命名后不再被自动标题覆盖。',
      '左侧标签右键菜单新增重命名和复制标签页，复制会沿用当前工作目录创建新会话。',
      '关于页面新增更新日志弹窗，可以滚动查看最近版本。',
      '修复 Codex 状态栏在远程 Ubuntu 会话下找不到会话数据、终端输出偶发跳到顶部、Codex 输出行错位，以及 Windows 安装后显示 Electron 原生图标的问题。'
    ],
    en: [
      'Added Windows packaging and the custom installer flow, with installer icons, shortcuts, and the app AUMID aligned to Zinc branding.',
      'Added a startup splash.',
      'Terminal tabs now read OSC titles emitted by Codex, Claude, Cursor, and similar tools; manual renames are kept.',
      'Added tab rail context actions for rename and duplicate. Duplicate opens a new session in the current working directory.',
      'Added a scrollable changelog dialog on the About page.',
      'Fixed Codex status data discovery for remote Ubuntu sessions, terminal scroll jumps, Codex line wrapping, and the Windows installed app icon.'
    ]
  },
  {
    version: '0.3.6',
    date: '2026-07-06',
    zh: [
      '修复 Alt+M/Alt+V 在 Windows 上被系统修饰键链路拦截的问题。',
      '设置页版本号改为读取 app.getVersion()，打包后不再卡在旧版本。',
      '修复退出全屏后窗口按钮重叠残影。'
    ],
    en: [
      'Fixed Alt+M and Alt+V being swallowed by the Windows system modifier path.',
      'The Settings version now reads app.getVersion() instead of a dev-only environment value.',
      'Fixed overlapping window button artifacts after leaving fullscreen.'
    ]
  },
  {
    version: '0.3.5',
    date: '2026-07-06',
    zh: [
      '新增终端复制快捷键、URL 点击打开、右键复制/粘贴，以及多标签关闭确认。',
      'Ctrl+W 归还给 shell 删词，关闭标签页改为 Ctrl+Shift+W。',
      '修复 Ctrl+V 双重粘贴、Linux kiosk 点击无响应和终端容器切换时的横向错位。'
    ],
    en: [
      'Added terminal copy shortcuts, clickable URLs, right-click copy/paste, and close confirmation for multiple tabs.',
      'Returned Ctrl+W to shell word deletion and moved close-tab to Ctrl+Shift+W.',
      'Fixed double paste, Linux kiosk click handling, and horizontal terminal misalignment during container switches.'
    ]
  }
]

export function findChangelogEntry(version: string | null | undefined): ChangelogEntry | null {
  if (!version) return null
  const normalized = version.replace(/^v/i, '')
  return CHANGELOG_ENTRIES.find((entry) => entry.version === normalized) ?? null
}
