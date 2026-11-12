// Memory: short facts the user asked JARVIS to remember, kept in one private file on this Mac. A few relevant ones are added
// to each request, so the model can use them (they do travel to Groq along with the request, like everything else you say).
const fs = require('fs');
const os = require('os');
const path = require('path');

const file = () => process.env.JARVIS_MEMORY_FILE || path.join(os.homedir(), 'Library/Application Support/JARVIS/memory.json');
const MAX_FACTS = 200;
const SECRET = /password|passcode|passwd|\botp\b|\bpin\b|\bcvv\b|card number|api key|secret key|token|\b\d{12,19}\b/i;

const load = () => { try { const a = JSON.parse(fs.readFileSync(file(), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
const save = (list) => {
  fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(), JSON.stringify(list, null, 1), { mode: 0o600 });
};

function add(text) {
  const t = String(text || '').trim().slice(0, 200);
  if (!t) throw new Error('There was nothing to remember.');
  if (SECRET.test(t)) throw new Error('I do not store passwords, PINs, codes, tokens or card numbers.');
  const list = load();
  if (!list.some((f) => f.text.toLowerCase() === t.toLowerCase())) save([...list, { text: t, at: new Date().toISOString() }].slice(-MAX_FACTS));
  return t;
}

// Removes facts containing the text ("all" removes everything). Returns how many went.
function remove(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) throw new Error('Say what to forget.');
  const list = load();
  const keep = q === 'all' || q === 'everything' ? [] : list.filter((f) => !f.text.toLowerCase().includes(q));
  save(keep);
  return list.length - keep.length;
}

const all = () => load().map((f) => f.text);

// Few facts: all of them. Many: the ones sharing words with this request, plus the newest, so the prompt stays small.
function forPrompt(userText) {
  const facts = all();
  if (facts.length <= 20) return facts;
  const words = new Set(String(userText).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  const score = (f) => (f.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => words.has(w)).length;
  const relevant = facts.filter((f) => score(f) > 0).sort((a, b) => score(b) - score(a)).slice(0, 10);
  return [...new Set([...relevant, ...facts.slice(-6)])];
}

const tools = (fn) => ({
  remember: {
    def: fn('remember', 'Remember a short fact about the user for later, written in the third person, e.g. "Setting is the user\'s friend". Only when the user asks you to remember something. Never passwords or card numbers.', { fact: { type: 'string' } }, ['fact']),
    run: async ({ fact }) => `Remembered: ${add(fact)}`,
  },
  forget: {
    def: fn('forget', 'Forget remembered facts that contain the given text, or everything with "all". Only when the user asks you to forget.', { about: { type: 'string' } }, ['about']),
    run: async ({ about }) => { const n = remove(about); return n ? `Forgot ${n} thing${n > 1 ? 's' : ''}.` : 'Nothing matched.'; },
  },
  list_memories: {
    def: fn('list_memories', 'List everything remembered about the user.'),
    run: async () => all().map((f) => `- ${f}`).join('\n') || 'Nothing has been remembered yet.',
  },
});

module.exports = { add, remove, all, forPrompt, tools };
