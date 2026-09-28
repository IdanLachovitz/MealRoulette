import { describe, expect, it } from 'vitest'
import { dishPhotoUrl, licenseLabel, REAL_PHOTOS } from './photos'
import type { RealPhoto } from './photos'

const [seedName, seedPhoto] = Object.entries(REAL_PHOTOS)[0]

describe('dishPhotoUrl', () => {
  it("shows the dish's own photo in AI mode", () => {
    expect(dishPhotoUrl({ name: seedName, image_url: 'data:ai' }, { photo_source: 'ai' })).toBe('data:ai')
  })

  it('shows the bundled real photo in real mode', () => {
    expect(dishPhotoUrl({ name: seedName, image_url: 'data:ai' }, { photo_source: 'real' })).toBe(
      import.meta.env.BASE_URL + seedPhoto.file,
    )
  })

  it("prefers a photo found online for the dish over the bundled one", () => {
    const found = { ...seedPhoto, image_url: 'data:found' }
    expect(dishPhotoUrl({ name: seedName, image_url: 'data:ai', real_photo: found }, { photo_source: 'real' })).toBe(
      'data:found',
    )
    expect(dishPhotoUrl({ name: 'מנה שהוספתי', image_url: 'data:ai', real_photo: found }, { photo_source: 'ai' })).toBe(
      'data:ai',
    )
  })

  it("falls back to the dish's own photo when it has no real one", () => {
    expect(dishPhotoUrl({ name: 'מנה שהוספתי', image_url: 'data:mine' }, { photo_source: 'real' })).toBe('data:mine')
  })

  it('every credit points at a bundled file and names its license', () => {
    for (const photo of Object.values(REAL_PHOTOS)) {
      expect(photo.file).toMatch(/^dish-photos-real\/dish-\d\d\.jpg$/)
      expect(photo.landing).toMatch(/^https:\/\//)
      expect(['by', 'by-sa', 'cc0', 'pdm']).toContain(photo.license)
    }
  })
})

describe('licenseLabel', () => {
  const base: RealPhoto = { file: '', title: '', creator: null, creator_url: null, license: 'by', license_version: '2.0', license_url: null, landing: '' }
  it('formats each license the way a credit line reads', () => {
    expect(licenseLabel(base)).toBe('CC BY 2.0')
    expect(licenseLabel({ ...base, license: 'by-sa', license_version: '4.0' })).toBe('CC BY-SA 4.0')
    expect(licenseLabel({ ...base, license: 'cc0' })).toBe('CC0')
    expect(licenseLabel({ ...base, license: 'pdm' })).toBe('Public domain')
  })
})
