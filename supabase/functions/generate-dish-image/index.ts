// Supabase Edge Function (Deno) — one-time picture generation for a dish
// with no photo yet. Two services chained: Groq turns the Hebrew dish name
// into a short English food-photography prompt (image models are far better
// at English prompts), then Pollinations.ai renders it. The image is
// fetched and base64-encoded here, server-side, so the client gets a ready
// data URL back, exactly like a manually uploaded photo.
//
// Deploy: supabase functions deploy generate-dish-image
// Secrets used: GROQ_API_KEY (shared with the other functions),
// POLLINATIONS_API_KEY (from https://enter.pollinations.ai/keys)
//
// Earlier version of this function fetched images from here anonymously,
// and that failed almost universally: Pollinations' anonymous tier is
// rate-limited per source, and Supabase Edge Functions share egress IPs
// across many unrelated projects — that shared anonymous pool was
// saturated well beyond anything our own traffic caused. An authenticated
// request tracks quota by *account*, not by source IP, which is what
// actually fixes that (moving the fetch to the browser was a workaround for
// the same symptom before we had a real key — no longer needed now).

import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  name: string
  ingredients?: string[]
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { name, ingredients } = (await req.json()) as RequestBody
    if (!name?.trim()) {
      return new Response(JSON.stringify({ error: 'name is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const groqApiKey = Deno.env.get('GROQ_API_KEY')
    if (!groqApiKey) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const pollinationsApiKey = Deno.env.get('POLLINATIONS_API_KEY')
    if (!pollinationsApiKey) {
      return new Response(JSON.stringify({ error: 'POLLINATIONS_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 1 — Groq translates + describes the dish as an English image prompt.
    const ingredientLine = ingredients?.length ? ` המרכיבים העיקריים: ${ingredients.slice(0, 6).join(', ')}.` : ''
    const promptRequest =
      `שם המנה: "${name}".${ingredientLine}\n` +
      'כתבי תיאור קצר באנגלית (משפט אחד) למחולל תמונות, שיתאר תמונת אוכל מקצועית ' +
      'ומתאבנת של המנה הזו — לא מתכון, רק תיאור ויזואלי. ' +
      'ענה אך ורק ב-JSON תקין: {"prompt": "..."}'

    let groqRes: Response
    try {
      groqRes = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', 10_000, {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: [{ role: 'user', content: promptRequest }],
          reasoning_effort: 'low',
          temperature: 0.6,
          max_tokens: 300,
        }),
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: 'groq request failed', detail: String(err) }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!groqRes.ok) {
      const detail = await groqRes.text()
      return new Response(JSON.stringify({ error: 'groq request failed', detail }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const groqData = await groqRes.json()
    const content = groqData.choices?.[0]?.message?.content as string | undefined
    const jsonMatch = content?.match(/\{[\s\S]*\}/)
    // A dish name with a quote or other odd character in it (e.g. תפו"א) can
    // make Groq's reply slightly malformed JSON — that must not throw here.
    let imagePrompt: string | undefined
    if (jsonMatch) {
      try {
        imagePrompt = JSON.parse(jsonMatch[0]).prompt as string | undefined
      } catch {
        imagePrompt = undefined
      }
    }
    // Fall back to the raw name if Groq's reply didn't parse — still a valid
    // (if weaker) prompt, better than failing the whole picture outright.
    const finalPrompt = imagePrompt?.trim() || `professional appetizing food photography of ${name}`

    // Step 2 — Pollinations renders it, authenticated. A seed derived from
    // the dish name keeps a re-run deterministic instead of drawing a
    // different picture each time, even though this only ever runs once.
    // Pollinations caps seed at 2147483647 (max signed 32-bit int) — masking
    // to 31 bits instead of taking the full unsigned 32-bit hash keeps every
    // possible value within that range, instead of ~half of all dish names
    // producing a seed the API rejects outright.
    let seed = 0
    for (let i = 0; i < name.length; i++) seed = ((seed * 31 + name.charCodeAt(i)) >>> 0) & 0x7fffffff
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=800&height=600&seed=${seed}&nologo=true`

    let imgRes: Response
    try {
      imgRes = await fetchWithTimeout(imageUrl, 30_000, {
        headers: { Authorization: `Bearer ${pollinationsApiKey}` },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: 'pollinations request failed', detail: String(err) }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const contentType = imgRes.headers.get('content-type') || ''
    if (!imgRes.ok || !contentType.startsWith('image/')) {
      const detail = await imgRes.text().catch(() => '')
      return new Response(
        JSON.stringify({ error: 'pollinations request failed', detail: `status ${imgRes.status}: ${detail.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    const base64 = encodeBase64(bytes)

    return new Response(
      JSON.stringify({ image_data_url: `data:${contentType};base64,${base64}`, prompt: finalPrompt }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
