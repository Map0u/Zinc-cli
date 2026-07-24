import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { useSettings } from './SettingsContext'
import { useI18n, type LocaleKey } from '../i18n/I18nContext'
import type { AccentSource, CursorStyle, LanguagePref, ThemePreference } from '../../../shared/settingsTypes'
import { COLOR_SCHEMES, getColorScheme, resolveVariant } from '../colorSchemes'
import { useResolvedThemeMode } from '../themeMode'
import { DEFAULT_KEYBINDINGS, SHORTCUT_ACTIONS, type Keybindings, type ShortcutAction } from '../../../shared/keybindings'
import { isUnsafeAccelerator } from '../../../shared/shortcutAccelerator'
import type { UpdateState } from '../../../shared/updateProtocol'
import { acceleratorFromEvent, shortcutManager } from '../shortcuts/ShortcutManager'
import { SegoeIcon } from '../segoeFluentIcons'
import zincIcon from '../assets/zinc-icon.png'
import { loadShellProfiles, type ShellProfile } from '../shells/shellProfiles'

export type Category =
  | 'appearance'
  | 'terminal'
  | 'startup'
  | 'shortcuts'
  | 'about'

/** Settings category glyphs use Segoe Fluent Icons codepoints supplied by Windows. */
export const SETTINGS_CATEGORIES: Array<{ id: Category; labelKey: LocaleKey; icon: string }> = [
  { id: 'appearance', labelKey: 'CatAppearance', icon: SegoeIcon.Appearance },
  { id: 'terminal', labelKey: 'CatTerminal', icon: SegoeIcon.Terminal },
  { id: 'startup', labelKey: 'CatStartup', icon: SegoeIcon.Session },
  { id: 'shortcuts', labelKey: 'CatShortcuts', icon: SegoeIcon.Shortcuts },
  { id: 'about', labelKey: 'CatAbout', icon: SegoeIcon.About }
]

/** Fixed rail-item foreground for settings categories and tab labels, using the
 * light/dark-aware `--color-fg-primary` token instead of a hardcoded hex. */
const RAIL_TEXT = 'var(--color-fg-primary)'

const ABOUT_CHANGELOG_ENTRIES = [
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
      'Focused the formal release on Zinc\'s terminal feature set and standardized licensing as AGPL-3.0-only.',
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

/**
 * Settings' own category rail body — mounted in place of the tab list inside
 * App.tsx's rail column when settings is open (M9: App.tsx now owns the rail
 * column's header/footer chrome, this only supplies the middle scrollable
 * list + back button, same as before the M9 layout split).
 */
function SettingsCategoryButton({
  cat,
  selected,
  onSelect
}: {
  cat: (typeof SETTINGS_CATEGORIES)[number]
  selected: boolean
  onSelect: (category: Category) => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      data-cat={cat.id}
      onClick={() => onSelect(cat.id)}
      aria-current={selected ? 'page' : undefined}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const items = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-cat]') ?? [])
        const currentIndex = items.indexOf(event.currentTarget)
        let nextIndex = currentIndex
        if (event.key === 'Home') nextIndex = 0
        else if (event.key === 'End') nextIndex = items.length - 1
        else if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
        else nextIndex = (currentIndex - 1 + items.length) % items.length
        const nextCategory = SETTINGS_CATEGORIES[nextIndex]
        if (nextCategory) onSelect(nextCategory.id)
        items[nextIndex]?.focus()
      }}
      className={`mx-3 flex h-10 w-[calc(100%-1.5rem)] items-center rounded pl-0.5 pr-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        selected ? 'bg-row-selected' : 'hover:bg-row-hover'
      }`}
    >
      <span className="flex w-2.5 shrink-0 items-center justify-center">
        {selected && <span className="h-4 w-[3px] rounded-full bg-accent" />}
      </span>
      <span className="icon-font flex w-[22px] shrink-0 items-center justify-center text-sm" style={{ color: RAIL_TEXT }}>
        {cat.icon}
      </span>
      <span className="flex-1 truncate text-[13px]" style={{ color: RAIL_TEXT }}>
        {t(cat.labelKey)}
      </span>
    </button>
  )
}

/** Settings' category rail: appearance → terminal → startup → shortcuts → about. */
export function SettingsRailBody({
  category,
  onSelect,
  onBack
}: {
  category: Category
  onSelect: (category: Category) => void
  onBack: () => void
}) {
  const { t } = useI18n()

  return (
    <>
      <div className="chrome-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto py-1">
        {SETTINGS_CATEGORIES.map((cat) => (
          <SettingsCategoryButton key={cat.id} cat={cat} selected={category === cat.id} onSelect={onSelect} />
        ))}
      </div>

      <div className="mx-3 mt-2">
        <button
          type="button"
          aria-label={t('BackToTerminal')}
          data-testid="settings-back"
          onClick={onBack}
          className="icon-font flex h-9 w-10 items-center justify-center rounded text-sm text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {SegoeIcon.Back}
        </button>
      </div>
    </>
  )
}

