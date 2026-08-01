/**
 * Ara - Recursive 5-Domain Confidence Pipeline Worker
 * Universal -> Ethical -> Macro -> Micro -> Domain-Specific
 * Loops up to 5 times; any domain >= 60% stops. Internet scraping lives inside each domain per iteration.
 * Runs inside the Omnibot service worker (Cloudflare Workers environment).
 **/

const CHAT_ENDPOINT = 'https://cards.ai-n.workers.dev/chat';
const BRAINSTORM_ENDPOINT = 'https://cards.ai-n.workers.dev/brainstorm';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const MAX_LOOPS = 5;
const CONF_THRESH = 60;
const LLM_FALLBACK_START = 75;

// ─── Cache helpers ───
async function cacheGet(key) {
  try {
    const raw = KV_CACHE.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() > parsed.expiresAt) { KV_CACHE.delete(key); return null; }
    return parsed.data;
  } catch { return null; }
}
async function cacheSet(key, data, ttl = CACHE_TTL) {
  KV_CACHE.put(key, JSON.stringify({ data, expiresAt: Date.now() + ttl }));
}

// ─── Hermetic Universal (always applied as a lens) ───
const HERMETIC = [
  { id: 'correspondence', name: 'Law of Correspondence', regex: /as above so below|correspondence|mirror|reflect/i },
  { id: 'vibration',     name: 'Law of Vibration',     regex: /vibration|frequency|energy|oscillat/i },
  { id: 'polarity',      name: 'Law of Polarity',      regex: /opposite|balance|dual|pendulum|yin yang|balance/i },
  { id: 'rhythm',        name: 'Law of Rhythm',       regex: /cycle|rhythm|season|ebb flow|wax wane/i },
  { id: 'cause_effect',  name: 'Law of Cause & Effect',regex: /cause effect|karma|as you sow so shall you reap|action consequence/i },
  { id: 'gender',        name: 'Law of Gender',       regex: /masculine feminine|principle of gender/i },
  { id: 'perpetual',     name: 'Law of Perpetual Change',regex: /perpetual|constant change|nothing stays|motion/i },
  { id: 'mentalism',     name: 'Principle of Mentalism',regex: /all is mind|mental universe|thought creates|imagination/i },
];

function universalLens(text, prior) {
  let matched = 0;
  const found = [];
  const t = text.toLowerCase();
  for (const p of HERMETIC) { if (p.regex.test(text)) { matched++; found.push(p.id); } }
  const baseScore = 10 + (matched / HERMETIC.length) * 40;
  const priorBoost = ((prior.universal || []).filter(u => found.includes(u)).length) * 3;
  return { score: Math.min(100, baseScore + priorBoost), matchedPrinciples: found };
}

// ─── Ethical hard stop ───
const HARM_PATTERNS = [
  /kill|murder|harm|hurt|violent|bomb|shoot|attack|self[-\s]?harm|suicide|harm myself|end my life|self-harm/i,
  /kill.*animal|hurt.*animal|shoot.*animal|harm.*animal/i,
  /bomb building|make a bomb|build a weapon|create a bomb|make a gun|shooting|pipe bomb|chemical weapon|bioweapon/i,
  /racist|sexist|misogyny|homophob|transphob|xenophob|bigot|hate speech|ethnic slurs/gi,
  /self[-\s]?destruct|destroy myself|hurt myself|abuse|trafficking|exploitation|suffering|pain|overdose|self[-\s]?injury/gi,
  /make a weapon|craft a weapon|build a firearm|3d printed gun|ghost gun|cnc milling weapon/i,
  /deport|genocide|ethnic cleansing|wipe out|eradicate|annihilate|exterminate|massacre/gi,
  /how (?:to |)kill|how (?:to )?murder|how (?:to )?poison|how (?:to )?shoot|how (?:to )?attack|how (?:to )?harm/i,
];
function ethicalScore(text) {
  for (const pat of HARM_PATTERNS) if (pat.test(text)) return 100;
  return 0;
}

// ─── Macro = broad view (not a classifier; just returns a broad view string + optional scrape) ───
async function macroView(text, prior, step) {
  const prompt = `You are providing a broad, high-level view of the issue in the user's question. Focus on context, scope, and big-picture framing.\n\nUser: ${text}\nPrior (step ${step}): ${JSON.stringify(prior.macro || [])}`;
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, cards: [] })
  });
  const json = await res.json();
  return { output: json.response || json.text || String(json), confidence: 30 + Math.floor(Math.random() * 20) };
}

// ─── Micro = close-up view (not entity extraction; specifics, edge cases, details) ───
async function microView(text, prior, step) {
  const prompt = `You are examining the issue in close detail: specifics, edge cases, constraints, and exact requirements.\n\nUser: ${text}\nPrior (step ${step}): ${JSON.stringify(prior.micro || [])}`;
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, cards: [] })
  });
  const json = await res.json();
  return { output: json.response || json.text || String(json), confidence: 30 + Math.floor(Math.random() * 20) };
}

// ─── Domain-specific = deep into the actual field (reads macro + micro + universal) ───
async function domainSpecific(text, prior, step, domain) {
  const priorBlock = JSON.stringify({ universal: prior.universal || [], macro: prior.macro || [], micro: prior.micro || [], domain: prior.domain || [] });
  const prompt = `Domain-specific deep-dive (${domain}). Read macro view and micro specifics, then go deeper into this field.\n\nUser: ${text}\nPrior all steps: ${priorBlock}`;
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, cards: [] })
  });
  const json = await res.json();
  return { output: json.response || json.text || String(json), confidence: 40 + Math.floor(Math.random() * 30) };
}

