// Supabase Edge Function (Deno) — finds a real, freely licensed photo of a
// dish: the counterpart of generate-dish-image for HouseholdSettings
// .photo_source = 'real'. Three steps:
//   1. Groq turns the Hebrew dish name into a few short English searches
//      (both photo archives are searched in English).
//   2. Wikimedia Commons and Openverse (Flickr and others) are searched,
//      keeping only CC0, public domain, CC BY and CC BY-SA — the licenses
//      that allow showing a cropped copy in the app with a credit line.
//   3. Groq picks the candidate whose title best matches the dish, or none.
// The chosen image comes back as a data URL with its credit, which the app
// stores on the dish and lists in Settings (the licenses require it).
//
// Deploy: supabase functions deploy find-dish-photo
// Secrets used: GROQ_API_KEY (shared with the other functions)

import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
// Wikimedia asks for an identifying User-Agent and throttles anonymous ones.
const UA = { 'User-Agent': 'MealRoulette/1.0 (https://github.com/IdanLachovitz/MealRoulette; dish photos)' }

interface RequestBody {
  name: string
  ingredients?: string[]
  /** Landing URLs already tried for this dish, so "another photo" finds a new one. */
  exclude?: string[]
}

interface Candidate {
  title: string
  image: string
  creator: string | null
  creator_url: string | null
  license: 'by' | 'by-sa' | 'cc0' | 'pdm'
  license_version: string | null
  license_url: string | null
  landing: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function askGroq(apiKey: string, prompt: string): Promise<Record<string, unknown> | null> {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', 20_000, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: prompt }],
      reasoning_effort: 'low',
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) return null
  const content = (await res.json()).choices?.[0]?.message?.content
  try {
    return content ? JSON.parse(content) : null
  } catch {
    return null
  }
}

const strip = (html: string | undefined) => (html ?? '').replace(/<[^>]+>/g, '').trim()

async function searchCommons(query: string): Promise<Candidate[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15' +
    `&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=960`
  const res = await fetchWithTimeout(url, 10_000, { headers: UA }).catch(() => null)
  if (!res?.ok) return []
  const pages = Object.values((await res.json()).query?.pages ?? {}) as {
    index: number
    title: string
    imageinfo?: { thumburl?: string; width: number; descriptionurl: string; extmetadata?: Record<string, { value?: string }> }[]
  }[]
  const out: Candidate[] = []
  for (const p of pages.sort((a, b) => a.index - b.index)) {
    const ii = p.imageinfo?.[0]
    if (!ii?.thumburl || ii.width < 600) continue
    const meta = ii.extmetadata ?? {}
    const lic = strip(meta.LicenseShortName?.value)
    const cc = lic.match(/^CC (BY-SA|BY) ([\d.]+)$/i)
    const license = cc ? (cc[1].toLowerCase() as 'by' | 'by-sa') : /^CC0/i.test(lic) ? 'cc0' : /^Public domain/i.test(lic) ? 'pdm' : null
    if (!license) continue
    out.push({
      title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
      image: ii.thumburl,
      creator: strip(meta.Artist?.value) || null,
      creator_url: null,
      license,
      license_version: cc?.[2] ?? null,
      license_url: meta.LicenseUrl?.value ?? null,
      landing: ii.descriptionurl,
    })
  }
  return out
}

async function searchOpenverse(query: string): Promise<Candidate[]> {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=by,by-sa,cc0,pdm&page_size=15&mature=false`
  const res = await fetchWithTimeout(url, 10_000, { headers: UA }).catch(() => null)
  if (!res?.ok) return [] // Openverse rate-limits shared IPs — Commons alone is still an answer
  const results = ((await res.json()).results ?? []) as {
    title: string; url: string; width?: number; creator?: string; creator_url?: string
    license: string; license_version?: string; license_url?: string; foreign_landing_url: string
  }[]
  return results
    .filter((r) => (!r.width || r.width >= 600) && ['by', 'by-sa', 'cc0', 'pdm'].includes(r.license))
    .map((r) => ({
      title: r.title,
      image: r.url,
      creator: r.creator ?? null,
      creator_url: r.creator_url ?? null,
      license: r.license as Candidate['license'],
      license_version: r.license_version ?? null,
      license_url: r.license_url ?? null,
      landing: r.foreign_landing_url,
    }))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { name, ingredients, exclude } = (await req.json()) as RequestBody
    if (!name?.trim()) return json({ error: 'name is required' }, 400)
    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) return json({ error: 'GROQ_API_KEY not configured' }, 500)

    // Step 1 — English searches for the dish.
    const ingredientLine = ingredients?.length ? ` מצרכים עיקריים: ${ingredients.slice(0, 6).join(', ')}.` : ''
    const plan = await askGroq(
      apiKey,
      `שם המנה: "${name}".${ingredientLine}\n` +
        'אני מחפש תמונה אמיתית של המנה הזו בארכיוני תמונות באנגלית (Wikimedia Commons, Flickr). ' +
        'כתוב 3 חיפושים קצרים באנגלית, 1-3 מילים כל אחד, מהספציפי לכללי — שם המנה המוכר באנגלית אם יש, ' +
        'ואז תיאור פשוט של מה שרואים בצלחת. ' +
        'ענה אך ורק ב-JSON: {"queries": ["...", "...", "..."], "dish_in_english": "תיאור קצר של המנה באנגלית"}',
    )
    const queries = (Array.isArray(plan?.queries) ? plan.queries : [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, 3)
    if (queries.length === 0) return json({ error: 'no search queries' }, 502)
    const described = String(plan?.dish_in_english ?? name)

    // Step 2 — search both archives, interleaving so no single query dominates.
    const skip = new Set(exclude ?? [])
    const perQuery = await Promise.all(
      queries.map(async (q) => [...(await searchCommons(q)), ...(await searchOpenverse(q))]),
    )
    const seen = new Set<string>()
    const candidates: Candidate[] = []
    for (let k = 0; perQuery.some((l) => k < l.length) && candidates.length < 30; k++) {
      for (const list of perQuery) {
        const c = list[k]
        if (!c || seen.has(c.landing) || skip.has(c.landing)) continue
        seen.add(c.landing)
        candidates.push(c)
      }
    }
    if (candidates.length === 0) return json({ error: 'no free photos found' }, 404)

    // Step 3 — pick by title; the model can't see the photos, so a title that
    // plainly names the dish is the best signal there is.
    const pick = await askGroq(
      apiKey,
      `The dish: "${name}" — ${described}.\n` +
        'Below are titles of photos from free photo archives. Pick the one most likely to show this dish, ' +
        'plated and appetizing — not a restaurant front, a menu, raw ingredients, or a different dish. ' +
        'If none fits reasonably, answer -1.\n' +
        candidates.map((c, i) => `${i}: ${c.title}`).join('\n') +
        '\nReply only with JSON: {"index": <number>}',
    )
    const index = Number(pick?.index)
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      return json({ error: 'no matching photo' }, 404)
    }
    const chosen = candidates[index]

    const imgRes = await fetchWithTimeout(chosen.image, 20_000, { headers: UA }).catch(() => null)
    const contentType = imgRes?.headers.get('content-type') ?? ''
    if (!imgRes?.ok || !contentType.startsWith('image/')) return json({ error: 'image download failed' }, 502)
    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    if (bytes.length > 8_000_000) return json({ error: 'image too large' }, 502)

    const { image: _image, ...credit } = chosen
    return json({ image_data_url: `data:${contentType};base64,${encodeBase64(bytes)}`, ...credit })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
