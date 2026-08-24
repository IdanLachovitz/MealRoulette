// Supabase Edge Function (Deno) — asks Groq's free model to shortlist which
// dishes would make a good, varied week from the household's own library.
// This is a *preference* signal only: the client folds the result into
// PlannerInput.preferredDishIds, and engine/planner.ts's existing
// cooldown/cycle/repeat/locked-session logic still runs unchanged and is
// what actually guarantees every day gets covered — so a bad, empty, or
// missing response here can never break the plan, only make it less curated.
//
// Deploy: supabase functions deploy pick-week-dishes
// (reuses the GROQ_API_KEY secret already set for generate-dish)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CandidateDish {
  id: string
  name: string
  prep_time_minutes: number
}

interface RequestBody {
  dishes: CandidateDish[]
  count: number
  recentNames?: string[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { dishes, count, recentNames } = (await req.json()) as RequestBody
    if (!dishes?.length || !count || count < 1) {
      return new Response(JSON.stringify({ error: 'need dishes and a positive count' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // The model only ever sees id+name+prep time and must copy ids back
    // verbatim — never asked to invent or rename anything.
    const menu = dishes.map((d) => `${d.id} :: ${d.name} (${d.prep_time_minutes} דק')`).join('\n')
    const recentLine = recentNames?.length
      ? `לאחרונה בישלנו את אלה, כדאי לגוון ולא לחזור עליהן אם יש חלופה טובה: ${recentNames.join(', ')}.`
      : ''

    const prompt =
      `הנה רשימת מנות זמינות, בפורמט "מזהה :: שם (זמן הכנה)":\n${menu}\n\n` +
      `תבחרי ${count} מנות שיחד יוצרות שבוע מגוון וטוב — לא כולן מאותו סוג בשר/פחמימה, ` +
      `מגוון סגנונות בישול. ${recentLine}\n` +
      'ענה אך ורק ב-JSON תקין, בלי טקסט נוסף, עם המזהים המדויקים מהרשימה למעלה: ' +
      '{"dish_ids": ["מזהה1", "מזהה2", "..."]}'

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        reasoning_effort: 'low',
        temperature: 0.8,
        max_tokens: 800,
      }),
    })

    if (!groqRes.ok) {
      const detail = await groqRes.text()
      return new Response(JSON.stringify({ error: 'groq request failed', detail }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const groqData = await groqRes.json()
    const content = groqData.choices?.[0]?.message?.content
    const jsonMatch = content?.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'no JSON in response', content }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const parsed = JSON.parse(jsonMatch[0]) as { dish_ids?: unknown }
    const dishIds = Array.isArray(parsed.dish_ids) ? parsed.dish_ids.filter((x) => typeof x === 'string') : []

    return new Response(JSON.stringify({ dish_ids: dishIds }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
