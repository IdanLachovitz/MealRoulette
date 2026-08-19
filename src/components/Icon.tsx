/**
 * A small, consistent icon set replacing emoji used as structural UI (nav,
 * settings, status badges). Stroke-based, single weight, inherits color via
 * currentColor so it works in both themes without extra props.
 *
 * Emoji stay in purely decorative spots (empty-state illustrations) where a
 * big friendly glyph is a common, low-risk pattern — this set is only for
 * icons that carry meaning a user relies on (nav, lock state, cook status).
 */
import type { SVGProps } from 'react'

export type IconName =
  | 'calendar'
  | 'wheel'
  | 'list'
  | 'cart'
  | 'gear'
  | 'lock'
  | 'lockOpen'
  | 'check'
  | 'flame'
  | 'refresh'
  | 'info'
  | 'warning'
  | 'ban'
  | 'moon'
  | 'signal-off'

const PATHS: Record<IconName, string> = {
  calendar:
    'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 7h.01M12 12h.01M15 12h.01M8.99 16h.01M12 16h.01M15 16h.01',
  wheel:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-6.5v2m0 4v2m3.5-4.5h-2m-3 0h-2',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  cart:
    'M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h7.4a2 2 0 0 0 2-1.6L21 8H6M9.5 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.5-3a8.5 8.5 0 0 0-.14-1.53l2.06-1.6-2-3.46-2.43.98a8.6 8.6 0 0 0-1.32-.77L16.3 2.7h-4l-.37 2.92a8.6 8.6 0 0 0-1.32.77l-2.43-.98-2 3.46 2.06 1.6A8.5 8.5 0 0 0 8 12c0 .52.05 1.03.14 1.53l-2.06 1.6 2 3.46 2.43-.98c.4.31.85.57 1.32.77l.37 2.92h4l.37-2.92c.47-.2.92-.46 1.32-.77l2.43.98 2-3.46-2.06-1.6c.09-.5.14-1.01.14-1.53Z',
  lock: 'M6 11V8a6 6 0 1 1 12 0v3m-13 0h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm7 5v2',
  lockOpen:
    'M6 11V8a6 6 0 0 1 10.65-3.77M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm7 5v2',
  check: 'm4 12 6 6L20 6',
  flame:
    'M12 22c4 0 7-2.5 7-6.5 0-3-2-5-3-7-.3 2-1.5 3-2.5 2 1-3-1-6-3.5-7.5.5 2.5-1 4.5-2.5 6.5C6 11 5 13 5 15.5 5 19.5 8 22 12 22Zm0-3a3 3 0 0 0 3-3c0-1.3-.7-2.2-1.4-3.1-.2 1-.9 1.5-1.6 1-.3-1.2.2-2.2-1-3.4-.1 1.4-1 2.3-1.5 3.3-.5.9-.5 1.7-.5 2.2a3 3 0 0 0 3 3Z',
  refresh:
    'M4 12a8 8 0 0 1 14.4-4.8M20 12a8 8 0 0 1-14.4 4.8M4 4v4h4M20 20v-4h-4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-8v-2m0-3.5h.01M12 16h.01',
  warning:
    'm10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 3.5h.01',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.5 5.5l13 13',
  moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z',
  'signal-off':
    'm3 3 18 18M8.5 8.5A5 5 0 0 0 7 12M12 7a5 5 0 0 1 5 5m-8.9-1.9A9 9 0 0 0 5 12m14-5a9 9 0 0 1 1.9 9.9M12 17h.01',
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
