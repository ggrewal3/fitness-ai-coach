import type { ReactNode, SVGProps } from 'react'

// Small inline stroke icons (24×24 grid, currentColor). Decorative by
// default: pair them with visible text, or pass aria-label + role="img".
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function createIcon(paths: ReactNode, displayName: string) {
  function Icon({ size = 20, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    )
  }

  Icon.displayName = displayName
  return Icon
}

export const UserIcon = createIcon(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
  </>,
  'UserIcon',
)

export const DumbbellIcon = createIcon(
  <path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />,
  'DumbbellIcon',
)

export const RulerIcon = createIcon(
  <>
    <path d="M3.5 16.5 16.5 3.5l4 4-13 13z" />
    <path d="M8 12l2 2M11 9l1.5 1.5M14 6l2 2" />
  </>,
  'RulerIcon',
)

export const ContrastIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" />
  </>,
  'ContrastIcon',
)

export const LinkIcon = createIcon(
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
  </>,
  'LinkIcon',
)

export const ShieldIcon = createIcon(
  <path d="M12 3.5 19 6.3v5c0 4.6-3 8-7 9.2-4-1.2-7-4.6-7-9.2v-5z" />,
  'ShieldIcon',
)

export const LockIcon = createIcon(
  <>
    <rect x="5" y="11" width="14" height="9.5" rx="2" />
    <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </>,
  'LockIcon',
)

export const CheckIcon = createIcon(<path d="M5 12.5l4.5 4.5L19 7" />, 'CheckIcon')

export const AlertIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </>,
  'AlertIcon',
)

export const InfoIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </>,
  'InfoIcon',
)

export const HeartIcon = createIcon(
  <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  'HeartIcon',
)

export const PulseIcon = createIcon(<path d="M3 12h4l2.5-6 4 12 2.5-6h5" />, 'PulseIcon')

export const PhoneIcon = createIcon(
  <>
    <rect x="7" y="3" width="10" height="18" rx="2.5" />
    <path d="M11 17.5h2" />
  </>,
  'PhoneIcon',
)

export const SunIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </>,
  'SunIcon',
)

export const MoonIcon = createIcon(
  <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z" />,
  'MoonIcon',
)

export const MonitorIcon = createIcon(
  <>
    <rect x="3" y="4" width="18" height="12.5" rx="2" />
    <path d="M8.5 20.5h7M12 16.5v4" />
  </>,
  'MonitorIcon',
)

export const FlameIcon = createIcon(
  <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.4 2.6-5.4 3.8-8.9 1.9 1.4 2.9 3.2 3 5 1-.6 1.8-1.6 2.1-2.9 1.9 1.8 3.6 4.2 3.6 6.8 0 3.5-2.6 6.1-6 6.1z" />,
  'FlameIcon',
)

export const BalanceIcon = createIcon(
  <path d="M12 4v16M7 20h10M5 7.5h14M5 7.5 2.5 13.5h5zM19 7.5l-2.5 6h5z" />,
  'BalanceIcon',
)

export const MailIcon = createIcon(
  <>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </>,
  'MailIcon',
)

export const CalendarIcon = createIcon(
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>,
  'CalendarIcon',
)

export const SignOutIcon = createIcon(
  <path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 16.5 14.5 12 10 7.5M14.5 12H4" />,
  'SignOutIcon',
)

export const SparkIcon = createIcon(
  <path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z" />,
  'SparkIcon',
)

export const CloseIcon = createIcon(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />, 'CloseIcon')

export const ChevronDownIcon = createIcon(<path d="m6.5 9.5 5.5 5.5 5.5-5.5" />, 'ChevronDownIcon')
