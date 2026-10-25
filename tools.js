const { execFile } = require('child_process');

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 30000 }, (err, out, errout) =>
      err ? reject(new Error((errout || err.message).trim())) : resolve(out.trim())));

// Script args go through AppleScript's `argv`, never string-spliced into the script.
const osa = (script, ...args) => run('osascript', ['-e', script, ...args]);

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const tools = {
  open_app: {
    def: fn('open_app', 'Open a Mac application by name, e.g. "Spotify".', { name: { type: 'string' } }, ['name']),
    run: async ({ name }) => { await run('open', ['-a', name]); return `Opened ${name}.`; },
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
    def: fn('web_search', 'Search the web in the default browser.', { query: { type: 'string' } }, ['query']),
    run: async ({ query }) => {
      await run('open', ['https://www.google.com/search?q=' + encodeURIComponent(query)]);
      return `Searched for ${query}.`;
    },
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
  unread_mail: {
    def: fn('unread_mail', 'Count unread emails in Mail and list the 5 most recent senders and subjects.'),
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

module.exports = { definitions, runTool };