/** Settings' own content body — mounted in place of the terminal tabs inside App.tsx's terminal card when settings is open. */
export function SettingsContentBody({ category }: { category: Category }) {
  const { t } = useI18n()
  return (
    <>
      {/* About's hero card already carries the "Zinc" identity/title (name + icon) —
          repeating the generic category heading above it just doubles the title. */}
      {category !== 'about' && (
        <SectionHeading>{t(SETTINGS_CATEGORIES.find((c) => c.id === category)!.labelKey)}</SectionHeading>
      )}
      <div className="flex flex-col gap-1">
        {category === 'appearance' && <AppearanceSection />}
        {category === 'terminal' && <TerminalSection />}
        {category === 'startup' && <StartupSection />}
        {category === 'shortcuts' && <ShortcutsSection />}
        {category === 'about' && <AboutSection />}
      </div>
    </>
  )
}

/** Matches `SettingsCategoryTitle` (FontSize 22, SemiBold, default/primary foreground = white, Margin 2,8,0,4). */
function SectionHeading({ children }: { children: string }) {
  return <h2 className="ml-0.5 mb-1 mt-2 text-[22px] font-semibold text-fg-primary">{children}</h2>
}

/** Lightweight in-page group label (not a nav level) for clustering related cards. */
function GroupHeading({ children }: { children: string }) {
  return <h3 className="ml-0.5 mb-0.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">{children}</h3>
}

/** Matches the `SettingCard` style (CardBackgroundFillColorDefault/CardStrokeColorDefault,
 * 1px border, CornerRadius 4, Padding 16,10) and the StackPanel's Spacing="4" between cards. */
