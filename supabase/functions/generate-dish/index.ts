// Supabase Edge Function (Deno) — proxies a single request to Groq's free
// LLM API so the client never sees the API key. Stateless: no DB access, no
// auth requirement beyond the project's anon key that supabase-js already
// attaches to every call.
//
// Deploy:
//   supabase functions deploy generate-dish
//   supabase secrets set GROQ_API_KEY=gsk_...
//
// Called from the client via:
//   const client = await getSupabase()
//   const { data, error } = await client.functions.invoke('generate-dish', {
//     body: { ingredients: ['עוף', 'ברוקולי', 'אורז'] },
//   })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  ingredients: string[]
}

interface GroqDishResponse {
  name: string
  instructions: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { ingredients } = (await req.json()) as RequestBody
    const clean = (ingredients ?? []).map((i) => i.trim()).filter(Boolean)
    if (clean.length === 0) {
      return new Response(JSON.stringify({ error: 'no ingredients' }), {
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

    const prompt =
      `אלה המצרכים היחידים שיש לי: ${clean.join(', ')}.\n` +
      'תני לי רעיון למנה פשוטה שמשתמשת רק במצרכים האלה (בלי להוסיף אף מצרך שלא ברשימה, ' +
      'חוץ ממים, מלח, פלפל ושמן שאפשר להניח שתמיד יש). ' +
      'ענה אך ורק ב-JSON תקין בפורמט הזה, בלי טקסט נוסף: ' +
      '{"name": "שם קצר למנה", "instructions": "2-4 משפטים על איך מכינים, בעברית"}'

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        // gpt-oss is a reasoning model — low effort keeps it from spending the
        // whole token budget "thinking" before it ever writes the JSON reply.
        reasoning_effort: 'low',
        temperature: 0.7,
        max_tokens: 600,
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
    if (!content) {
      return new Response(JSON.stringify({ error: 'empty response from groq' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Not using response_format: json_object here — some models wrap the
    // object in prose despite instructions, so pull out the {...} instead of
    // requiring the whole message body to be strict JSON.
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'no JSON in response', content }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const parsed = JSON.parse(jsonMatch[0]) as GroqDishResponse
    return new Response(
      JSON.stringify({ name: parsed.name, instructions: parsed.instructions, ingredients: clean }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
