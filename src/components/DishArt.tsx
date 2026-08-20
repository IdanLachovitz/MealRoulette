import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { PALETTES, artRandom, artSeed, classifyDish } from '../engine/dish-art'
import type { ArtPalette, DishArtKind } from '../engine/dish-art'

/**
 * A drawn plate of food, derived from the dish's own name and ingredients.
 *
 * Not a photograph — it is generated here in the browser, so it needs no
 * network, cannot 404, and works in the installed PWA offline. Every dish gets
 * a different one, and the same dish always gets the same one.
 */
export function DishArt({
  name,
  ingredients = [],
  className,
}: {
  name: string
  ingredients?: string[]
  className?: string
}) {
  const { kind, pal, rnd } = useMemo(() => {
    const k = classifyDish(name, ingredients)
    return { kind: k, pal: PALETTES[k], rnd: artRandom(artSeed(name)) }
  }, [name, ingredients])

  // Draw the seeded values once, in a fixed order, so the picture is stable.
  const tilt = -6 + rnd() * 12
  const plateY = 172 + rnd() * 10
  const garnish = [0, 1, 2, 3].map(() => ({
    x: 60 + rnd() * 280,
    y: 60 + rnd() * 190,
    r: 2.5 + rnd() * 3.5,
    o: 0.25 + rnd() * 0.4,
  }))

  // Derived from the name hash, not a random draw: SVG ids are document-global,
  // so two dishes landing on the same id would share one gradient.
  const gid = `da-${artSeed(name).toString(36)}`

  return (
    <svg
      className={className}
      viewBox="0 0 400 300"
      role="img"
      aria-label={`איור של ${name}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={pal.bg1} />
          <stop offset="100%" stopColor={pal.bg2} />
        </linearGradient>
      </defs>

      <rect width="400" height="300" fill={`url(#${gid})`} />

      {/* Loose confetti of herbs/spices, so two dishes of the same kind still
          differ at a glance. */}
      {garnish.map((g, i) => (
        <circle key={i} cx={g.x} cy={g.y} r={g.r} fill={pal.accent} opacity={g.o} />
      ))}

      <g transform={`translate(200 ${plateY}) rotate(${tilt})`}>
        {/* The plate, seen at a slight angle. */}
        <ellipse cx="0" cy="6" rx="126" ry="82" fill="rgba(0,0,0,0.10)" />
        <ellipse cx="0" cy="0" rx="126" ry="82" fill={pal.plate} />
        <ellipse
          cx="0"
          cy="0"
          rx="104"
          ry="66"
          fill="none"
          stroke={pal.plateEdge}
          strokeWidth="2"
        />
        {MOTIFS[kind](pal)}
      </g>
    </svg>
  )
}

/**
 * The picture for a dish wherever one is shown: the real photo if the dish has
 * one, otherwise the generated art. Keeping the fallback in one place means the
 * week screen and the roulette can never disagree about what a dish looks like.
 */
export function DishPicture({
  name,
  ingredients = [],
  imageUrl,
  className,
}: {
  name: string
  ingredients?: string[]
  imageUrl?: string | null
  className?: string
}) {
  const [broken, setBroken] = useState(false)

  if (imageUrl && !broken) {
    return (
      <img className={className} src={imageUrl} alt={name} onError={() => setBroken(true)} />
    )
  }
  return <DishArt className={className} name={name} ingredients={ingredients} />
}

/* Each motif draws only the food, centred on (0,0) of the plate. */
const MOTIFS: Record<DishArtKind, (p: ArtPalette) => ReactNode> = {
  soup: (p) => (
    <>
      <ellipse cx="0" cy="0" rx="86" ry="54" fill={p.food1} />
      <ellipse cx="0" cy="-4" rx="70" ry="42" fill={p.food2} opacity="0.55" />
      <circle cx="-30" cy="-6" r="7" fill={p.accent} opacity="0.8" />
      <circle cx="14" cy="10" r="6" fill={p.accent} opacity="0.7" />
      <circle cx="38" cy="-12" r="5" fill={p.plate} opacity="0.7" />
      {[-34, 0, 34].map((x, i) => (
        <path
          key={i}
          d={`M ${x} -44 q 10 -16 0 -30 q -10 -14 0 -26`}
          fill="none"
          stroke={p.plate}
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.55"
        />
      ))}
    </>
  ),

  pasta: (p) => (
    <>
      <ellipse cx="0" cy="4" rx="84" ry="50" fill={p.food1} />
      {[-52, -26, 0, 26, 52].map((x, i) => (
        <path
          key={i}
          d={`M ${x} -34 q 18 20 0 40 q -18 20 0 34`}
          fill="none"
          stroke={p.plate}
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.45"
        />
      ))}
      <ellipse cx="6" cy="0" rx="44" ry="24" fill={p.food2} opacity="0.9" />
      <circle cx="-24" cy="16" r="7" fill={p.accent} />
      <circle cx="34" cy="-14" r="6" fill={p.accent} opacity="0.85" />
    </>
  ),

  pastry: (p) => (
    <>
      <path
        d="M -74 26 q 12 -62 74 -62 q 62 0 74 62 z"
        fill={p.food1}
        stroke={p.food2}
        strokeWidth="3"
      />
      {[-40, -14, 12, 38].map((x, i) => (
        <line
          key={i}
          x1={x}
          y1="24"
          x2={x + 14}
          y2="-26"
          stroke={p.food2}
          strokeWidth="3"
          opacity="0.5"
        />
      ))}
      <ellipse cx="0" cy="26" rx="74" ry="9" fill={p.food2} opacity="0.6" />
      <circle cx="-52" cy="-8" r="5" fill={p.accent} opacity="0.7" />
    </>
  ),

  sandwich: (p) => (
    <>
      <path d="M -66 -18 q 66 -46 132 0 z" fill={p.food1} />
      <rect x="-66" y="-18" width="132" height="12" rx="6" fill={p.accent} />
      <rect x="-70" y="-8" width="140" height="16" rx="8" fill={p.food2} />
      <rect x="-66" y="6" width="132" height="12" rx="6" fill={p.accent} opacity="0.8" />
      <path d="M -66 18 q 66 34 132 0 z" fill={p.food1} />
      {[-40, -8, 24].map((x, i) => (
        <circle key={i} cx={x} cy="-24" r="3" fill={p.plate} opacity="0.8" />
      ))}
    </>
  ),

  wrap: (p) => (
    <>
      <path d="M -78 22 q 40 -58 92 -46 q 52 12 60 46 z" fill={p.food1} />
      <path d="M -50 12 q 30 -34 66 -26" fill="none" stroke={p.food2} strokeWidth="7" strokeLinecap="round" />
      <path d="M -30 22 q 30 -30 62 -22" fill="none" stroke={p.accent} strokeWidth="6" strokeLinecap="round" opacity="0.85" />
      <ellipse cx="0" cy="22" rx="78" ry="8" fill={p.food2} opacity="0.5" />
    </>
  ),

  cutlet: (p) => (
    <>
      <ellipse cx="-4" cy="4" rx="80" ry="48" fill={p.food2} />
      <ellipse cx="-4" cy="0" rx="76" ry="44" fill={p.food1} />
      {[...Array(16)].map((_, i) => (
        <circle
          key={i}
          cx={-62 + (i % 8) * 17}
          cy={-18 + Math.floor(i / 8) * 22}
          r="3.2"
          fill={p.food2}
          opacity="0.4"
        />
      ))}
      <circle cx="58" cy="24" r="16" fill={p.accent} />
      <path d="M 58 8 v 32" stroke={p.plate} strokeWidth="2" opacity="0.7" />
    </>
  ),

  fish: (p) => (
    <>
      <path d="M -70 0 q 34 -40 78 -26 q 44 14 44 26 q 0 12 -44 26 q -44 14 -78 -26 z" fill={p.food1} />
      <path d="M -70 0 q 34 -40 78 -26" fill="none" stroke={p.food2} strokeWidth="4" opacity="0.6" />
      <path d="M -68 -18 l -20 -14 l 0 62 l 22 -18" fill={p.food2} opacity="0.85" />
      {[-20, 6, 32].map((x, i) => (
        <path key={i} d={`M ${x} -20 q 8 20 0 40`} fill="none" stroke={p.plate} strokeWidth="3" opacity="0.5" />
      ))}
      <circle cx="56" cy="-30" r="13" fill={p.accent} />
    </>
  ),

  patty: (p) => (
    <>
      {[
        { x: -44, y: -14 },
        { x: 20, y: -22 },
        { x: -10, y: 20 },
        { x: 52, y: 14 },
      ].map((c, i) => (
        <g key={i}>
          <ellipse cx={c.x} cy={c.y + 4} rx="30" ry="20" fill={p.food2} />
          <ellipse cx={c.x} cy={c.y} rx="30" ry="20" fill={p.food1} />
          <ellipse cx={c.x - 8} cy={c.y - 6} rx="10" ry="5" fill={p.plate} opacity="0.25" />
        </g>
      ))}
      <circle cx="-60" cy="26" r="6" fill={p.accent} />
      <circle cx="66" cy="-24" r="5" fill={p.accent} opacity="0.8" />
    </>
  ),

  potato: (p) => (
    <>
      {[...Array(7)].map((_, i) => (
        <g key={i} transform={`translate(${-58 + i * 19} ${-6 + (i % 3) * 8}) rotate(${-24 + i * 9})`}>
          <rect x="-7" y="-34" width="14" height="66" rx="6" fill={p.food2} />
          <rect x="-7" y="-36" width="14" height="66" rx="6" fill={p.food1} />
        </g>
      ))}
      <circle cx="-64" cy="30" r="7" fill={p.accent} opacity="0.85" />
    </>
  ),

  poultry: (p) => (
    <>
      <path d="M -40 -26 q 54 -22 82 14 q 26 34 -14 50 q -46 18 -76 -14 q -24 -28 8 -50 z" fill={p.food1} />
      <path d="M -40 -26 q 40 -14 62 8" fill="none" stroke={p.food2} strokeWidth="5" opacity="0.55" />
      <rect x="-84" y="4" width="46" height="15" rx="7.5" fill={p.food2} transform="rotate(-18 -60 12)" />
      <circle cx="-88" cy="20" r="10" fill={p.plate} stroke={p.food2} strokeWidth="3" />
      <circle cx="46" cy="-34" r="6" fill={p.accent} />
      <circle cx="16" cy="34" r="5" fill={p.accent} opacity="0.8" />
    </>
  ),

  stuffed: (p) => (
    <>
      {[
        { x: -40, r: -12 },
        { x: 12, r: 6 },
        { x: 58, r: -4 },
      ].map((c, i) => (
        <g key={i} transform={`translate(${c.x} ${i === 1 ? -10 : 8}) rotate(${c.r})`}>
          <ellipse cx="0" cy="3" rx="26" ry="34" fill={p.food2} />
          <ellipse cx="0" cy="0" rx="26" ry="34" fill={p.food1} />
          <ellipse cx="0" cy="-2" rx="13" ry="18" fill={p.food2} opacity="0.6" />
        </g>
      ))}
      <circle cx="-72" cy="-20" r="6" fill={p.accent} opacity="0.85" />
    </>
  ),

  meat: (p) => (
    <>
      <path d="M -72 -6 q 8 -44 58 -40 q 54 4 76 34 q 16 24 -18 40 q -50 22 -92 6 q -30 -12 -24 -40 z" fill={p.food1} />
      <path d="M -46 -20 q 30 -14 62 -2" fill="none" stroke={p.food2} strokeWidth="6" strokeLinecap="round" opacity="0.7" />
      <path d="M -40 6 q 34 -12 70 2" fill="none" stroke={p.food2} strokeWidth="6" strokeLinecap="round" opacity="0.55" />
      <circle cx="-64" cy="26" r="7" fill={p.accent} />
      <circle cx="58" cy="-32" r="6" fill={p.accent} opacity="0.8" />
    </>
  ),

  grain: (p) => (
    <>
      <ellipse cx="0" cy="2" rx="84" ry="52" fill={p.food2} />
      <ellipse cx="0" cy="-2" rx="80" ry="48" fill={p.food1} />
      {[...Array(22)].map((_, i) => (
        <ellipse
          key={i}
          cx={-64 + ((i * 37) % 128)}
          cy={-30 + ((i * 53) % 62)}
          rx="6"
          ry="3"
          fill={p.food2}
          opacity="0.45"
          transform={`rotate(${(i * 47) % 180} ${-64 + ((i * 37) % 128)} ${-30 + ((i * 53) % 62)})`}
        />
      ))}
      <circle cx="-40" cy="20" r="7" fill={p.accent} opacity="0.9" />
      <circle cx="36" cy="-18" r="6" fill={p.accent} opacity="0.75" />
    </>
  ),

  beans: (p) => (
    <>
      <ellipse cx="0" cy="2" rx="82" ry="50" fill={p.food2} opacity="0.85" />
      {[...Array(14)].map((_, i) => (
        <ellipse
          key={i}
          cx={-58 + ((i * 41) % 118)}
          cy={-26 + ((i * 29) % 54)}
          rx="11"
          ry="7.5"
          fill={p.food1}
          transform={`rotate(${(i * 61) % 180} ${-58 + ((i * 41) % 118)} ${-26 + ((i * 29) % 54)})`}
        />
      ))}
      <circle cx="52" cy="26" r="6" fill={p.accent} />
    </>
  ),

  salad: (p) => (
    <>
      {[...Array(9)].map((_, i) => (
        <ellipse
          key={i}
          cx={-58 + ((i * 43) % 120)}
          cy={-22 + ((i * 31) % 48)}
          rx="26"
          ry="17"
          fill={i % 2 ? p.food1 : p.food2}
          opacity="0.9"
          transform={`rotate(${(i * 53) % 180} ${-58 + ((i * 43) % 120)} ${-22 + ((i * 31) % 48)})`}
        />
      ))}
      <circle cx="-26" cy="8" r="10" fill={p.accent} />
      <circle cx="36" cy="-14" r="8" fill={p.accent} opacity="0.9" />
    </>
  ),

  veg: (p) => (
    <>
      <ellipse cx="-34" cy="6" rx="30" ry="22" fill={p.food1} />
      <ellipse cx="24" cy="-12" rx="26" ry="19" fill={p.food2} />
      <ellipse cx="46" cy="20" rx="22" ry="16" fill={p.food1} opacity="0.85" />
      <circle cx="-6" cy="22" r="12" fill={p.accent} opacity="0.9" />
      <circle cx="-64" cy="-20" r="8" fill={p.accent} opacity="0.7" />
    </>
  ),
}