function Card({
  title,
  desc,
  children,
  className = ''
}: {
  title: string
  desc?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded border border-card-border bg-card-bg px-4 py-2.5 ${className}`}
    >
      <div className="min-w-0">
        <div className="text-[13px] text-fg-primary">{title}</div>
        {desc && <div className="mt-0.5 text-[11px] text-text-tertiary">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Off-state is a hollow outlined pill (transparent-ish fill + visible stroke,
 * light knob), not a solid gray fill — on-state is a filled
 * accent pill with a black knob. */
function Toggle({ checked, onChange, testId }: { checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`h-6 w-11 shrink-0 rounded-full border transition-colors ${
        checked ? 'border-accent bg-accent' : 'border-toggle-off-border bg-toggle-off-bg'
      }`}
    >
      <span
        className={`block h-5 w-5 translate-x-0.5 rounded-full transition-transform ${
          checked ? 'translate-x-[22px] bg-black' : 'translate-x-0.5 bg-text-secondary'
        }`}
      />
    </button>
  )
}

/** Free-text field: commits (apply + save) on blur. */
function TextField({
  value,
  onCommit,
  testId
}: {
  value: string
  onCommit: (v: string) => void
  testId: string
}) {
  const [draft, setDraft] = useState(value)
  return (
    <input
      type="text"
      data-testid={testId}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      className="w-64 rounded-md border border-control-border bg-control-bg px-2.5 py-1.5 text-sm text-fg-primary transition-colors hover:border-control-border-hover focus:border-accent focus:bg-control-bg-focused focus:outline-none"
    />
  )
}

/**
 * Bounded numeric stepper: debounces 250ms on every keystroke (parity §1.2
 * continuous controls). Pairs the native number input with explicit +/-
 * buttons — Chromium's built-in spin arrows only appear on hover, which read
 * as "just a text box" against a number control's always-visible
 * stepper.
 */
function NumberField({
  value,
  min,
  max,
  step,
  onDebouncedChange,
  testId
}: {
  value: number
  min: number
  max: number
  step: number
  onDebouncedChange: (v: number) => void
  testId: string
}) {
  function nudge(delta: number): void {
    onDebouncedChange(Math.max(min, Math.min(max, value + delta)))
  }

  return (
    <div className="flex w-24 overflow-hidden rounded-md border border-control-border bg-control-bg transition-colors hover:border-control-border-hover focus-within:border-accent focus-within:bg-control-bg-focused">
      <input
        type="number"
        data-testid={testId}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onDebouncedChange(Math.max(min, Math.min(max, n)))
        }}
        className="w-0 flex-1 bg-transparent px-2.5 py-1.5 text-sm text-fg-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {/* The old NumberBox's up/down glyph-button chrome is control-template
          styling, not a single ThemeResource brush the dump can capture — kept
          as a reasonable neutral stepper rather than a sourced value. */}
      <div className="flex flex-col border-l border-control-border">
        <button
          type="button"
          aria-label="increment"
          tabIndex={-1}
          onClick={() => nudge(step)}
          className="flex h-3.5 w-5 items-center justify-center text-[9px] leading-none text-fg-tertiary transition-colors hover:bg-icon-hover-bg hover:text-icon-hover-fg"
        >
          ▲
        </button>
        <button
          type="button"
          aria-label="decrement"
          tabIndex={-1}
          onClick={() => nudge(-step)}
          className="flex h-3.5 w-5 items-center justify-center border-t border-control-border text-[9px] leading-none text-fg-tertiary transition-colors hover:bg-icon-hover-bg hover:text-icon-hover-fg"
        >
          ▼
        </button>
      </div>
    </div>
  )
}

/**
 * Opacity slider: keeps its own draft (0-100) so the control stays responsive
 * mid-drag. Commits (via `onDebouncedChange`) on every drag tick, not just on
 * release — RailOpacity/TerminalOpacity paint straight from React state (no
 * xterm-theme indirection), so a live commit is what makes the rail/terminal
 * card visibly track the slider while dragging.
 */
function OpacitySlider({
  value,
  onDebouncedChange,
  testId
}: {
  value: number
  onDebouncedChange: (v: number) => void
  testId: string
}) {
  const [draft, setDraft] = useState(Math.round(value * 100))
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) setDraft(Math.round(value * 100))
  }, [value, dragging])

  return (
    <input
      type="range"
      data-testid={testId}
      min={0}
      max={100}
      step={5}
      value={draft}
      onChange={(e) => {
        setDragging(true)
        const percent = Number(e.target.value)
        setDraft(percent)
        onDebouncedChange(percent / 100)
      }}
      onMouseUp={() => setDragging(false)}
      onKeyUp={() => setDragging(false)}
      onBlur={() => setDragging(false)}
      className="opacity-slider w-48"
      style={{
        background: `linear-gradient(to right, var(--color-accent) ${draft}%, var(--color-control-border) ${draft}%)`
      }}
    />
  )
}

/** Discrete UI zoom steps — continuous slider + live setZoomFactor caused jumpy layout. */
const UI_ZOOM_FACTORS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

function nearestUiZoomFactor(value: number): (typeof UI_ZOOM_FACTORS)[number] {
  let best: (typeof UI_ZOOM_FACTORS)[number] = 1
  let bestDist = Number.POSITIVE_INFINITY
  for (const factor of UI_ZOOM_FACTORS) {
    const dist = Math.abs(factor - value)
    if (dist < bestDist) {
      best = factor
      bestDist = dist
    }
  }
  return best
}

/**
 * Self-drawn dropdown replacing the native `<select>` (M9): a native select's
 * popup is OS-chrome, not CSS-stylable, so it always looked out of place next
 * to the app's other hand-styled controls (TextField/NumberField/Toggle).
 * Trigger button matches those controls' border/bg tokens; the popup list
 * reuses the settings rail's own row-hover/row-selected tokens.
 */
function Dropdown<T extends string>({
  value,
  options,
  onChange,
  testId
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  testId: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingFocusIndexRef = useRef(0)

  function closeAndReturnFocus(): void {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function openAt(index: number): void {
    pendingFocusIndexRef.current = Math.max(0, Math.min(options.length - 1, index))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAndReturnFocus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const current = options.find((o) => o.value === value)
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      const items = rootRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
      items?.[pendingFocusIndexRef.current]?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${testId}-listbox`}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            if (event.key === 'Home') openAt(0)
            else if (event.key === 'End') openAt(options.length - 1)
            else openAt(selectedIndex)
          }
        }}
        className={`flex w-40 items-center justify-between gap-2 rounded-md border bg-control-bg px-2.5 py-1.5 text-sm text-fg-primary transition-colors hover:border-control-border-hover focus:bg-control-bg-focused focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? 'border-accent' : 'border-control-border'
        }`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <span
          className={`icon-font shrink-0 text-[9px] text-fg-tertiary transition-transform duration-150 ${open ? '-rotate-180' : ''}`}
        >
          {SegoeIcon.ChevronDown}
        </span>
      </button>
      {open && (
        <div
          id={`${testId}-listbox`}
          role="listbox"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeAndReturnFocus()
              return
            }
            if (event.key === 'Tab') {
              window.setTimeout(() => setOpen(false), 0)
              return
            }
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'))
            const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
            let nextIndex: number | null = null
            if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
            else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
            else if (event.key === 'Home') nextIndex = 0
            else if (event.key === 'End') nextIndex = items.length - 1
            if (nextIndex !== null) {
              event.preventDefault()
              items[nextIndex]?.focus()
            }
          }}
          className="absolute right-0 z-20 mt-1.5 w-40 origin-top-right overflow-hidden rounded-lg border border-popup-border bg-popup-bg py-1 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.04)] animate-[dropdown-in_120ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              tabIndex={opt.value === value ? 0 : -1}
              aria-selected={opt.value === value}
              data-testid={`${testId}-option-${opt.value}`}
              onClick={() => {
                onChange(opt.value)
                closeAndReturnFocus()
              }}
              className={`mx-1 flex w-[calc(100%-0.5rem)] items-center rounded px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                opt.value === value ? 'bg-row-selected text-fg-primary' : 'text-fg-secondary hover:bg-row-hover'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const THEME_MODE_OPTIONS: Array<{ value: ThemePreference; labelKey: 'ThemeModeAuto' | 'ThemeModeLight' | 'ThemeModeDark' }> = [
  { value: 'auto', labelKey: 'ThemeModeAuto' },
  { value: 'light', labelKey: 'ThemeModeLight' },
  { value: 'dark', labelKey: 'ThemeModeDark' }
]

const ACCENT_SOURCE_OPTIONS: Array<{ value: AccentSource; labelKey: 'AccentSourceScheme' | 'AccentSourceSystem' }> = [
  { value: 'scheme', labelKey: 'AccentSourceScheme' },
  { value: 'system', labelKey: 'AccentSourceSystem' }
]

const CURSOR_STYLE_OPTIONS: Array<{
  value: CursorStyle
  labelKey: 'CursorStyleBlock' | 'CursorStyleBar' | 'CursorStyleUnderline'
}> = [
  { value: 'block', labelKey: 'CursorStyleBlock' },
  { value: 'bar', labelKey: 'CursorStyleBar' },
  { value: 'underline', labelKey: 'CursorStyleUnderline' }
]

function AppearanceSection() {
  const { t } = useI18n()
  const { settings, updateImmediate, updateDebounced } = useSettings()

  if (!settings) return null

  return (
    <>
      <Card title={t('CardThemeModeTitle')} desc={t('CardThemeModeDesc')}>
        <Dropdown
          testId="setting-themeMode"
          value={settings.ThemePreference}
          options={THEME_MODE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
          onChange={(v) => updateImmediate({ ThemePreference: v })}
        />
      </Card>
      <Card title={t('CardColorSchemeTitle')} desc={t('CardColorSchemeDesc')}>
        <Dropdown
          testId="setting-colorScheme"
          value={settings.ColorScheme}
          options={COLOR_SCHEMES.map((s) => ({ value: s.id, label: t(s.labelKey) }))}
          onChange={(v) => {
            // Grok Night/Day pair tracks OS light/dark the same way Grok's
            // `theme = "auto"` does — pin ThemePreference to auto so Zinc's
            // surfaceBase + ANSI flip with the same polarity Grok uses.
            if (v === 'grok') {
              updateImmediate({ ColorScheme: v, ThemePreference: 'auto' })
            } else {
              updateImmediate({ ColorScheme: v })
            }
          }}
        />
      </Card>
      <Card title={t('CardAccentSourceTitle')} desc={t('CardAccentSourceDesc')}>
        <Dropdown
          testId="setting-accentSource"
          value={settings.AccentSource}
          options={ACCENT_SOURCE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
          onChange={(v) => updateImmediate({ AccentSource: v })}
        />
      </Card>
      <GroupHeading>{t('GroupMaterial')}</GroupHeading>
      <Card title={t('CardRailOpacityTitle')} desc={t('CardRailOpacityDesc')}>
        <OpacitySlider
          testId="setting-railOpacity"
          value={settings.RailOpacity}
          onDebouncedChange={(v) => updateDebounced({ RailOpacity: v })}
        />
      </Card>
      <Card title={t('CardTerminalOpacityTitle')} desc={t('CardTerminalOpacityDesc')}>
        <OpacitySlider
          testId="setting-terminalOpacity"
          value={settings.TerminalOpacity}
          onDebouncedChange={(v) => updateDebounced({ TerminalOpacity: v })}
        />
      </Card>
      <GroupHeading>{t('GroupScale')}</GroupHeading>
      <Card title={t('UiZoomLabel')} desc={t('UiZoomHint')}>
        <Dropdown
          testId="setting-uiZoom"
          value={String(nearestUiZoomFactor(settings.UiZoom))}
          options={UI_ZOOM_FACTORS.map((factor) => ({
            value: String(factor),
            label: `${Math.round(factor * 100)}%`
          }))}
          onChange={(v) => updateImmediate({ UiZoom: Number(v) })}
        />
      </Card>
    </>
  )
}

function TerminalSection() {
  const { t } = useI18n()
  const { settings, updateImmediate, updateDebounced } = useSettings()

  if (!settings) return null

  return (
    <>
      <Card title={t('CardFontFamilyTitle')}>
        <TextField
          testId="setting-fontFamily"
          value={settings.FontFamily}
          onCommit={(v) => updateImmediate({ FontFamily: v })}
        />
      </Card>
      <Card title={t('CardFontSizeTitle')}>
        <NumberField
          testId="setting-fontSize"
          value={settings.FontSize}
          min={8}
          max={32}
          step={1}
          onDebouncedChange={(v) => updateDebounced({ FontSize: v })}
        />
      </Card>
      <Card title={t('CardCursorStyleTitle')} desc={t('CardCursorStyleDesc')}>
        <Dropdown
          testId="setting-cursorStyle"
          value={settings.CursorStyle}
          options={CURSOR_STYLE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
          onChange={(v) => updateImmediate({ CursorStyle: v })}
        />
      </Card>
      <Card title={t('CardCursorBlinkTitle')}>
        <Toggle
          testId="setting-cursorBlink"
          checked={settings.CursorBlink}
          onChange={(v) => updateImmediate({ CursorBlink: v })}
        />
      </Card>
      <Card title={t('CardScrollbackTitle')}>
        <NumberField
          testId="setting-scrollback"
          value={settings.Scrollback}
          min={500}
          max={100000}
          step={1000}
          onDebouncedChange={(v) => updateDebounced({ Scrollback: v })}
        />
      </Card>
    </>
  )
}

function StartupSection() {
  const { t } = useI18n()
  const { settings, updateImmediate } = useSettings()
  const [shellProfiles, setShellProfiles] = useState<ShellProfile[]>([])

  useEffect(() => {
    let alive = true
    void loadShellProfiles().then((profiles) => {
      if (alive) setShellProfiles(profiles)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!settings) return null

  // `DefaultShellId` is intentionally a stable profile id, never an
  // executable path, so it remains portable across updates and machines.
  const defaultShellId = settings.DefaultShellId

  return (
    <>
      <Card title={t('CardDefaultShellTitle')} desc={t('CardDefaultShellDesc')}>
        {shellProfiles.length > 0 ? (
          <Dropdown
            testId="setting-defaultShell"
            value={shellProfiles.some((profile) => profile.id === defaultShellId) ? defaultShellId : shellProfiles[0].id}
            options={shellProfiles.map((profile) => ({ value: profile.id, label: profile.label }))}
            onChange={(DefaultShellId) => updateImmediate({ DefaultShellId })}
          />
        ) : (
          <span className="text-sm text-fg-tertiary">{t('ShellDetecting')}</span>
        )}
      </Card>
      <Card title={t('CardStartDirTitle')} desc={t('CardStartDirDesc')}>
        <TextField
          testId="setting-startingDirectory"
          value={settings.StartingDirectory}
          onCommit={(v) => updateImmediate({ StartingDirectory: v })}
        />
      </Card>
      <Card title={t('CardRestoreTitle')} desc={t('CardRestoreDesc')}>
        <Toggle
          testId="setting-restoreSessions"
          checked={settings.RestoreSessionsOnStartup}
          onChange={(v) => updateImmediate({ RestoreSessionsOnStartup: v })}
        />
      </Card>
      <Card title={t('CardResumeTitle')} desc={t('CardResumeDesc')}>
        <Toggle
          testId="setting-resumeAi"
          checked={settings.ResumeAiConversations}
          onChange={(v) => updateImmediate({ ResumeAiConversations: v })}
        />
      </Card>
    </>
  )
}

const ACTION_LABEL_KEYS: Record<ShortcutAction, LocaleKey> = {
  newTab: 'ShortcutNewTab',
  closeTab: 'ShortcutCloseTab',
  nextTab: 'ShortcutNextTab',
  prevTab: 'ShortcutPrevTab',
  gotoTab1: 'ShortcutGotoTab1',
  gotoTab2: 'ShortcutGotoTab2',
  gotoTab3: 'ShortcutGotoTab3',
  gotoTab4: 'ShortcutGotoTab4',
  gotoTab5: 'ShortcutGotoTab5',
  gotoTab6: 'ShortcutGotoTab6',
  gotoTab7: 'ShortcutGotoTab7',
  gotoTab8: 'ShortcutGotoTab8',
  gotoTab9: 'ShortcutGotoTab9',
  openSettings: 'ShortcutOpenSettings',
  cloneTab: 'ShortcutCloneTab',
  zoomIn: 'ShortcutZoomIn',
  zoomOut: 'ShortcutZoomOut',
  resetZoom: 'ShortcutResetZoom'
}

/** action currently being (re)recorded, or null when idle. */
function ShortcutsSection() {
  const { t } = useI18n()
  const { settings, updateImmediate } = useSettings()
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [conflict, setConflict] = useState<ShortcutAction | null>(null)
  // Separate from `conflict` (duplicate-binding) so the two failure states can
  // show distinct messages — a rejected-as-unsafe combo isn't "in use by
  // another action", it's disallowed outright (would swallow core terminal
  // input like Ctrl+C, or an OS combo like Alt+F4).
  const [unsafe, setUnsafe] = useState<ShortcutAction | null>(null)

  if (!settings) return null
  const bindings = settings.Keybindings

  function startRecording(action: ShortcutAction): void {
    setConflict(null)
    setUnsafe(null)
    setRecording(action)
    shortcutManager.setEnabled(false)
  }

  function stopRecording(): void {
    setRecording(null)
    setConflict(null)
    setUnsafe(null)
    shortcutManager.setEnabled(true)
  }

  function handleRecordKeyDown(action: ShortcutAction, event: ReactKeyboardEvent): void {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      stopRecording()
      return
    }
    const accelerator = acceleratorFromEvent(event.nativeEvent)
    if (accelerator === null) return // still only modifiers held — keep waiting

    if (isUnsafeAccelerator(accelerator)) {
      setConflict(null)
      setUnsafe(action)
      return
    }

    const conflictingAction = (Object.entries(bindings) as Array<[ShortcutAction, string]>).find(
      ([other, bound]) => other !== action && bound === accelerator
    )?.[0]
    if (conflictingAction) {
      setUnsafe(null)
      setConflict(action)
      return
    }

    const next: Keybindings = { ...bindings, [action]: accelerator }
    updateImmediate({ Keybindings: next })
    stopRecording()
  }

  function clearBinding(action: ShortcutAction): void {
    updateImmediate({ Keybindings: { ...bindings, [action]: '' } })
  }

  function restoreDefaults(): void {
    updateImmediate({ Keybindings: { ...DEFAULT_KEYBINDINGS } })
    stopRecording()
  }

  return (
    <>
      {SHORTCUT_ACTIONS.map((action) => {
        const accelerator = bindings[action]
        const isRecording = recording === action
        return (
          <Card key={action} title={t(ACTION_LABEL_KEYS[action])}>
            <div className="flex items-center gap-2">
              {isRecording ? (
                <input
                  autoFocus
                  data-testid={`shortcut-record-${action}`}
                  readOnly
                  value=""
                  placeholder={t('ShortcutRecordPrompt')}
                  onKeyDown={(e) => handleRecordKeyDown(action, e)}
                  onBlur={stopRecording}
                  className="w-56 rounded-md border border-accent bg-control-bg-focused px-2.5 py-1.5 text-sm text-text-secondary focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  data-testid={`shortcut-bind-${action}`}
                  onClick={() => startRecording(action)}
                  className="w-56 rounded-md border border-control-border bg-control-bg px-2.5 py-1.5 text-left text-sm text-fg-primary transition-colors hover:border-control-border-hover"
                >
                  {accelerator || t('ShortcutUnbound')}
                </button>
              )}
              <button
                type="button"
                data-testid={`shortcut-clear-${action}`}
                onClick={() => clearBinding(action)}
                className="rounded px-2 py-1 text-xs text-fg-tertiary transition-colors hover:bg-icon-hover-bg hover:text-icon-hover-fg"
              >
                {t('ShortcutClear')}
              </button>
              {conflict === action && <span className="text-xs text-red-400">{t('ShortcutConflict')}</span>}
              {unsafe === action && <span className="text-xs text-red-400">{t('ShortcutUnsafe')}</span>}
            </div>
          </Card>
        )
      })}
      <button
        type="button"
        data-testid="shortcut-restore-defaults"
        onClick={restoreDefaults}
        className="mt-2 w-fit rounded-md bg-control-bg px-3 py-1.5 text-sm text-fg-primary transition-colors hover:bg-row-hover"
      >
        {t('ShortcutRestoreDefaults')}
      </button>
    </>
  )
}

const LANGUAGE_OPTIONS: Array<{ value: LanguagePref; labelKey: 'LangAuto' | 'LangEnglish' | 'LangChinese' }> = [
  { value: 'auto', labelKey: 'LangAuto' },
  { value: 'en', labelKey: 'LangEnglish' },
  { value: 'zh', labelKey: 'LangChinese' }
]

function LanguageCard() {
  const { t } = useI18n()
  const { settings, updateImmediate } = useSettings()
  if (!settings) return null
  const current: LanguagePref = settings.Language

  return (
    <Card title={t('CardLanguageTitle')} desc={t('CardLanguageDesc')}>
      <Dropdown
        testId="setting-language"
        value={current}
        options={LANGUAGE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
        onChange={(v) => updateImmediate({ Language: v })}
      />
    </Card>
  )
}

const PROJECT_URLS = {
  source: 'https://github.com/Map0u/Zinc',
  license: 'https://github.com/Map0u/Zinc/blob/main/LICENSE',
  thirdParty: 'https://github.com/Map0u/Zinc/blob/main/THIRD_PARTY_NOTICES.md'
} as const

/** Bespoke hero layout (not `Card`, which is a label-left/control-right settings row and
 * reads wrong for an About page). Icon top-left, name top-right on the same row (the icon
 * already reads as "Z" — no separate wordmark needed), tagline+version below, and the
 * runtime versions actually available via preload's `process.versions` as a full-width
 * stat row at the bottom — no invented fields (no author/license/repo — not present in
 * package.json). */
function AboutSection() {
  const { t, language } = useI18n()
  const [isChangelogOpen, setIsChangelogOpen] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const changelogDialogRef = useRef<HTMLDivElement>(null)
  const changelogCloseRef = useRef<HTMLButtonElement>(null)
  const changelogReturnFocusRef = useRef<HTMLElement | null>(null)
  const versions = window.zinc.versions
  const runtimeCols: Array<[string, string]> = [
    ['Electron', versions.electron],
    ['Chromium', versions.chrome],
    ['Node.js', versions.node],
    ['V8', versions.v8]
  ]
  useEffect(() => {
    let mounted = true
    window.zinc.update.getState().then((state) => {
      if (mounted) setUpdateState(state)
    })
    const unsubscribe = window.zinc.update.onState((state) => setUpdateState(state))
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isChangelogOpen) return
    changelogReturnFocusRef.current = document.activeElement as HTMLElement | null
    const frame = window.requestAnimationFrame(() => changelogCloseRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      changelogReturnFocusRef.current?.focus()
      changelogReturnFocusRef.current = null
    }
  }, [isChangelogOpen])

  function closeChangelog(): void {
    setIsChangelogOpen(false)
  }

  function handleChangelogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeChangelog()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      changelogDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    )
    if (focusable.length === 0) {
      event.preventDefault()
      changelogDialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const updateLabel = updateStatusLabel(updateState, t)
  const updateBusy = updateState?.status === 'checking' || updateState?.status === 'downloading'
  const canCheck = !updateBusy && updateState?.status !== 'disabled'
  const canDownload = updateState?.status === 'available'
  const canInstall = updateState?.status === 'downloaded'

  return (
    <>
    <LanguageCard />
    <div className="rounded-lg border border-card-border bg-card-bg px-10 py-8">
      <div className="flex items-center justify-between">
        <img src={zincIcon} alt="Zinc" className="h-14 w-14 rounded-xl shadow-lg" draggable={false} />
        <div className="text-2xl font-semibold text-fg-primary">Zinc</div>
      </div>

      <div className="mt-5 flex flex-col gap-1">
        <div className="text-[13px] text-fg-secondary">{t('CardAboutTagline')}</div>
        <div className="text-[13px] text-fg-secondary">
          {t('CardAboutVersion')} {window.zinc.version}
        </div>
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={() => setIsChangelogOpen(true)}
          aria-haspopup="dialog"
          className="rounded border border-card-border bg-control-bg px-3 py-1.5 text-[12px] text-fg-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t('AboutChangelogButton')}
        </button>
      </div>

      <div className="mt-5 rounded border border-card-border bg-control-bg px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-fg-primary">{t('AboutUpdatesTitle')}</div>
            <div className="mt-0.5 text-[11px] text-fg-tertiary">{updateLabel}</div>
          </div>
          <button
            type="button"
            disabled={!canCheck}
            onClick={() => void window.zinc.update.check()}
            className="rounded border border-card-border bg-control-bg px-3 py-1.5 text-[12px] text-fg-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-45"
          >
            {t('AboutUpdateCheck')}
          </button>
          <button
            type="button"
            disabled={!canDownload}
            onClick={() => void window.zinc.update.download()}
            className="rounded border border-card-border bg-control-bg px-3 py-1.5 text-[12px] text-fg-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-45"
          >
            {t('AboutUpdateDownload')}
          </button>
          <button
            type="button"
            disabled={!canInstall}
            onClick={() => void window.zinc.update.install()}
            className="rounded border border-card-border bg-control-bg px-3 py-1.5 text-[12px] text-fg-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-45"
          >
            {t('AboutUpdateInstall')}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-6 border-t border-card-border pt-4">
        {runtimeCols.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
            <div className="truncate text-[12px] text-fg-secondary">{value}</div>
          </div>
        ))}
      </div>

      <section className="mt-6 border-t border-card-border pt-4" aria-labelledby="about-legal-title">
        <h3 id="about-legal-title" className="text-[12px] font-semibold text-fg-primary">
          {t('AboutLegalTitle')}
        </h3>
        <p className="mt-2 text-[11px] leading-5 text-fg-secondary">Copyright © 2026 Zinc contributors</p>
        <p className="text-[11px] leading-5 text-fg-secondary">{t('AboutLicenseNotice')}</p>
        <p className="text-[11px] leading-5 text-fg-secondary">{t('AboutWarrantyNotice')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['AboutSourceLink', PROJECT_URLS.source],
              ['AboutLicenseLink', PROJECT_URLS.license],
              ['AboutThirdPartyLink', PROJECT_URLS.thirdParty]
            ] as Array<[LocaleKey, string]>
          ).map(([labelKey, url]) => (
            <button
              key={url}
              type="button"
              onClick={() => void window.zinc.shell.openExternal(url)}
              className="rounded border border-card-border bg-control-bg px-3 py-1.5 text-[11px] text-fg-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>

      {isChangelogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-6">
          <div
            ref={changelogDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-changelog-title"
            tabIndex={-1}
            onKeyDown={handleChangelogKeyDown}
            className="flex max-h-[min(720px,calc(100vh-3rem))] w-full max-w-[760px] flex-col rounded-lg border border-card-border bg-card-bg shadow-2xl focus:outline-none"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-card-border px-5">
              <h2 id="about-changelog-title" className="text-[14px] font-semibold text-fg-primary">
                {t('AboutChangelogTitle')}
              </h2>
              <button
                ref={changelogCloseRef}
                type="button"
                aria-label={t('AboutChangelogClose')}
                title={t('AboutChangelogClose')}
                onClick={closeChangelog}
                className="icon-font flex h-8 w-8 items-center justify-center rounded text-[12px] text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {SegoeIcon.Close}
              </button>
            </div>
            <div className="chrome-scroll overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-5">
                {ABOUT_CHANGELOG_ENTRIES.map((entry) => (
                  <section key={entry.version} className="border-b border-card-border pb-5 last:border-b-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-[14px] font-semibold text-fg-primary">Zinc {entry.version}</h3>
                      <div className="shrink-0 text-[11px] text-fg-tertiary">{entry.date}</div>
                    </div>
                    <ul className="mt-2 flex flex-col gap-1.5 text-[12px] leading-5 text-fg-secondary">
                      {entry[language].map((item) => (
                        <li key={item} className="pl-3 before:-ml-3 before:pr-2 before:content-['•']">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}

function updateStatusLabel(state: UpdateState | null, t: (key: LocaleKey) => string): string {
  if (!state) return t('AboutUpdateIdle')
  if (state.status === 'checking') return t('AboutUpdateChecking')
  if (state.status === 'available') {
    return `${t('AboutUpdateAvailable')} ${state.availableVersion ?? ''}`.trim()
  }
  if (state.status === 'not-available') return t('AboutUpdateNotAvailable')
  if (state.status === 'downloading') {
    const percent = state.percent === null ? 0 : Math.round(state.percent)
    return `${t('AboutUpdateDownloading')} ${percent}%`
  }
  if (state.status === 'downloaded') {
    return `${t('AboutUpdateDownloaded')} ${state.downloadedVersion ?? state.availableVersion ?? ''}`.trim()
  }
  if (state.status === 'disabled') return t('AboutUpdateDisabled')
  if (state.status === 'error') return state.error || t('AboutUpdateError')
  return t('AboutUpdateIdle')
}
