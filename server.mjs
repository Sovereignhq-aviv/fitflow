// FitFlow server. Serves the app and adds the two things a static file cannot do:
// barcode lookup (Open Food Facts) and plain-words food entry (Claude).
//
//   node server.mjs                  -> http://localhost:8744
//   ANTHROPIC_API_KEY=... node ...   -> also enables plain-words entry
//   FITFLOW_TOKEN=... node ...       -> required for /api/parse when not on localhost
//
// The app works without this server; those two features just switch themselves off.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8744;
const TOKEN = process.env.FITFLOW_TOKEN || '';
const HAS_KEY = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const anthropic = HAS_KEY ? new Anthropic() : null;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/* ------------------------------------------------------------------ helpers */
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(s);
};

function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

async function readBody(req, limit = 16_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/* ------------------------------------------------------- barcode: Open Food Facts */
// Response shape observed live: {status: 1|0, product: {product_name, brands,
// serving_quantity?, nutriments: {'energy-kcal_100g', proteins_100g, ...}}}
async function lookupBarcode(code) {
  const fields = 'code,product_name,generic_name,brands,quantity,serving_quantity,nutriments';
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`;
  const r = await fetch(url, {
    headers: { 'user-agent': 'FitFlow/1.1 (personal food log)' },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`Open Food Facts returned ${r.status}`);
  const data = await r.json();
  if (data.status !== 1 || !data.product) return { found: false, code };

  const p = data.product;
  const n = p.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n.energy_100g ? n.energy_100g / 4.184 : null);
  if (kcal == null) return { found: false, code, reason: 'no_nutrition' };

  const name = [p.product_name || p.generic_name, p.brands ? p.brands.split(',')[0].trim() : '']
    .filter(Boolean).join(' — ') || `Barcode ${code}`;

  return {
    found: true,
    code,
    name,
    kcal: Math.round(num(kcal) * 10) / 10,
    p: Math.round(num(n.proteins_100g) * 10) / 10,
    c: Math.round(num(n.carbohydrates_100g) * 10) / 10,
    f: Math.round(num(n.fat_100g) * 10) / 10,
    serving: num(p.serving_quantity) || 0,
  };
}

/* ------------------------------------------------------------- plain-words entry */
const ParsedFood = z.object({
  items: z.array(z.object({
    name: z.string().describe('Short food name as a person would recognise it, e.g. "Scrambled eggs"'),
    grams: z.number().describe('Total weight eaten, in grams. Estimate it for vague amounts.'),
    kcal: z.number().describe('Calories for that exact weight, not per 100 g'),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    assumption: z.string().describe('The portion you assumed, e.g. "2 large eggs at 55 g each". Empty string if the amount was stated exactly.'),
  })),
  meal: z.enum(['Breakfast', 'Lunch', 'Dinner', 'Snacks']),
  unclear: z.array(z.string()).describe('Anything in the text you could not turn into a food. Empty array if all of it parsed.'),
});

const PARSE_SYSTEM = `You convert a short description of what someone ate into logged food entries.

Rules:
- One entry per distinct food. Split composite descriptions ("toast with butter" is two entries: bread and butter).
- Always output a weight in grams, even when the person gave a count or a vague amount. Use realistic portions: 1 large egg 55 g, 1 slice of sandwich bread 36 g, 1 medium banana 118 g, 1 tsp butter/oil 5 g, 1 tbsp 15 g, 1 mug of coffee 240 g, 1 restaurant chicken breast 180 g.
- Calories and macros must be for the weight you output, NOT per 100 g.
- Cooked weights for cooked foods, dry weights for things measured dry (oats, uncooked rice).
- State the portion you assumed in "assumption". Leave it empty only when the person gave an exact weight.
- Put anything you cannot interpret as a food into "unclear" rather than guessing wildly.
- Pick "meal" from the text if it says so ("for breakfast", "dinner was"); otherwise use the default meal given by the user message.
- Zero-calorie items (black coffee, water, diet drinks) still get an entry with the right near-zero numbers.`;

async function parseFood(text, defaultMeal) {
  const response = await anthropic.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 4096,
    system: PARSE_SYSTEM,
    output_config: {
      effort: 'low',
      format: zodOutputFormat(ParsedFood),
    },
    messages: [{
      role: 'user',
      content: `Default meal if the text does not say: ${defaultMeal}\n\nEaten:\n${text}`,
    }],
  });

  if (response.stop_reason === 'refusal') {
    const err = new Error('The model declined to answer that.');
    err.status = 422;
    throw err;
  }
  const out = response.parsed_output;
  if (!out) {
    const err = new Error('Could not read the food out of that description.');
    err.status = 502;
    throw err;
  }
  return {
    items: out.items.map(i => ({
      name: i.name,
      g: Math.max(0, Math.round(num(i.grams) * 10) / 10),
      kcal: Math.max(0, Math.round(num(i.kcal))),
      p: Math.max(0, Math.round(num(i.protein_g) * 10) / 10),
      c: Math.max(0, Math.round(num(i.carbs_g) * 10) / 10),
      f: Math.max(0, Math.round(num(i.fat_g) * 10) / 10),
      assumption: i.assumption || '',
    })),
    meal: out.meal,
    unclear: out.unclear || [],
  };
}

/* -------------------------------------------------------------------- routing */
async function api(req, res, url) {
  const path = url.pathname;

  if (path === '/api/health') {
    return json(res, 200, {
      ok: true,
      barcode: true,
      ai: HAS_KEY,
      tokenRequired: !!TOKEN,
    });
  }

  const bc = path.match(/^\/api\/barcode\/([0-9]{6,20})$/);
  if (bc) {
    try { return json(res, 200, await lookupBarcode(bc[1])); }
    catch (e) { return json(res, 502, { error: 'Barcode lookup failed. ' + e.message }); }
  }

  if (path === '/api/parse') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    if (!anthropic) {
      return json(res, 503, { error: 'Plain-words entry needs ANTHROPIC_API_KEY set on the server.' });
    }
    // This endpoint spends money, so it is never open to the world unguarded.
    if (TOKEN) {
      if (req.headers['x-fitflow-token'] !== TOKEN) return json(res, 401, { error: 'Wrong or missing access code.' });
    } else if (!isLocal(req)) {
      return json(res, 403, { error: 'Set FITFLOW_TOKEN on the server before using this from another device.' });
    }

    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { return json(res, 400, { error: 'Bad request body.' }); }

    const text = String(body.text || '').trim().slice(0, 2000);
    if (!text) return json(res, 400, { error: 'Describe what you ate first.' });
    const meal = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].includes(body.meal) ? body.meal : 'Snacks';

    try { return json(res, 200, await parseFood(text, meal)); }
    catch (e) {
      const status = e.status || (e instanceof Anthropic.AuthenticationError ? 401
        : e instanceof Anthropic.RateLimitError ? 429
        : e instanceof Anthropic.APIError ? 502 : 500);
      const msg = e instanceof Anthropic.AuthenticationError ? 'The server’s Anthropic API key was rejected.'
        : e instanceof Anthropic.RateLimitError ? 'Rate limited — try again in a moment.'
        : e.message || 'Something went wrong reading that.';
      console.error('[parse]', e?.message || e);
      return json(res, status, { error: msg });
    }
  }

  return json(res, 404, { error: 'No such endpoint.' });
}

async function static_(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || /node_modules|\.env/.test(file)) {
    return res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const done = url.pathname.startsWith('/api/')
    ? api(req, res, url)
    : static_(req, res, url);
  done.catch(err => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Server error.' });
  });
}).listen(PORT, () => {
  console.log(`FitFlow on http://localhost:${PORT}`);
  console.log(`  barcode lookup : on`);
  console.log(`  plain words    : ${HAS_KEY ? 'on (claude-opus-5)' : 'off — set ANTHROPIC_API_KEY'}`);
  console.log(`  access code    : ${TOKEN ? 'required off-localhost' : 'not set (localhost only for /api/parse)'}`);
});
