const { definitions, runTool } = require('./tools');

const MODEL = process.env.JARVIS_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.JARVIS_FALLBACK_MODEL || 'openai/gpt-oss-20b'; // separate rate-limit bucket on Groq's free tier
const MAX_HISTORY = 8; // every request resends history, and free tier allows only ~8000 tokens/min per model
const MAX_STEPS = 5;
const history = [];

const system = () => `You are JARVIS, a witty, dry, impeccably polite British AI butler running on the user's Mac. \
Address the user as "${process.env.JARVIS_USER_NAME || 'sir'}". Your replies are spoken aloud: keep them to one or two short sentences and give exactly one answer, never repeat yourself, \
no lists, no markdown, no emoji. Use tools to act; never claim you did something a tool did not confirm. \
For anything current (weather, news, sports, recent events) or facts you are unsure of, call news, weather or wikipedia and answer from their results; summarise in your own words. If a tool returns an error, say so briefly. Current date and time: ${new Date().toString()}.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(model, messages) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    // low reasoning effort: far fewer hidden tokens per answer, plenty for a voice assistant
    body: JSON.stringify({ model, messages, tools: definitions, temperature: 0.4, reasoning_effort: 'low', max_completion_tokens: 700 }),
    signal: AbortSignal.timeout(30000),
  });
}

// On a 429, try the other model (own quota), then wait out the suggested delay once.
async function chat(messages) {
  let res = await request(MODEL, messages);
  if (res.status === 429) res = await request(FALLBACK_MODEL, messages);
  if (res.status === 429) {
    const wait = Number((await res.text()).match(/try again in ([\d.]+)s/)?.[1]);
    if (wait && wait <= 15) { await sleep(wait * 1000 + 300); res = await request(MODEL, messages); }
  }
  if (res.status === 429) throw new Error('Groq free-tier rate limit hit. Give it about a minute, then ask again.');
  if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).choices[0].message;
}

async function ask(userText) {
  history.push({ role: 'user', content: userText });
  const messages = [{ role: 'system', content: system() }, ...history];
  let reply = '';
  for (let i = 0; i < MAX_STEPS; i++) {
    const msg = await chat(messages);
    messages.push(msg);
    if (!msg.tool_calls?.length) { reply = msg.content || ''; break; }
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* model sent bad JSON; tool will report missing args */ }
      messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(call.function.name, args) });
    }
  }
  reply = reply || 'My apologies, I could not complete that.';
  history.push({ role: 'assistant', content: reply }); // tool chatter is dropped from memory on purpose
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  return reply;
}

module.exports = { ask };
