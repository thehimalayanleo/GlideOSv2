export async function onRequestPost(context) {
  const { request, env } = context;
  const { prompt = '' } = await request.json().catch(() => ({}));
  const anthropicKey = request.headers.get('x-anthropic-key') || env.ANTHROPIC_API_KEY;
  const openAIKey = request.headers.get('x-openai-key') || env.OPENAI_API_KEY;

  if (!anthropicKey && !openAIKey) return jsonResponse(fallbackTouchpoints());

  try {
    if (anthropicKey) return jsonResponse(await callAnthropic(prompt, anthropicKey, env));
    return jsonResponse(await callOpenAI(prompt, openAIKey, env));
  } catch (error) {
    console.error(error);
    return jsonResponse(fallbackTouchpoints());
  }
}

async function callAnthropic(prompt, key, env) {
  const anthropic = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'Return only valid JSON matching the requested schema. No markdown.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!anthropic.ok) throw new Error(`Anthropic ${anthropic.status}: ${await anthropic.text()}`);
  const data = await anthropic.json();
  const text = data.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '{}';
  return parseJsonText(text);
}

async function callOpenAI(prompt, key, env) {
  const openai = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: 'Return only valid JSON matching the requested schema. No markdown.',
        },
        { role: 'user', content: prompt },
      ],
      text: { format: { type: 'json_object' } },
    }),
  });

  if (!openai.ok) throw new Error(`OpenAI ${openai.status}: ${await openai.text()}`);
  const data = await openai.json();
  const text = data.output_text || data.output?.flatMap(item => item.content || []).find(c => c.text)?.text || '{}';
  return parseJsonText(text);
}

function parseJsonText(text) {
  const stripped = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error('Model did not return valid JSON.');
  }
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fallbackTouchpoints() {
  return {
    days: [
      {
        day_index: 0,
        touchpoints: [
          {
            time: '16:00',
            source: 'Concierge',
            text: 'Expected: arrival decompression and low-friction orientation.',
            prediction: 'Guest context suggests they will value a quiet first hour before any proactive offers.',
            action: 'Welcome briefly, confirm essentials, and leave one handwritten local card in-room.',
            trainingCtx: 'For new arrivals, reduce decisions first; make the next helpful action easy to accept.',
            placemakerRef: null,
          },
          {
            time: '19:30',
            source: 'Restaurant',
            text: 'Expected: light dinner or in-room dining preference.',
            prediction: 'Travel fatigue plus first-night uncertainty often makes a flexible dining option useful.',
            action: 'Hold a quiet table and keep in-room dining ready as the softer alternative.',
            trainingCtx: 'Prepared optionality feels personal without forcing a commitment.',
            placemakerRef: null,
          },
        ],
      },
    ],
  };
}
