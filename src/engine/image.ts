/**
 * Turns a picked/captured photo into a compressed data URL, stored directly
 * on the dish (Dish.image_url) — no upload endpoint, no network, works
 * offline. Downscaling keeps a phone-camera photo (often several MB) from
 * bloating IndexedDB and the sync outbox, which pushes this field as plain
 * JSON.
 */
export async function fileToCompressedDataUrl(
  file: File,
  maxDim = 900,
  quality = 0.82,
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('אין תמיכה בעיבוד תמונה בדפדפן הזה')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return canvas.toDataURL('image/jpeg', quality)
}
