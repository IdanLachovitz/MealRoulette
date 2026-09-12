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
  extra_ingredients?: string[]
}

/**
 * Without a nudge, the model defaults to the same "sauté everything
 * together" shape every time, regardless of temperature — so a chicken +
 * pepper + onion fridge always comes back as a stir-fry. Picking a random,
 * named dish format per request (and telling the model to build a real
 * version of *that*) is what actually produces the variety users expect
 * from "give me a new idea" — fried chicken one time, schnitzel or pasta
 * with chicken the next — while the entered ingredients stay the star.
 */
const DISH_STYLES = [
  'מטוגן במחבת',
  'אפוי בתנור',
  'מצופה ומטוגן בסגנון שניצל',
  'פסטה',
  'אורז או פילאף',
  'תבשיל בסיר אחד ברוטב',
  'מרק',
  'סלט חם',
  'כריך או פיתה',
]

function pickDishStyle(): string {
  return DISH_STYLES[Math.floor(Math.random() * DISH_STYLES.length)]
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

    const style = pickDishStyle()
    const prompt =
      `אלה המצרכים העיקריים שיש לי: ${clean.join(', ')}.\n` +
      `תכיני לי מנה אמיתית ומוכרת בסגנון "${style}" שבה המצרכים האלה הם הכוכבים הראשיים — ` +
      'הם חייבים להישאר בולטים במנה, לא להיעלם ולא להתחלף. ' +
      'זו לא בקשה לערבב רק את מה שכתוב — זו דרישה מפורשת: ' +
      'את *חייבת* להוסיף בפועל לפחות 2-3 מצרכים נוספים שלא ברשימה המקורית, ' +
      'כאלה שהופכים את זה למנה שלמה ואמיתית ולא סתם את המצרכים המקוריים ביחד. ' +
      'לדוגמה: פחמימה (פסטה, אורז, לחם, בצק), ציפוי (קמח, ביצה, פירורי לחם), רטבים, תבלינים, שמן, ' +
      'גבינה, ירקות נוספים, עשבי תיבול, אגוזים וכדומה — תבחרי מה שמתאים לסגנון ולמנה. ' +
      'תשובה עם extra_ingredients ריק תתקבל רק אם ממש אין שום דרך הגיונית להוסיף כלום, וזה כמעט אף פעם לא המצב. ' +
      'המגבלה היחידה: אל תוסיפי חלבון מרכזי נוסף (כמו עוד סוג בשר או דג) שלא ברשימה — ' +
      'החלבון שכבר יש ברשימה (אם יש) צריך להישאר החלבון היחיד במנה. ' +
      'ענה אך ורק ב-JSON תקין בפורמט הזה, בלי טקסט נוסף: ' +
      '{"name": "שם קצר למנה", "instructions": "2-4 משפטים על איך מכינים, בעברית, שמזכירים במפורש את המצרכים שהוספת", ' +
      '"extra_ingredients": ["כל מצרך שהוספת מעבר לרשימה המקורית — חייב להכיל לפחות 2 פריטים במרבית המקרים"]}'

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        // gpt-oss is a reasoning model — 'low' was making it skip straight to
        // echoing the input ingredients back instead of actually reasoning
        // about what a complete dish needs. 'medium' + a bigger token budget
        // gives it room to think before writing the JSON reply.
        reasoning_effort: 'medium',
        temperature: 0.7,
        max_tokens: 900,
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
    const extras = (parsed.extra_ingredients ?? []).map((i) => i.trim()).filter(Boolean)
    return new Response(
      JSON.stringify({
        name: parsed.name,
        instructions: parsed.instructions,
        ingredients: [...clean, ...extras],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
