/**
 * Renders the app icon (a three-ring roulette wheel) straight into an RGBA buffer
 * and writes it out as PNG. Avoids pulling a rasteriser into the dependency tree
 * for three static files.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]

const BG = hex('#FDF6EC')
const SAFFRON = hex('#7A3B12')
const BEET = hex('#C62828')
const BEET_W = hex('#EEBFBF')
const PIST = hex('#1565C0')
const PIST_W = hex('#C2D7EF')
const VEG = hex('#2E8B44')
const VEG_W = hex('#C9E1CE')
const SURF = hex('#FFFDFA')

/** Ring bands as fractions of the icon's half-size, outermost first. */
const RINGS = [
  { outer: 0.92, inner: 0.7, slices: 5, colors: [BEET, BEET_W] },
  { outer: 0.66, inner: 0.47, slices: 6, colors: [PIST, PIST_W] },
  { outer: 0.44, inner: 0.27, slices: 4, colors: [VEG, VEG_W] },
]

function renderIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  // Maskable icons must survive a circular crop, so shrink the art into the safe zone.
  const radius = (size / 2) * (maskable ? 0.72 : 0.94)
  const samples = 3 // supersampling grid per axis, for smooth edges

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px0 = x + (sx + 0.5) / samples
          const py0 = y + (sy + 0.5) / samples
          const [cr, cg, cb] = colorAt(px0 - cx, py0 - cy, radius)
          r += cr
          g += cg
          b += cb
        }
      }
      const n = samples * samples
      const i = (y * size + x) * 4
      px[i] = Math.round(r / n)
      px[i + 1] = Math.round(g / n)
      px[i + 2] = Math.round(b / n)
      px[i + 3] = 255
    }
  }
  return px
}

function colorAt(dx, dy, radius) {
  const dist = Math.hypot(dx, dy) / radius
  if (dist > 1) return BG

  // Saffron rim, then the three rings, then a white hub.
  if (dist > 0.94) return SAFFRON

  let angle = Math.atan2(dy, dx) + Math.PI / 2
  if (angle < 0) angle += Math.PI * 2

  for (const ring of RINGS) {
    if (dist <= ring.outer && dist > ring.inner) {
      const index = Math.floor((angle / (Math.PI * 2)) * ring.slices)
      return ring.colors[index % 2]
    }
    // Thin gap between the rings so they read as separate bands.
    if (dist <= ring.inner && dist > ring.inner - 0.025) return BG
  }

  if (dist <= 0.25) return SURF
  return BG
}

// ---- Minimal PNG writer -----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10-12: compression, filter, interlace — all zero.

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
]

for (const t of targets) {
  const png = encodePng(renderIcon(t.size, { maskable: t.maskable }), t.size)
  writeFileSync(resolve(OUT_DIR, t.file), png)
  console.log(`${t.file}  ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} KB`)
}
