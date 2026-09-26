// Supabase Edge Function (Deno) — expands a dish idea from generate-dish into
// a full, cookable recipe: quantities for every ingredient and numbered
// steps. Kept separate from generate-dish on purpose: most suggestions are
// glanced at and skipped, so only the one you actually want to cook pays for
// the longer answer. Same Groq proxy shape — no DB access, the key stays here.
//
// Deploy:
//   supabase functions deploy generate-recipe
//   (uses the same GROQ_API_KEY secret as generate-dish)
//
// Called from the client via:
//   const { data, error } = await client.functions.invoke('generate-recipe', {
//     body: { name, instructions, ingredients: ['עוף', 'אורז', ...], servings: 2 },
//   })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  name: string
  instructions?: string
  ingredients: string[]
  servings?: number
}

interface GroqRecipeResponse {
  prep_time_minutes?: number
  ingredients?: { name?: string; amount?: string }[]
  steps?: string[]
  tips?: string[]
}

/**
 * Recipes are full of Hebrew acronyms written with a plain double quote —
 * מ"ל, ק"ג, דק"ה — which the model leaves unescaped, breaking the JSON. A
 * quote with a Hebrew letter on both sides can never be a JSON delimiter, so
 * swap it for the proper gershayim (״), which reads the same.
 */
function fixHebrewAcronyms(text: string): string {
  return text.replace(/([א-ת])"(?=[א-ת])/g, '$1״')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as RequestBody
    const name = (body.name ?? '').trim()
    const ingredients = (body.ingredients ?? []).map((i) => i.trim()).filter(Boolean)
    const servings = Math.min(12, Math.max(1, Math.round(body.servings ?? 2)))
    if (!name || ingredients.length === 0) return json({ error: 'missing name or ingredients' }, 400)

    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) return json({ error: 'GROQ_API_KEY not configured' }, 500)

    const prompt =
      `כתבי מתכון מלא ומדויק למנה "${name}" ל-${servings} סועדים.\n` +
      (body.instructions ? `תיאור קצר של המנה: ${body.instructions.trim()}\n` : '') +
      `המצרכים של המנה: ${ingredients.join(', ')}.\n` +
      'השתמשי במצרכים האלה, ומותר להוסיף רק בסיסים שיש בכל מטבח (מלח, פלפל, שמן, מים, תבלינים נפוצים) — ' +
      'לא חלבון נוסף ולא מצרך מרכזי חדש. ' +
      'לכל מצרך תני כמות מדויקת במידות ישראליות (גרם, כוס, כף, כפית, יחידות). ' +
      'אל תשתמשי בגרשיים רגילים (") בתוך הטקסט — לקיצורים כתבי ״ או את המילה המלאה. ' +
      'השלבים צריכים להיות ברורים למי שמבשל בבית: כל שלב פעולה אחת או שתיים, ' +
      'עם זמנים, חום אש או טמפרטורת תנור, ואיך יודעים שזה מוכן. בין 4 ל-10 שלבים. ' +
      'ענה אך ורק ב-JSON תקין בפורמט הזה, בלי טקסט נוסף: ' +
      '{"prep_time_minutes": 40, ' +
      '"ingredients": [{"name": "שם המצרך", "amount": "כמות ויחידה, למשל 500 גרם"}], ' +
      '"steps": ["שלב 1 בלי המספר", "שלב 2"], ' +
      '"tips": ["טיפ קצר אחד או שניים, לא חובה"]}'

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        reasoning_effort: 'medium',
        // Lower than generate-dish: this is about getting quantities and
        // timings right, not about variety.
        temperature: 0.4,
        // Reasoning tokens count against this too, and a full recipe is a lot
        // longer than generate-dish's 2-4 sentences.
        max_tokens: 2500,
      }),
    })

    if (!groqRes.ok) {
      return json({ error: 'groq request failed', detail: await groqRes.text() }, 502)
    }

    const groqData = await groqRes.json()
    const content = groqData.choices?.[0]?.message?.content
    if (!content) return json({ error: 'empty response from groq' }, 502)

    // Same as generate-dish: pull out the {...} rather than trusting the whole
    // message to be strict JSON.
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return json({ error: 'no JSON in response', content }, 502)
    let parsed: GroqRecipeResponse
    try {
      parsed = JSON.parse(fixHebrewAcronyms(jsonMatch[0])) as GroqRecipeResponse
    } catch (err) {
      return json({ error: 'invalid JSON in response', detail: String(err), content }, 502)
    }

    const recipeIngredients = (parsed.ingredients ?? [])
      .map((i) => ({ name: (i.name ?? '').trim(), amount: (i.amount ?? '').trim() }))
      .filter((i) => i.name)
    // The model sometimes numbers its own steps despite being asked not to —
    // the client numbers them, so strip a leading "1." / "1)" / "שלב 1:".
    const steps = (parsed.steps ?? [])
      .map((s) => s.trim().replace(/^(שלב\s*)?\d+\s*[.):-]\s*/, ''))
      .filter(Boolean)
    if (recipeIngredients.length === 0 || steps.length === 0) {
      return json({ error: 'incomplete recipe', content }, 502)
    }

    return json({
      servings,
      prep_time_minutes:
        typeof parsed.prep_time_minutes === 'number' && parsed.prep_time_minutes > 0
          ? Math.round(parsed.prep_time_minutes)
          : null,
      ingredients: recipeIngredients,
      steps,
      tips: (parsed.tips ?? []).map((t) => t.trim()).filter(Boolean),
    })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
