export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  const voiceId = body.voiceId || env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const key = env.ELEVENLABS_API_KEY;

  if (!key) return textResponse('Missing ELEVENLABS_API_KEY in Cloudflare Variables and Secrets.', 400);
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

function textResponse(message, status) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
