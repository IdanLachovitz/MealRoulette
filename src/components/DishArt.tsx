import { useState } from 'react'

/**
 * Plain placeholder shown for a dish with no photo yet — briefly, while an
 * AI photo is being generated for a newly added dish, or if generation
 * failed and hasn't been retried. Every dish gets a real photo now (see
 * QuickAddDish and Settings' bulk generator), so this no longer needs to be
 * a per-dish illustration — it's just a hint that a picture is coming.
 */
export function DishArt({ className }: { className?: string }) {
  return (
    <div className={`${className ?? ''} dish-shot--empty`} role="img" aria-label="אין עדיין תמונה">
      🍽️
    </div>
  )
}

/**
 * The picture for a dish wherever one is shown: the real photo if the dish has
 * one, otherwise the placeholder. Keeping the fallback in one place means the
 * week screen and the roulette can never disagree about what a dish looks like.
 */
export function DishPicture({
  name,
  imageUrl,
  className,
}: {
  name: string
  ingredients?: string[]
  imageUrl?: string | null
  className?: string
}) {
  // A URL that 404s (or a corrupt data URL) should fall back to the
  // placeholder, not a broken image.
  const [broken, setBroken] = useState(false)

  if (imageUrl && !broken) {
    return (
      <img className={className} src={imageUrl} alt={name} onError={() => setBroken(true)} />
    )
  }
  return <DishArt className={className} />
}
