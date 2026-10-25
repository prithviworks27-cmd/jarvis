const { definitions, runTool } = require('./tools');

const MODEL = process.env.JARVIS_MODEL || 'llama-3.3-70b-versatile';
const MAX_HISTORY = 20;
const MAX_STEPS = 5;
const history = [];

const system = () => `You are JARVIS, a witty, dry, impeccably polite British AI butler running on the user's Mac. \
Address the user as "${process.env.JARVIS_USER_NAME || 'sir'}". Your replies are spoken aloud: keep them to one or two short sentences, \
no lists, no markdown, no emoji. Use tools to act; never claim you did something a tool did not confirm. \
If a tool returns an error, say so briefly. Current date and time: ${new Date().toString()}.`;

async function chat(messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, tools: definitions, temperature: 0.4 }),
  });
  if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
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
