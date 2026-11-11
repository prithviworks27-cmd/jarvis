// Tools that act inside other apps. Safety is enforced here in code, not just in the prompt:
// - only apps in JARVIS_CONTROL_APPS can receive keys or clicks
// - pressing Return/Enter, or clicking something that sounds like send/pay/delete, waits for the user's own "yes"
// - no typing into password fields, no multi-line text
// - every action is appended to ~/Library/Logs/jarvis-actions.log
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LOG = path.join(os.homedir(), 'Library/Logs/jarvis-actions.log');
const RISKY_CLICK = /send|submit|buy|pay|purchase|order|delete|remove|confirm|transfer|post|publish|sign out|log out/i;
const KEYCODES = { return: 36, enter: 76, tab: 48, space: 49, delete: 51, escape: 53, left: 123, right: 124, down: 125, up: 126 };
const MODS = { cmd: 'command', command: 'command', ctrl: 'control', control: 'control', alt: 'option', option: 'option', shift: 'shift' };

const allowedApps = () => (process.env.JARVIS_CONTROL_APPS || 'Google Chrome,Safari,WhatsApp,Spotify,Music,Notes').split(',').map((s) => s.trim().toLowerCase());

// "cmd+f" -> `keystroke "f" using {command down}`; only validated pieces are ever put into the script.
function keyScript(keys) {
  const parts = String(keys).toLowerCase().split('+').map((s) => s.trim());
  const key = parts.pop();
  const mods = parts.map((m) => MODS[m]);
  if (mods.some((m) => !m)) throw new Error(`Unknown modifier in "${keys}".`);
  const using = mods.length ? ` using {${mods.map((m) => m + ' down').join(', ')}}` : '';
  if (key in KEYCODES) return `key code ${KEYCODES[key]}${using}`;
  if (/^[a-z0-9,./;'\-=\[\]`]$/.test(key)) return `keystroke "${key}"${using}`;
  throw new Error(`Unknown key "${key}".`);
}

// Runs inside the Chrome tab. The label is embedded with JSON.stringify so it can never break out of its string.
// With no match it returns the visible labels so the model can retry with the exact wording.
const pageClickScript = (text, double) => `(() => {
  const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const qw = words(${JSON.stringify(String(text))}).filter((w) => !['my', 'the', 'a', 'an', 'that', 'this', 'file', 'document', 'doc', 'open'].includes(w));
  // every word asked for must match a label word (prefix either way, so "november" finds "Nov")
  const matches = (l) => { const lw = words(l); return qw.length > 0 && qw.every((w) => lw.some((x) => x.startsWith(w) || (x.length >= 3 && w.startsWith(x)))); };
  const norm = (s) => String(s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const label = (e) => norm(e.getAttribute('aria-label') || e.innerText || e.value || e.title);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const els = [...document.querySelectorAll('a,button,input[type=submit],[role=button],[role=link],[role=row],[role=option],[role=menuitem],[role=tab],[role=gridcell],[aria-label]')].filter(vis);
  const hits = els.filter((e) => matches(label(e))).sort((a, b) => label(a).length - label(b).length);
  if (!hits.length) return 'NOMATCH visible labels: ' + [...new Set(els.map(label).filter((t) => t && t.length < 60))].slice(0, 40).join(' | ');
  const el = hits[0];
  el.scrollIntoView({ block: 'center' });
  el.click();
  ${double ? "el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));" : ''}
  return 'CLICKED ' + label(el).slice(0, 60);
})()`;

module.exports = ({ run, osa, fn }) => {
  let pending = null;

  const log = (tool, args, result) => fs.appendFile(LOG, `${new Date().toISOString()} ${tool} ${JSON.stringify(args)} -> ${String(result).slice(0, 150)}\n`, () => {});
  const logged = (tool, run) => async (args) => {
    try { const r = await run(args); log(tool, args, r); return r; } catch (e) { log(tool, args, `ERROR ${e.message}`); throw e; }
  };

  // The model can never confirm for the user: the action is parked here and only the user's next "yes" (handled in brain.js) runs it.
  const confirm = (description, run) => {
    pending = { run, at: Date.now() };
    return `CONFIRMATION REQUIRED, nothing has been done yet. Ask the user exactly: "${description} Shall I go ahead?" and wait for their answer.`;
  };
  const takePending = () => {
    const p = pending && Date.now() - pending.at < 60000 ? pending : null;
    pending = null; // any other utterance cancels it
    return p;
  };

  const frontApp = () => osa('tell application "System Events" to get name of first application process whose frontmost is true');
  const requireAllowed = async () => {
    const app = await frontApp();
    if (!allowedApps().includes(app.toLowerCase())) throw new Error(`I am not allowed to control ${app}. Allowed apps are ${allowedApps().join(', ')}.`);
    return app;
  };
  const sysevents = (cmd) => osa(`tell application "System Events" to ${cmd}`);

  const tools = {
    focus_chrome_tab: {
      def: fn('focus_chrome_tab', 'Switch to an already open Google Chrome tab whose title or address contains the text.', { query: { type: 'string' } }, ['query']),
      run: logged('focus_chrome_tab', async ({ query }) => {
        const title = await osa(`on run argv
set q to item 1 of argv
tell application "Google Chrome"
  repeat with w in windows
    set i to 0
    repeat with t in tabs of w
      set i to i + 1
      if (title of t contains q) or (URL of t contains q) then
        set active tab index of w to i
        set index of w to 1
        activate
        return title of t
      end if
    end repeat
  end repeat
end tell
error "No open Chrome tab matches " & q
end run`, query);
        return `Switched to "${title}".`;
      }),
    },
    whatsapp_open_chat: {
      def: fn('whatsapp_open_chat', 'Open the WhatsApp chat with a person or group by name. Does not type or send anything in the chat.', { name: { type: 'string' } }, ['name']),
      run: logged('whatsapp_open_chat', async ({ name }) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        if ((await frontApp()).toLowerCase() !== 'whatsapp') { await osa('tell application "WhatsApp" to activate'); await sleep(300); }
        await requireAllowed();

        // We judge progress by watching parts of the WhatsApp window change (cheap, no API call), not by fixed waits.
        let snapOf = null;
        try {
          const [x, y, w, h] = (await osa('tell application "System Events" to tell process "WhatsApp" to return (position of window 1) & (size of window 1)')).split(',').map(Number);
          const file = path.join(os.tmpdir(), `jarvis-wa-${process.pid}.png`);
          snapOf = (fx, fy, fw, fh) => async () => {
            await run('screencapture', ['-x', '-R', [x + fx * w, y + fy * h, fw * w, fh * h].map(Math.round).join(','), '-t', 'png', file]);
            return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
          };
        } catch { /* no window bounds: fixed waits below */ }
        // Resolves with the area's hash once it has changed from `before` and then held still for two looks, else null.
        const settles = async (snap, before, maxMs, looks = 2) => {
          let last = before, steady = 0;
          const t0 = Date.now();
          try {
            while (Date.now() - t0 < maxMs) {
              await sleep(100);
              const hash = await snap();
              steady = hash === last && hash !== before ? steady + 1 : 0;
              last = hash;
              if (steady >= looks) return hash;
            }
          } catch { /* screenshots failed */ }
          return null;
        };

        const list = snapOf && snapOf(0.19, 0.16, 0.3, 0.55); // search results
        const pane = snapOf && snapOf(0.52, 0.2, 0.45, 0.6); // the open conversation
        const listBefore = list && await list().catch(() => null);
        const paneBefore = pane && await pane().catch(() => null);

        // Cmd+A first: if an old search is still in the box, typing must replace it, not append to it.
        await osa('on run argv\ntell application "System Events"\nkeystroke "f" using {command down}\ndelay 0.15\nkeystroke "a" using {command down}\ndelay 0.1\nkeystroke (item 1 of argv)\nend tell\nend run', name);
        const resultsSettled = listBefore ? await settles(list, listBefore, 2500) : (await sleep(2000), null);

        // Down moves into the result list, Return opens the highlighted row. On this WhatsApp the first Down only moves focus and
        // highlights nothing, so keep pressing Down (max 3) until the list area visibly changes, i.e. the highlight ring appeared.
        // One Return only: a blind second one could send a draft message if the chat had in fact opened (or was already open).
        for (let i = 0; i < 3; i++) {
          await sysevents('key code 125');
          await sleep(300);
          if (!resultsSettled) { if (i === 1) break; continue; } // cannot watch the screen: two Downs, as observed
          if ((await list().catch(() => resultsSettled)) !== resultsSettled) break;
        }
        await sysevents('key code 36');
        if (!paneBefore) { await sleep(800); return `Opened the WhatsApp chat for ${name}.`; } // cannot watch the screen: assume it worked
        if (await settles(pane, paneBefore, 2000)) return `Opened the WhatsApp chat for ${name}.`;
        throw new Error(`I searched WhatsApp for ${name} but could not confirm the chat opened. It may already have been open.`);
      }),
    },
    type_in_whatsapp_chat: {
      def: fn('type_in_whatsapp_chat', 'Type text into the message box of the WhatsApp chat that is currently open, without sending it. Use when the user says to type in this chat.', { text: { type: 'string' } }, ['text']),
      run: logged('type_in_whatsapp_chat', async ({ text }) => {
        if (/[\r\n\t]/.test(text)) throw new Error('Only single-line text can be typed.');
        if ((await frontApp()).toLowerCase() !== 'whatsapp') { await osa('tell application "WhatsApp" to activate'); await new Promise((r) => setTimeout(r, 400)); }
        await requireAllowed();
        // Click the message box first so the text cannot land in the search field or the chat list.
        const [x, y, w, h] = (await osa('tell application "System Events" to tell process "WhatsApp" to return (position of window 1) & (size of window 1)')).split(',').map(Number);
        await run('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics');
function run(argv) {
  const p = $.CGPointMake(Number(argv[0]), Number(argv[1]));
  for (const t of [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent($(), t, p, $.kCGMouseButtonLeft));
}`, String(Math.round(x + 0.68 * w)), String(Math.round(y + h - 26))]);
        await new Promise((r) => setTimeout(r, 150));
        await osa('on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run', text);
        return 'Typed in the WhatsApp message box (not sent).';
      }),
    },
    type_text: {
      def: fn('type_text', 'Type a single line of text into the focused field of the front app (it must be an allowed app). Never presses Return.', { text: { type: 'string' } }, ['text']),
      run: logged('type_text', async ({ text }) => {
        if (/[\r\n\t]/.test(text)) throw new Error('Only single-line text can be typed.');
        await requireAllowed();
        const role = await osa(`tell application "System Events" to tell (first application process whose frontmost is true)
try
  return (value of attribute "AXSubrole" of (value of attribute "AXFocusedUIElement")) as text
on error
  return ""
end try
end tell`);
        if (role === 'AXSecureTextField') throw new Error('That is a password field, so I will not type into it.');
        await osa('on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run', text);
        return 'Typed.';
      }),
    },
    press_keys: {
      def: fn('press_keys', 'Press a key or shortcut in the front app (it must be an allowed app), e.g. "cmd+f", "tab", "down", "escape", "return". Return/Enter asks the user to confirm first.', { keys: { type: 'string' } }, ['keys']),
      run: logged('press_keys', async ({ keys }) => {
        const script = keyScript(keys);
        const go = async () => { await requireAllowed(); await sysevents(script); return `Pressed ${keys}.`; };
        if (/(^|\+)(return|enter)$/i.test(keys.trim())) return confirm(`Press ${keys} in ${await frontApp()}.`, go);
        return go();
      }),
    },
    click_in_chrome_page: {
      def: fn('click_in_chrome_page', 'Click a link, button or list item on the web page in the active Chrome tab by its visible text (e.g. a Google Drive file, a YouTube video). Use double=true to open items in file lists like Google Drive. If nothing matches, the result lists the visible labels: retry with one of them.',
        { text: { type: 'string' }, double: { type: 'boolean' } }, ['text']),
      run: logged('click_in_chrome_page', async ({ text, double }) => {
        if (!allowedApps().includes('google chrome')) throw new Error('Google Chrome is not in the allowed apps list.');
        const go = async () => {
          let out;
          try {
            out = await osa('on run argv\ntell application "Google Chrome" to tell active tab of front window to execute javascript (item 1 of argv)\nend run', pageClickScript(text, double));
          } catch (e) {
            if (/turned off/i.test(e.message)) throw new Error('Chrome is blocking this. The user must turn on View > Developer > Allow JavaScript from Apple Events in Chrome.');
            throw e;
          }
          if (out.startsWith('NOMATCH')) throw new Error(out);
          return out;
        };
        return RISKY_CLICK.test(text) ? confirm(`Click "${text}" on the Chrome page.`, go) : go();
      }),
    },
    click_ui_element: {
      def: fn('click_ui_element', 'Click a button or row in a NATIVE app window (not a web page: use click_in_chrome_page for Chrome pages) by its visible label. The front app must be allowed. Can be slow in big windows.', { label: { type: 'string' } }, ['label']),
      run: logged('click_ui_element', async ({ label }) => {
        const go = async () => {
          await requireAllowed();
          await osa(`on run argv
set q to item 1 of argv
tell application "System Events"
  tell (first application process whose frontmost is true)
    repeat with el in (entire contents of window 1)
      try
        if ((name of el) contains q) or ((description of el) contains q) or ((title of el) contains q) then
          try
            perform action "AXPress" of el
          on error
            click el
          end try
          return "ok"
        end if
      end try
    end repeat
  end tell
end tell
error "No element labelled " & q & " in the front window."
end run`, label);
          return `Clicked "${label}".`;
        };
        return RISKY_CLICK.test(label) ? confirm(`Click "${label}" in ${await frontApp()}.`, go) : go();
      }),
    },
  };

  return { tools, takePending, keyScript };
};
module.exports.keyScript = keyScript;
module.exports.pageClickScript = pageClickScript;
