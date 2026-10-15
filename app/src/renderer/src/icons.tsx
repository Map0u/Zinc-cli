import type { ReactNode } from 'react'

/**
 * Zinc's icon set: one 16 x 16 grid, a 2 px round-capped stroke in currentColor.
 *
 * Drawn here instead of taken from Segoe Fluent Icons: the system glyphs are
 * hairline (about 0.75 px at 12 px), and a glyph's ink is not centred in its
 * character box, so a turning glyph wobbles around its slot. These are drawn
 * on their own geometric centre and share one weight.
 */
function Icon({ size, className, children }: { size: number; className?: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

type IconProps = { size?: number; className?: string }

export const AddIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M8 2.75v10.5M2.75 8h10.5" />
  </Icon>
)

export const CloseIcon = ({ size = 12, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" />
  </Icon>
)

export const MinimizeIcon = ({ size = 12, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M3 8h10" />
  </Icon>
)

export const BackIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M13 8H3.25M7.25 4L3.25 8l4 4" />
  </Icon>
)

export const ChevronDownIcon = ({ size = 12, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
)

/** Points right; the group header turns it 90 degrees by CSS when the group is open. */
export const ChevronRightIcon = ({ size = 12, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
)

export const TerminalIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" />
    <path d="M4.75 6.25L7 8l-2.25 1.75M8.75 10h2.5" />
  </Icon>
)

export const SettingsIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M8.82 1.8l1.57.43.35 2.2.83.83 2.2.35.43 1.57-1.74 1.41-.3 1.13.8 2.08-1.16 1.16-2.08-.8-1.13.3-1.41 1.74-1.57-.43-.35-2.2-.83-.83-2.2-.35-.43-1.57 1.74-1.41.3-1.13-.8-2.08 1.16-1.16 2.08.8 1.13-.3z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
)

export const UpdateIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M8 2.5v7.5M4.75 7L8 10.25 11.25 7M3 13.25h10" />
  </Icon>
)

export const AppearanceIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 2.25a5.75 5.75 0 0 1 0 11.5z" fill="currentColor" stroke="none" />
  </Icon>
)

export const TabsIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" />
    <path d="M6 2.75v10.5" />
  </Icon>
)

export const StartupIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <path d="M2.75 8a5.25 5.25 0 1 0 1.55-3.72" />
    <path d="M2.5 2.5v2.75h2.75" />
    <path d="M8 5.25V8l1.75 1.25" />
  </Icon>
)

export const ShortcutsIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <rect x="1.25" y="3.75" width="13.5" height="8.5" rx="2.5" />
    <path d="M3.75 6.5h1M6.5 6.5h1M9.25 6.5h1M12 6.5h.25M5.5 9.5h5" />
  </Icon>
)

export const AboutIcon = ({ size = 16, className }: IconProps) => (
  <Icon size={size} className={className}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.25v3.75" />
    <circle cx="8" cy="5" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
)

/* Tab activity, 14 px in the rail's 20 px slot. */

/** Working: a faint track and a 150 degree accent arc, turned by `.tab-rail-ring` about the centre of its own box. */
export const WorkingIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size} className="tab-rail-ring">
    <circle cx="8" cy="8" r="5.5" opacity="0.18" />
    <path d="M8 2.5a5.5 5.5 0 0 1 2.75 10.263" stroke="var(--color-accent)" />
  </Icon>
)

export const WaitingIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size} className="text-accent">
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.25M8 11h.01" />
  </Icon>
)

export const DoneIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size}>
    <path d="M3.5 8.5l2.75 2.75L12.5 5" />
  </Icon>
)

export const ErrorIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size} className="text-danger">
    <circle cx="8" cy="8" r="5.75" />
    <path d="M6 6l4 4M10 6l-4 4" />
  </Icon>
)