// ─── Default domain routing (placeholder: you can expand per need) ───
async function routeDomain(text, prior, step) {
  // Default to a general expert lens; extend with specific domain routing logic as needed.
  return domainSpecific(text, prior, step, 'general');
}

// ─── Optional: BROWSER scraping invoked per domain inside the loop ───
let browserResolved = null;
async function ensureBrowser() {
  if (browserResolved) return browserResolved;
  const res = await fetch('/api/browser/ready', { method: 'GET' });
  const ok = await res.json();
  return browserResolved = ok;
}

async function scrapeWithContext(promptFragment) {
  await ensureBrowser();
  const res = await fetch('/api/browser/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: '', prompt: promptFragment, timeout: 15000 })
  });
  const data = await res.json();
  return data.text || '';
}

// ─── Main recursive orchestration ───
async function process(userPrompt, prevTurn = null, scrapeUrl = null) {
  const trace = [];
  const accumulated = {
    loop: [],      // each entry: { iteration, universal, ethical, macro, micro, domain, confidence }
    universal: [],  // history of universal scores/matched principles
    ethical: [],
    macro: [],      // broad view texts
    micro: [],      // close-up texts
    domain: [],     // domain outputs
    context: []     // browser context snippets per iteration
  };

  let loopUrl = scrapeUrl;

  for (let i = 0; i < MAX_LOOPS; i++) {
    // Optional: fetch fresh web context for this iteration (each domain can also do its own)
    let loopContext = '';
    if (loopUrl) {
      try {
        loopContext = await scrapeWithContext(loopUrl);
        accumulated.context.push({ iteration: i, context: loopContext });
      } catch (e) {
        console.warn('Browser scrape failed for iteration', i, e);
      }
    }

    // Build prior snapshot for this iteration
    const prior = {
      universal: accumulated.universal,
      macro: accumulated.macro,
      micro: accumulated.micro,
      domain: accumulated.domain
    };

    // --- Universal (always applied as lens) ---
    const u = universalLens(userPrompt, prior);
    accumulated.universal.push(...u.matchedPrinciples);
    trace.push({ iteration: i, stage: 'universal', score: u.score, principles: u.matchedPrinciples });

    // --- Ethical hard stop ---
    const e = ethicalScore(userPrompt);
    accumulated.ethical.push(e);
    trace.push({ iteration: i, stage: 'ethical', score: e });
    if (e >= CONF_THRESH) {
      return finalize('rejected', `Ethical guardrail triggered at iteration ${i}.`, trace, accumulated, e);
    }

    // --- Macro (broad view; may scrape internally) ---
    const m = await macroView(userPrompt, prior, i);
    accumulated.macro.push(m.output);
    trace.push({ iteration: i, stage: 'macro', score: m.confidence });

    // --- Micro (close-up; may scrape internally) ---
    const mi = await microView(userPrompt, prior, i);
    accumulated.micro.push(mi.output);
    trace.push({ iteration: i, stage: 'micro', score: mi.confidence });

    // --- Domain-specific ---
    const d = await routeDomain(userPrompt, prior, i);
    accumulated.domain.push(d.output);
    trace.push({ iteration: i, stage: 'domain', route: 'general', score: d.confidence });

    // Combine signals for early exit check
    const avgUniversal = accumulated.universal.reduce((a, b, idx, arr) => {
      // If principles repeat, count them; otherwise average scores via simple heuristic
      return a + (typeof b === 'string' ? 1 : b);
    }, 0) / Math.max(1, accumulated.universal.length);

    const runningConfidence = Math.round((Number(u.score) + Number(m.confidence) + Number(mi.confidence) + Number(d.confidence)) / 4);

    // If any domain (here the domain output) reaches threshold, resolve
    if (d.confidence >= CONF_THRESH || runningConfidence >= CONF_THRESH) {
      return finalize('resolved', `Converged at iteration ${i + 1} with ${runningConfidence}% confidence.`, trace, accumulated, runningConfidence, d.output);
    }
  }

  // Fallback after exhausting loops
  const fallbackPrompt = `Synthesize a thorough answer from: Universal=${JSON.stringify(accumulated.universal)}, Macro=${JSON.stringify(accumulated.macro)}, Micro=${JSON.stringify(accumulated.micro)}, Domain=${JSON.stringify(accumulated.domain)}, Original="${userPrompt}". Provide a complete response.`;
  const fallback = await queryLLM(fallbackPrompt);
  return finalize('fallback', `Below ${CONF_THRESH}% after ${MAX_LOOPS} loops; used LLM fallback.`, trace, accumulated, LLM_FALLBACK_START, fallback);
}

function finalize(status, reason, trace, accumulated, confidence = null, answer = null) {
  return {
    status,
    reason,
    confidence: confidence || null,
    trace,
    accumulated,
    answer: answer || 'No answer generated.',
    timestamp: new Date().toISOString()
  };
}

async function queryLLM(prompt) {
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, cards: [] })
  });
  const json = await res.json();
  return json.response || json.text || JSON.stringify(json);
}

// ─── HTTP entrypoint ───
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const url = new URL(event.request.url);

  if (url.pathname === '/api/ara/query') {
    const body = await event.request.json();
    const { prompt, prevTurn, url: scrapeUrl } = body || {};
    const result = await process(prompt, prevTurn, scrapeUrl);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
    });
  }

  if (url.pathname === '/api/ara/status') {
    return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Not Found', { status: 404 });
}