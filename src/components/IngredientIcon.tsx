import { classifyIngredient, INGREDIENT_PALETTES, pickIngredientEmoji } from '../engine/ingredient-art'
import type { Aisle } from '../types'
import type { IngredientArtKind, IngredientPalette } from '../engine/ingredient-art'
import type { ReactNode } from 'react'

/**
 * A small pictogram for one shopping-list ingredient. Unlike DishArt (a full
 * plate scene for a finished dish), this is a single motif on a tinted
 * roundel, sized to sit inline in a list row.
 *
 * Where a real emoji reads as that specific ingredient (🧅 for onion, not a
 * generic vegetable blob), it's drawn centred over the roundel; otherwise
 * this falls back to the hand-drawn category motif so nothing regresses.
 */
export function IngredientIcon({
  name,
  aisle,
  className,
}: {
  name: string
  aisle?: Aisle
  className?: string
}) {
  const kind = classifyIngredient(name, aisle)
  const pal = INGREDIENT_PALETTES[kind]
  const emoji = pickIngredientEmoji(name, kind)

  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      role="img"
      aria-label={name}
      focusable="false"
    >
      <circle cx="16" cy="16" r="16" fill={pal.bg} />
      {emoji ? (
        <text
          x="16"
          y="17"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="17"
          fontFamily="'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Segoe UI Symbol', sans-serif"
        >
          {emoji}
        </text>
      ) : (
        MOTIFS[kind](pal)
      )}
    </svg>
  )
}

/* Each motif is centred in a 32x32 box, roughly filling a 20x20 core. */
const MOTIFS: Record<IngredientArtKind, (p: IngredientPalette) => ReactNode> = {
  poultry: (p) => (
    <path
      fill={p.fg}
      d="M17 8c3 0 5.5 2.4 5.5 5.6 0 2.2-1.2 3.7-2.7 4.7-.5.3-.6.7-.5 1.3l.6 3.6c.1.6-.4 1.1-1 1.1h-1c-.5 0-.9-.4-1-.9l-.3-2h-1.2l-.3 2c-.1.5-.5.9-1 .9h-1c-.6 0-1.1-.5-1-1.1l.6-3.6c.1-.6 0-1-.5-1.3-1.5-1-2.7-2.5-2.7-4.7C9.5 10.4 12.1 8 15.1 8Z"
    />
  ),
  fish: (p) => (
    <path
      fill={p.fg}
      d="M8 16c2.4-3.4 6.3-5.3 10-5.3 2.9 0 5.5 1.5 7 3l-2.2 2.3 2.2 2.3c-1.5 1.5-4.1 3-7 3-3.7 0-7.6-1.9-10-5.3Zm2.4-1 -3-2 .9 2 -.9 2Zm10.6-1.3a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"
    />
  ),
  meat: (p) => (
    <path
      fill={p.fg}
      d="M20.6 9.2c1.9.3 3.2 2.1 2.9 4-.2 1.6-1.6 2.8-3.1 2.7-.3 1.6-1.5 2.9-3.1 3.2l-2.6 4.6c-.3.6-1.1.8-1.7.4l-1-.6c-.6-.3-.8-1.1-.4-1.7l1.1-1.9c-1.7-.9-2.6-2.9-2.2-4.8.4-2.1 2.2-3.6 4.3-3.6 0-1.6 1-3 2.5-3.5 1.4-.5 3 0 3.9 1.2Z"
    />
  ),
  dairy: (p) => (
    <path
      fill={p.fg}
      d="M12.2 8h7.6l1 3H11.2Zm-1 4h9.6L22 24.2c.1.7-.4 1.3-1.1 1.3H11.1c-.7 0-1.2-.6-1.1-1.3Z"
    />
  ),
  egg: (p) => <ellipse cx="16" cy="17" rx="6" ry="7.5" fill={p.fg} />,
  grain: (p) => (
    <>
      <path fill={p.fg} d="M8.5 22.5c3-9 8.5-13 15-13-1 6.5-5.5 12.5-15 13Z" />
      <path
        d="M11.3 20c3-3.2 6.2-5.6 9.7-7"
        stroke={p.bg}
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
    </>
  ),
  pasta: (p) => (
    <path
      fill={p.fg}
      fillRule="evenodd"
      d="M9 12c2.8 0 2.8-3 5.6-3s2.8 3 5.6 3 2.8 3 0 3-2.8 3-5.6 3-2.8-3-5.6-3-2.8-3 0-3Zm5.6-1.2c-1.5 0-1.9 1.2-3.5 1.2s1.9 0 3.5 0 1.9 0 3.5 0-2-1.2-3.5-1.2Z"
    />
  ),
  bread: (p) => (
    <path fill={p.fg} d="M16 8c4.4 0 7 3 7 7.5 0 5-3.5 8.5-7 8.5s-7-3.5-7-8.5C9 11 11.6 8 16 8Z" />
  ),
  legume: (p) => (
    <g fill={p.fg}>
      <circle cx="12" cy="13" r="3.4" />
      <circle cx="18.5" cy="12" r="3.4" />
      <circle cx="20" cy="18.5" r="3.4" />
      <circle cx="13.5" cy="20.5" r="3.4" />
    </g>
  ),
  vegRound: (p) => <circle cx="16" cy="16.5" r="8" fill={p.fg} />,
  vegLeaf: (p) => (
    <path
      fill={p.fg}
      d="M9 23c0-8.3 4-14 14-14 0 9.3-5 14.5-14 14Z"
    />
  ),
  nuts: (p) => (
    <path
      fill={p.fg}
      d="M16 8c4 0 6.5 3.4 6.5 7.6 0 5.4-3.4 9.4-6.5 9.4s-6.5-4-6.5-9.4C9.5 11.4 12 8 16 8Z"
    />
  ),
  spice: (p) => (
    <g fill={p.fg}>
      <path d="M12.5 10h7v13.5c0 1.1-.9 2-2 2h-3c-1.1 0-2-.9-2-2Z" />
      <rect x="13.5" y="7" width="5" height="3" rx="1" />
    </g>
  ),
  sauce: (p) => (
    <path fill={p.fg} d="M14 8h4v3.3l2 3v9.7c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2v-9.7l2-3Z" />
  ),
  frozen: (p) => (
    <g stroke={p.fg} strokeWidth="1.6" strokeLinecap="round">
      <path d="M16 8v16M9 12l14 8M9 20l14-8" fill="none" />
    </g>
  ),
  other: (p) => (
    <path
      fill="none"
      stroke={p.fg}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 8v7a2 2 0 0 0 2 2v9M14 8v6M17 8v6M20 8v7a2 2 0 0 1-2 2M20 25v-8"
    />
  ),
}
