/**
 * Which picture a dish shows. Every dish can have its own `image_url` (AI
 * generated, uploaded, or the seed's bundled AI photo) and a real photo:
 * either one found online for it (Dish.real_photo, see find-dish-photo) or,
 * for the starter library, a hand-picked one bundled under
 * public/dish-photos-real/ (real-photos.json, keyed by the seed dish's
 * name). HouseholdSettings.photo_source picks between them; a dish with no
 * real photo always falls back to its own.
 */
import realPhotos from './real-photos.json'
import type { Dish, HouseholdSettings, PhotoCredit } from '../types'

export interface RealPhoto extends PhotoCredit {
  /** Path relative to the app root, e.g. "dish-photos-real/dish-01.jpg". */
  file: string
}

export const REAL_PHOTOS = realPhotos as Record<string, RealPhoto>

export function realPhotoFor(dishName: string): RealPhoto | null {
  return REAL_PHOTOS[dishName.trim()] ?? null
}

type PhotoDish = Pick<Dish, 'name' | 'image_url' | 'real_photo'>

/** The real photo a dish would show, and its credit — its own first, then the bundled one. */
export function realPhotoOf(dish: PhotoDish): { url: string; credit: PhotoCredit } | null {
  if (dish.real_photo) return { url: dish.real_photo.image_url, credit: dish.real_photo }
  const bundled = realPhotoFor(dish.name)
  return bundled ? { url: import.meta.env.BASE_URL + bundled.file, credit: bundled } : null
}

export function dishPhotoUrl(dish: PhotoDish, settings: Pick<HouseholdSettings, 'photo_source'>): string | null {
  if (settings.photo_source === 'real') {
    const real = realPhotoOf(dish)
    if (real) return real.url
  }
  return dish.image_url
}

/** "CC BY 2.0", "CC0", "Public domain" — how the license reads in a credit line. */
export function licenseLabel(photo: PhotoCredit): string {
  if (photo.license === 'pdm') return 'Public domain'
  if (photo.license === 'cc0') return 'CC0'
  return `CC ${photo.license.toUpperCase()}${photo.license_version ? ` ${photo.license_version}` : ''}`
}
