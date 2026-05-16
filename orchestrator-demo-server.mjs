import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const envFile = process.env.ORCHESTRATOR_ENV_FILE || join(root, '.env');
await loadEnvFile(expandHome(envFile));
const port = Number(process.env.PORT || 4173);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function expandHome(filePath) {
  return filePath.startsWith('~/') ? join(homedir(), filePath.slice(2)) : filePath;
}

async function loadEnvFile(filePath) {
  let text = '';
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return;
  }
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsAt = trimmed.indexOf('=');
    if (equalsAt === -1) return;
    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();
    if (!key || process.env[key]) return;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
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
            action: '→ Welcome briefly, confirm essentials, and leave one handwritten local card in-room.',
            trainingCtx: 'For new arrivals, reduce decisions first; make the next helpful action easy to accept.',
            placemakerRef: null,
          },
          {
            time: '19:30',
            source: 'Restaurant',
            text: 'Expected: light dinner or in-room dining preference.',
            prediction: 'Travel fatigue plus first-night uncertainty often makes a flexible dining option useful.',
            action: '→ Hold a quiet table and keep in-room dining ready as the softer alternative.',
            trainingCtx: 'Prepared optionality feels personal without forcing a commitment.',
            placemakerRef: null,
          },
        ],
      },
      {
        day_index: 1,
        touchpoints: [
          {
            time: '10:00',
            source: 'Housekeeping',
            text: 'Expected: room preference pattern begins to show.',
            prediction: 'The first full morning reveals sleep timing, refresh preferences, and privacy threshold.',
            action: '→ Service only after a clear signal; preserve visible personal layout.',
            trainingCtx: 'Observe before optimizing. The guest teaches the room how to behave.',
            placemakerRef: null,
          },
          {
            time: '15:00',
            source: 'Concierge',
            text: 'Expected: opening for one local recommendation.',
            prediction: 'After settling, guests are more receptive to a single tailored suggestion.',
            action: '→ Offer one place-specific idea only if the guest initiates conversation.',
            trainingCtx: 'One precise suggestion beats a list because it protects the guest from work.',
            placemakerRef: null,
          },
        ],
      },
    ],
  };
}

async function callOpenAI(prompt, key) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
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

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.output_text || data.output?.flatMap(item => item.content || []).find(c => c.text)?.text || '{}';
  return JSON.parse(text.replace(/```json|```/g, ''));
}

async function callAnthropic(prompt, key) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'Return only valid JSON matching the requested schema. No markdown.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '{}';
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

async function handleGenerate(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { prompt = '' } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const anthropicKey = req.headers['x-anthropic-key'] || process.env.ANTHROPIC_API_KEY;
  const openAIKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;

  try {
    const payload = anthropicKey
      ? await callAnthropic(prompt, anthropicKey)
      : openAIKey
        ? await callOpenAI(prompt, openAIKey)
        : fallbackTouchpoints();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  } catch (error) {
    console.error(error);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(fallbackTouchpoints()));
  }
}

async function callElevenLabs(text, voiceId, key) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.78,
        style: 0.1,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function handleVoiceover(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const {
    text = '',
    voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
  } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const key = req.headers['x-elevenlabs-key'] || process.env.ELEVENLABS_API_KEY;

  if (!key) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Add an ElevenLabs key in the app Keys panel, or set ELEVENLABS_API_KEY on the server.');
    return;
  }
  if (!text.trim()) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing voiceover text.');
    return;
  }

  try {
    const audio = await callElevenLabs(text.slice(0, 1400), voiceId, key);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    });
    res.end(audio);
  } catch (error) {
    console.error(error);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
}

async function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === '/' ? '/orchestrator-v4.html' : url.pathname;
  const filePath = normalize(join(root, decodeURIComponent(rawPath)));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/generate-touchpoints') {
    handleGenerate(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/voiceover') {
    handleVoiceover(req, res);
    return;
  }
  serveFile(req, res);
}).listen(port, '127.0.0.1', () => {
  console.log(`Orchestrator demo running at http://localhost:${port}/`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set, so new-guest generation will use the built-in demo fallback.');
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('ELEVENLABS_API_KEY is not set, so voice will require a browser key from the app Keys panel.');
  }
});
