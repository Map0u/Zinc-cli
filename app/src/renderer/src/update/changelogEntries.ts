export interface ChangelogEntry {
  version: string
  date: string
  zh: string[]
  en: string[]
}

/** Local release notes used by About and the update dialog fallback. */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
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
