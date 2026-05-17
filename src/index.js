export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/voiceover') {
      return handleVoiceover(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/generate-touchpoints') {
      return handleGenerateTouchpoints(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/debug-env') {
      return jsonResponse({
        build: 'voice-debug-2026-05-16',
        hasElevenLabsKey: !!String(env.ELEVENLABS_API_KEY || '').trim(),
        elevenLabsKeyLength: String(env.ELEVENLABS_API_KEY || '').trim().length,
        elevenLabsKeyPrefix: String(env.ELEVENLABS_API_KEY || '').trim().slice(0, 4),
        hasAnthropicKey: !!String(env.ANTHROPIC_API_KEY || '').trim(),
        hasVoiceId: !!String(env.ELEVENLABS_VOICE_ID || '').trim(),
        voiceId: String(env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM').trim(),
      });
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleVoiceover(request, env) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  const voiceId = String(body.voiceId || env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM').trim();
  const key = String(request.headers.get('x-elevenlabs-key') || env.ELEVENLABS_API_KEY || '').trim();

  if (!key) return textResponse('Add an ElevenLabs key in Keys, or set ELEVENLABS_API_KEY in Cloudflare Variables and Secrets.', 400);
  if (!text) return textResponse('Missing voiceover text.', 400);

  const eleven = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text.slice(0, 1400),
      model_id: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.78,
        style: 0.1,
        use_speaker_boost: true,
      },
    }),
  });

  if (!eleven.ok) return textResponse(`ElevenLabs ${eleven.status}: ${await eleven.text()}`, 502);

  return new Response(eleven.body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleGenerateTouchpoints(request, env) {
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

function textResponse(message, status) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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
