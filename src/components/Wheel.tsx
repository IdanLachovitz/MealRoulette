import type { ComponentType } from '../types'

export interface RingSpec {
  /** Which palette to paint with; also decides the ring radii. */
  type: ComponentType
  slices: { id: string; name: string }[]
  /** Index of the winning slice, or null before the first spin. */
  winnerIndex: number | null
  locked: boolean
}

const CX = 100
const CY = 100

/** Outer/inner radius and label radius per ring, matching the v1.1 mockup. */
const GEOMETRY: Record<ComponentType, { outer: number; inner: number; label: number; font: number }> =
  {
    protein: { outer: 88, inner: 66, label: 77, font: 8.6 },
    carb: { outer: 63, inner: 45, label: 54, font: 8 },
    // The inner ring is genuinely narrow — hence the FR-3.9 slice cap.
    veg: { outer: 42, inner: 26, label: 34, font: 7.4 },
  }

const FILLS: Record<ComponentType, { strong: string; soft: string }> = {
  protein: { strong: 'var(--beet)', soft: 'var(--beet-w)' },
  carb: { strong: 'var(--pist)', soft: 'var(--pist-w)' },
  veg: { strong: 'var(--veg)', soft: 'var(--veg-w)' },
}

function polar(radius: number, degrees: number): [number, number] {
  const rad = ((degrees - 90) * Math.PI) / 180
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)]
}

/** One ring segment as an SVG path. */
export function segmentPath(startDeg: number, endDeg: number, outer: number, inner: number): string {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  const [ox1, oy1] = polar(outer, startDeg)
  const [ox2, oy2] = polar(outer, endDeg)
  const [ix2, iy2] = polar(inner, endDeg)
  const [ix1, iy1] = polar(inner, startDeg)
  return [
    `M ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)}`,
    `L ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/**
 * How far to rotate a ring so that `winnerIndex` ends up under the pointer at the
 * top. `spins` adds whole turns so the movement reads as a spin, not a jump.
 */
export function rotationFor(sliceCount: number, winnerIndex: number, spins: number): number {
  if (sliceCount === 0) return 0
  const step = 360 / sliceCount
  const centre = (winnerIndex + 0.5) * step
  return spins * 360 - centre
}

function truncate(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

function Ring({
  ring,
  rotation,
  showLabels,
}: {
  ring: RingSpec
  rotation: number
  showLabels: boolean
}) {
  const geo = GEOMETRY[ring.type]
  const fills = FILLS[ring.type]
  const count = ring.slices.length
  if (count === 0) return null
  const step = 360 / count

  return (
    <g
      className="wheel__group"
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
    >
      {ring.slices.map((slice, i) => {
        const start = i * step
        const end = start + step
        const isWinner = ring.winnerIndex === i
        const [lx, ly] = polar(geo.label, start + step / 2)
        return (
          <g key={slice.id}>
            <path
              d={segmentPath(start, end, geo.outer, geo.inner)}
              fill={isWinner ? fills.strong : fills.soft}
              opacity={isWinner ? 1 : i % 2 === 0 ? 0.95 : 0.72}
              stroke="var(--surf)"
              strokeWidth="0.6"
            />
            {showLabels && count <= 8 && (
              <text
                x={lx}
                y={ly}
                fontSize={geo.font}
                fontFamily="var(--font-label)"
                fill="var(--txt)"
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${-rotation} ${lx} ${ly})`}
              >
                {truncate(slice.name, ring.type === 'veg' ? 8 : 11)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

export function Wheel({
  rings,
  rotations,
  hubLabel,
  onHubClick,
  hubDisabled,
  spinning,
  ariaLabel,
}: {
  rings: RingSpec[]
  /** One rotation per ring, in the same order. */
  rotations: number[]
  hubLabel: string
  onHubClick: () => void
  hubDisabled: boolean
  spinning: boolean
  ariaLabel: string
}) {
  // FR-2.5 — past ten slices the labels stop being readable, so the wheel goes
  // blank and the name is shown in the result line instead.
  const showLabels = rings.every((r) => r.slices.length <= 8)

  return (
    <svg viewBox="0 0 200 200" className="wheel" role="img" aria-label={ariaLabel}>
      {rings.map((ring, i) => (
        <Ring key={ring.type} ring={ring} rotation={rotations[i] ?? 0} showLabels={showLabels} />
      ))}

      <circle cx={CX} cy={CY} r={23} fill="var(--surf)" stroke="var(--line)" strokeWidth="1" />
      <text
        x={CX}
        y={CY}
        className="wheel__hub"
        fill={hubDisabled ? 'var(--mut)' : 'var(--txt)'}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ pointerEvents: 'none' }}
      >
        {hubLabel}
      </text>
      <circle
        cx={CX}
        cy={CY}
        r={23}
        fill="transparent"
        style={{ cursor: hubDisabled || spinning ? 'default' : 'pointer' }}
        onClick={() => {
          if (!hubDisabled && !spinning) onHubClick()
        }}
      />

      {/* Pointer at the top — the winning slice comes to rest under it. */}
      <g className="pointer" aria-hidden="true">
        <rect x="93.2" y="3" width="2.4" height="9" rx="1.2" />
        <rect x="98.8" y="3" width="2.4" height="9" rx="1.2" />
        <rect x="104.4" y="3" width="2.4" height="9" rx="1.2" />
        <rect x="92.8" y="11" width="14.4" height="5" rx="2" />
        <rect x="98.2" y="16" width="3.6" height="11" rx="1.8" />
      </g>
    </svg>
  )
}
