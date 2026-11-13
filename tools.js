const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { closest } = require('./fuzzy');

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 30000 }, (err, out, errout) =>
      err ? reject(new Error((errout || err.message).trim())) : resolve(out.trim())));

// Script args go through AppleScript's `argv`, never string-spliced into the script.
const osa = (script, ...args) => run('osascript', ['-e', script, ...args]);

const getJSON = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'jarvis-assistant/1.0' } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`);
  return res;
};

// WMO weather codes (Open-Meteo), grouped.
const WEATHER = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' };

const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Screenshot -> free Groq vision model -> text answer.
async function describeScreen(question) {
  const file = path.join(os.tmpdir(), `jarvis-screen-${process.pid}.jpg`);
  try {
    await run('screencapture', ['-x', '-t', 'jpg', file]);
    await run('sips', ['-Z', '1280', file]); // keeps the upload small and fast
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.JARVIS_VISION_MODEL || 'qwen/qwen3.8-27b',
        messages: [{ role: 'user', content: [
          { type: 'text', text: `${question || 'Describe the screen.'} Answer in at most three sentences.` },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') } },
        ] }],
        max_completion_tokens: 400,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`vision request failed (${res.status})`);
    return (await res.json()).choices[0].message.content;
  } finally {
    fs.unlink(file, () => {});
  }
}

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const tools = {
  open_app: {
    def: fn('open_app', 'Open a Mac application by name, e.g. "Spotify".', { name: { type: 'string' } }, ['name']),
    run: async ({ name }) => {
      // `open -a` needs the exact app name ("Google Chrome"), but people say "Chrome", and speech recognition says "Clawed" for
      // "Claude": fall back to a partial match, then to the app that sounds most like it.
      try { await run('open', ['-a', name]); return `Opened ${name}.`; } catch (e) {
        const q = name.toLowerCase().replace(/\.app$/, '');
        const dirs = ['/Applications', '/System/Applications', '/System/Applications/Utilities', '/Applications/Utilities', path.join(os.homedir(), 'Applications')];
        const apps = dirs.flatMap((d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.app')).map((f) => f.slice(0, -4)); } catch { return []; } });
        const match = apps.filter((a) => a.toLowerCase().includes(q)).sort((a, b) => a.length - b.length)[0] || closest(name, apps);
        if (!match) throw e;
        await run('open', ['-a', match]);
        return `Opened ${match}.`;
      }
    },
  },
  open_url: {
    def: fn('open_url', 'Open an http(s) URL in the default browser.', { url: { type: 'string' } }, ['url']),
    run: async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed.');
      await run('open', [url]);
      return `Opened ${url}.`;
    },
  },
  web_search: {
    def: fn('web_search', 'Only to show the user a Google results page in their browser. To answer a question yourself, use news, weather or wikipedia instead.', { query: { type: 'string' } }, ['query']),
    run: async ({ query }) => {
      await run('open', ['https://www.google.com/search?q=' + encodeURIComponent(query)]);
      return `Searched for ${query}.`;
    },
  },
  weather: {
    def: fn('weather', 'Get current weather and today/tomorrow forecast for a city. Omit city to use the user\'s default city.', { city: { type: 'string' } }),
    run: async ({ city }) => {
      const name = city || process.env.JARVIS_CITY;
      if (!name) throw new Error('No city given and JARVIS_CITY is not set in .env.');
      const geo = (await (await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)).json()).results?.[0];
      if (!geo) throw new Error(`Could not find a place called ${name}.`);
      const f = await (await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&timezone=auto&forecast_days=2` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code')).json();
      const c = f.current, d = f.daily;
      const day = (i) => `${WEATHER[d.weather_code[i]] || 'unknown'}, ${d.temperature_2m_min[i]} to ${d.temperature_2m_max[i]}°C, ${d.precipitation_probability_max[i]}% chance of rain`;
      return `${geo.name}, ${geo.country}: now ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C), ${WEATHER[c.weather_code] || 'unknown'}, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h. Today: ${day(0)}. Tomorrow: ${day(1)}.`;
    },
  },
  news: {
    def: fn('news', 'Get the latest news headlines, optionally about a topic. Use for any question about recent events, sports results, or "what is happening".',
      { topic: { type: 'string' } }),
    run: async ({ topic }) => {
      const base = topic ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&` : 'https://news.google.com/rss?';
      const xml = await (await getJSON(base + 'hl=en-IN&gl=IN&ceid=IN:en')).text();
      const items = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)].slice(0, 6);
      if (!items.length) return 'No headlines found.';
      return items.map((m) => `${decode(m[1])} (${m[2].slice(0, 16)})`).join('\n');
    },
  },
  wikipedia: {
    def: fn('wikipedia', 'Look up facts about a person, place, thing or concept on Wikipedia. Use for general knowledge you are unsure of.', { query: { type: 'string' } }, ['query']),
    run: async ({ query }) => {
      const hit = (await (await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(query)}`)).json()).query.search[0];
      if (!hit) return 'Nothing found on Wikipedia.';
      const sum = await (await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`)).json();
      return `${sum.title}: ${sum.extract}`.slice(0, 1500);
    },
  },
  look_at_screen: {
    def: fn('look_at_screen', 'Take a screenshot of the user\'s screen and answer a question about it. Use whenever they say "this", "what am I looking at", "read my screen", "help with this error", etc.',
      { question: { type: 'string', description: 'What to find out about the screen' } }, ['question']),
    run: ({ question }) => describeScreen(question),
  },
  set_volume: {
    def: fn('set_volume', 'Set system output volume, 0-100.', { level: { type: 'number' } }, ['level']),
    run: async ({ level }) => {
      const n = Math.max(0, Math.min(100, Math.round(Number(level))));
      await osa('on run argv\nset volume output volume (item 1 of argv as integer)\nend run', String(n));
      return `Volume set to ${n}.`;
    },
  },
  set_mute: {
    def: fn('set_mute', 'Mute or unmute system audio.', { muted: { type: 'boolean' } }, ['muted']),
    run: async ({ muted }) => {
      await osa(`set volume ${muted ? 'with' : 'without'} output muted`);
      return muted ? 'Muted.' : 'Unmuted.';
    },
  },
  lock_screen: {
    def: fn('lock_screen', 'Turn the display off (locks the Mac if it requires a password immediately after sleep).'),
    run: async () => { await run('pmset', ['displaysleepnow']); return 'Display off.'; },
  },
  get_clipboard: {
    def: fn('get_clipboard', 'Read the current clipboard text.'),
    run: async () => (await run('pbpaste', [])).slice(0, 2000) || 'The clipboard is empty.',
  },
  set_clipboard: {
    def: fn('set_clipboard', 'Put text on the clipboard.', { text: { type: 'string' } }, ['text']),
    run: async ({ text }) => {
      await osa('on run argv\nset the clipboard to (item 1 of argv)\nend run', text);
      return 'Copied.';
    },
  },
  calendar_events: {
    def: fn('calendar_events', 'List calendar events from the start of today through the next N days (1 = today only).',
      { days: { type: 'number' } }, ['days']),
    run: async ({ days }) => {
      const out = await osa(`on run argv
set d to current date
set time of d to 0
set e to d + ((item 1 of argv as integer) * days)
set out to ""
tell application "Calendar"
  repeat with c in calendars
    repeat with ev in (every event of c whose start date ≥ d and start date < e)
      set out to out & (summary of ev) & " at " & (start date of ev as string) & linefeed
    end repeat
  end repeat
end tell
return out
end run`, String(Math.max(1, Math.round(Number(days) || 1))));
      return out || 'No events.';
    },
  },
  list_reminders: {
    def: fn('list_reminders', 'List incomplete reminders.'),
    run: async () => (await osa(`tell application "Reminders"
set out to ""
repeat with r in (reminders whose completed is false)
  set out to out & (name of r) & linefeed
end repeat
return out
end tell`)) || 'No open reminders.',
  },
  add_reminder: {
    def: fn('add_reminder', 'Add a reminder.', { title: { type: 'string' } }, ['title']),
    run: async ({ title }) => {
      await osa('on run argv\ntell application "Reminders" to make new reminder with properties {name:(item 1 of argv)}\nend run', title);
      return `Reminder added: ${title}.`;
    },
  },
  gmail_unread: {
    def: fn('gmail_unread', 'Check the unread emails of Gmail as shown in Google Chrome (the browser Gmail the user sees). Use whenever the user says Gmail, Chrome or the browser. It opens Gmail if needed.'),
    run: async () => {
      // One script: find the Gmail tab, make sure it is on the inbox, read its title ("Inbox (3) - you@gmail.com" carries the unread count)
      // and try to read the unread rows from the page itself (needs Chrome's "Allow JavaScript from Apple Events").
      const rowsJs = "(() => [...document.querySelectorAll('tr.zE')].slice(0, 8).map((r) => { const s = r.querySelector('.yW span, .zF'); const sub = r.querySelector('.bog'); return (s ? (s.getAttribute('name') || s.textContent) : '?') + ': ' + (sub ? sub.textContent : ''); }).join('\\n'))()";
      const find = () => osa(`on run argv
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains "mail.google.com" then
        if URL of t does not contain "#inbox" then
          set URL of t to "https://mail.google.com/mail/u/0/#inbox"
          delay 2
        end if
        set found to ""
        try
          set found to execute t javascript (item 1 of argv)
        on error
          set found to "JSERR"
        end try
        return (title of t) & linefeed & "###" & linefeed & found
      end if
    end repeat
  end repeat
end tell
return "NOTAB"
end run`, rowsJs);
      let out = await find();
      if (out === 'NOTAB') { // not open yet: open it and wait for the page
        await run('open', ['https://mail.google.com/mail/u/0/#inbox']);
        for (let i = 0; i < 12 && out === 'NOTAB'; i++) { await new Promise((r) => setTimeout(r, 1000)); out = await find(); }
        if (out === 'NOTAB') throw new Error('I could not open Gmail in Chrome.');
      }
      const [title, , rows = ''] = out.split('\n');
      const count = Number((title.match(/\((\d+)\)/) || [])[1] || 0);
      if (count === 0) return 'Gmail shows no unread emails in the inbox.';
      if (rows && rows !== 'JSERR') return `Gmail has ${count} unread in the inbox:\n${rows}`;
      // Cannot read the page: look at it instead.
      await run('osascript', ['-e', 'tell application "Google Chrome" to activate']);
      await new Promise((r) => setTimeout(r, 800));
      const seen = await describeScreen(`This is a Gmail inbox. Exactly ${Math.min(count, 5)} emails are unread: their rows are in bold, normally at the top. List only those, as "sender: subject".`);
      return `Gmail shows ${count} unread in the inbox (the count is exact). The senders and subjects below were read off the screen and may be slightly wrong; to read them exactly, the user can turn on View > Developer > Allow JavaScript from Apple Events in Chrome. On screen: ${seen}`;
    },
  },
  unread_mail: {
    def: fn('unread_mail', 'Count unread emails in the macOS Mail app and list the 5 most recent senders and subjects. Only the Mail app: for Gmail in the browser use gmail_unread.'),
    run: async () => osa(`tell application "Mail"
set out to (unread count of inbox as string) & " unread" & linefeed
set msgs to (messages of inbox whose read status is false)
repeat with i from 1 to (count of msgs)
  if i > 5 then exit repeat
  set m to item i of msgs
  set out to out & (sender of m) & ": " & (subject of m) & linefeed
end repeat
return out
end tell`),
  },
};

// Timers and other things that happen later reach the voice through these events (main.js listens for 'announce').
const events = new EventEmitter();
const control = require('./control')({ run, osa, fn });
for (const t of Object.values(control.tools)) t.group = 'control';
Object.assign(tools, control.tools, require('./memory').tools(fn), require('./extras')({ run, osa, fn, confirm: control.confirm, events }));

// One call for "what's my day": every part is fetched at once, and a part that fails is just left out.
tools.daily_briefing = {
  readOnly: true,
  def: fn('daily_briefing', 'A briefing for the day in one call: today\'s calendar, open reminders, the weather and top headlines. Use for "brief me", "what\'s my day", "good morning".'),
  run: async () => {
    const parts = [['Calendar today', () => tools.calendar_events.run({ days: 1 })], ['Reminders', () => tools.list_reminders.run()],
      ['Weather', () => (process.env.JARVIS_CITY ? tools.weather.run({}) : Promise.reject(new Error('unknown: no home city is set (JARVIS_CITY in .env), so do not mention the weather')))],
      ['Headlines', async () => (await tools.news.run({})).split('\n').slice(0, 3).join('\n')]];
    const limit = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('unavailable: it took too long')), 12000).unref())]);
    const got = await Promise.allSettled(parts.map(([, f]) => limit(f())));
    // A missing part is said to be missing: left out, the model tends to invent it (it once made up the weather).
    return got.map((r, i) => `${parts[i][0]}: ${r.status === 'fulfilled' ? r.value : r.reason.message}`).join('\n\n');
  },
};
for (const name of ['weather', 'news', 'wikipedia', 'look_at_screen', 'get_clipboard', 'calendar_events', 'list_reminders', 'gmail_unread', 'unread_mail', 'list_memories']) tools[name].readOnly = true;

// Tool groups the brain can leave out of a request. Core tools (no group) are always sent. A group is sent when the request
// (or the one before it, for follow-ups such as "and the second one?") sounds like it, or when the model calls use_tools.
const GROUPS = {
  control: /whats ?app|chat|message|\btype\b|\bwrite\b|\btext\b|press|click|\btab\b|chrome|\bkeys?\b|send|reply|button|scroll|bhej|likh|dabao|khol/i,
  github: /git ?hub|\brepos?\b|repositor|pull request|\bprs?\b|\bissues?\b|commit|\bci\b|\bbuild\b|workflow|pipeline|notification/i,
  files: /\bfiles?\b|folder|document|\bpdf\b|resume|\bcv\b|\bdocs?\b|download|desktop|finder|spreadsheet|notes? file|\.(txt|md|pdf|docx?)\b/i,
  media: /music|song|\bplay|pause|resume|\bskip|next track|previous|\btrack|spotify|playing|album|artist|playlist|gaana|gana/i,
  web: /\bpage\b|article|website|\bsite\b|\blink\b|summar|search|look up|google|price|cost|latest|internet|online|review|how (do|to|can)|\bvs\b|compare/i,
  system: /battery|charge|disk|storage|space|uptime|dark mode|light mode|timer|alarm|remind me in|minutes?\b|seconds?\b|calculat|percent|\bplus\b|\bminus\b|\btimes\b|divided|\d\s*[-+*/x%^]\s*\d|\d\s*%|how much is|square root|memory|ram\b/i,
};
const groupsFor = (text) => new Set(Object.keys(GROUPS).filter((g) => GROUPS[g].test(text)));
const definitionsFor = (groups) => Object.values(tools).filter((t) => !t.group || groups.has(t.group)).map((t) => t.def);
const isReadOnly = (name) => !!tools[name]?.readOnly;

const definitions = Object.values(tools).map((t) => t.def);

// Never throws: a failure becomes text the model can tell the user about.
async function runTool(name, args) {
  try {
    if (!tools[name]) throw new Error(`Unknown tool ${name}`);
    return await tools[name].run(args || {});
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = { definitions, definitionsFor, groupsFor, GROUPS, isReadOnly, runTool, takePending: control.takePending, events };
