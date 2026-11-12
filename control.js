// Tools that act inside other apps. Safety is enforced here in code, not just in the prompt:
// - only apps in JARVIS_CONTROL_APPS can receive keys or clicks
// - pressing Return/Enter, or clicking something that sounds like send/pay/delete, waits for the user's own "yes"
// - no typing into password fields, no multi-line text
// - every action is appended to ~/Library/Logs/jarvis-actions.log
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { closest } = require('./fuzzy');
const { ensure } = require('./helpers');
const { paste: realPaste } = require('./dictate');

const LOG = path.join(os.homedir(), 'Library/Logs/jarvis-actions.log');
const RISKY_WORDS = ['send', 'submit', 'buy', 'pay', 'purchase', 'order', 'delete', 'remove', 'confirm', 'transfer', 'post', 'publish', 'sign out', 'log out'];
const RISKY_CLICK = new RegExp(RISKY_WORDS.join('|'), 'i');
const KEYCODES = { return: 36, enter: 76, tab: 48, space: 49, delete: 51, escape: 53, left: 123, right: 124, down: 125, up: 126 };
const MODS = { cmd: 'command', command: 'command', ctrl: 'control', control: 'control', alt: 'option', option: 'option', shift: 'shift' };

// What you type may be private, so the log records only how much was typed. Owner-only file.
const TYPED = new Set(['type_text', 'type_in_whatsapp_chat', 'whatsapp_type_to']);
try { fs.chmodSync(LOG, 0o600); } catch { /* no log yet */ }

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
const pageClickScript = (text, double, confirmed = false) => `(() => {
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
  // The check that matters is on what would be clicked, not on what was asked for.
  if (${confirmed ? 'false' : 'true'} && new RegExp(${JSON.stringify(RISKY_WORDS.join('|'))}, 'i').test(label(el))) return 'RISKY ' + label(el);
  el.scrollIntoView({ block: 'center' });
  el.click();
  ${double ? "el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));" : ''}
  return 'CLICKED ' + label(el).slice(0, 60);
})()`;

// In a browser the macOS accessibility check cannot see web pages, so ask the page itself. If it cannot answer, do not type.
const FIELD_JS = "(() => { const e = document.activeElement; return e ? (e.tagName === 'IFRAME' ? 'iframe' : (e.type || e.tagName)) : ''; })()";

module.exports = ({ run, osa, fn, paste = realPaste }) => {
  let pending = null;

  const log = (tool, args, result) => {
    const shown = TYPED.has(tool) ? { text: `<${String(args.text ?? '').length} chars>` } : args;
    fs.appendFile(LOG, `${new Date().toISOString()} ${tool} ${JSON.stringify(shown)} -> ${String(result).slice(0, 150)}
`, { mode: 0o600 }, () => {});
  };
  const logged = (tool, run) => async (args) => {
    try { const r = await run(args); log(tool, args, r); return r; } catch (e) { log(tool, args, `ERROR ${e.message}`); throw e; }
  };

  // The model can never confirm for the user: the action is parked here and only the user's next "yes" (handled in brain.js) runs it.
  // `where` names the place it was asked about (front app, or Chrome tab). If that changed before the "yes", nothing runs.
  const confirm = async (description, run, where) => {
    const asked = await where();
    pending = {
      at: Date.now(),
      run: async () => {
        if ((await where()) !== asked) throw new Error('You moved to a different place since I asked, so I did not do it.');
        return run();
      },
    };
    return `CONFIRMATION REQUIRED, nothing has been done yet. Ask the user exactly: "${description} Shall I go ahead?" and wait for their answer.`;
  };
  const takePending = () => {
    const p = pending && Date.now() - pending.at < 60000 ? pending : null;
    pending = null; // any other utterance cancels it
    return p;
  };

  // Contact names from the Mac's Contacts app, read once on first use, so a misheard name can snap to a real one.
  let contacts;
  const contactNames = () => contacts ||= osa('tell application "Contacts" to set ns to (get name of people)\nset out to ""\nrepeat with n in ns\ntry\nset out to out & (n as text) & linefeed\nend try\nend repeat\nreturn out')
    .then((t) => t.split('\n').map((x) => x.trim()).filter((x) => x && x !== 'missing value'))
    .catch(() => { contacts = undefined; return []; }); // no permission yet: try again next time

  const frontApp = () => osa('tell application "System Events" to get name of first application process whose frontmost is true');
  const requireAllowed = async () => {
    const app = await frontApp();
    if (!allowedApps().includes(app.toLowerCase())) throw new Error(`I am not allowed to control ${app}. Allowed apps are ${allowedApps().join(', ')}.`);
    return app;
  };
  const stillInWhatsApp = async () => {
    if ((await frontApp()).toLowerCase() !== 'whatsapp') throw new Error('You switched away from WhatsApp, so I stopped.');
  };
  const sysevents = (cmd) => osa(`tell application "System Events" to ${cmd}`);

  // ---- WhatsApp ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const waWindow = async () => {
    const [x, y, w, h] = (await osa('tell application "System Events" to tell process "WhatsApp" to return (position of window 1) & (size of window 1)')).split(',').map(Number);
    return { x, y, w, h };
  };
  const waFront = async () => {
    if ((await frontApp()).toLowerCase() !== 'whatsapp') {
      await osa('tell application "WhatsApp" to activate');
      // With Stage Manager the window can take a moment to come back: wait until it exists, not a fixed time.
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        if ((await frontApp()).toLowerCase() === 'whatsapp' && Number(await osa('tell application "System Events" to tell process "WhatsApp" to return count of windows')) > 0) break;
      }
    }
    await requireAllowed();
  };
  // Reads text in a part of the screen with the Mac's own OCR (free, on-device, about 0.3 s).
  const ocr = async (x, y, w, h) => {
    const bin = await ensure('ocr');
    const file = path.join(os.tmpdir(), `jarvis-ocr-${crypto.randomUUID()}.png`);
    try {
      await run('screencapture', ['-x', '-R', [x, y, w, h].map(Math.round).join(','), '-t', 'png', file]);
      return await run(bin, [file]);
    } finally {
      fs.unlink(file, () => {});
    }
  };
  // Is this person's chat the open one? The header of the conversation shows its name. null = could not read the screen.
  const headerHas = async (name, win) => {
    try { return norm(await ocr(win.x + 0.5 * win.w, win.y, 0.5 * win.w, 0.07 * win.h)).includes(norm(name)); } catch { return null; }
  };
  // "Risham" -> "Rishabh": keep the name if it is part of a known one, otherwise take the one that sounds closest.
  const resolveName = async (heard) => {
    const known = [...(process.env.JARVIS_VOCAB || '').split(',').map((x) => x.trim()).filter(Boolean), ...(await contactNames())];
    return known.some((k) => k.toLowerCase().includes(heard.toLowerCase())) ? heard : closest(heard, known) || heard;
  };

  async function openChat(name) {
    await waFront();
    const win = await waWindow();
    const already = await headerHas(name, win);
    if (already) return `The WhatsApp chat for ${name} is already open.`;

    // Fallback when the screen cannot be read: judge progress by parts of the window changing instead.
    const file = path.join(os.tmpdir(), `jarvis-wa-${process.pid}.png`);
    const snapOf = (fx, fy, fw, fh) => async () => {
      await run('screencapture', ['-x', '-R', [win.x + fx * win.w, win.y + fy * win.h, fw * win.w, fh * win.h].map(Math.round).join(','), '-t', 'png', file]);
      return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
    };
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
    const list = snapOf(0.19, 0.16, 0.3, 0.55); // search results
    const pane = snapOf(0.52, 0.2, 0.45, 0.6); // the open conversation
    const listBefore = await list().catch(() => null);
    const paneBefore = await pane().catch(() => null);

    await stillInWhatsApp(); // the user may have clicked elsewhere while we were measuring the window
    // Cmd+A first: if an old search is still in the box, typing must replace it, not append to it.
    await osa('on run argv\ntell application "System Events"\nkeystroke "f" using {command down}\ndelay 0.15\nkeystroke "a" using {command down}\ndelay 0.1\nkeystroke (item 1 of argv)\nend tell\nend run', name);
    const resultsSettled = listBefore ? await settles(list, listBefore, 2500) : (await sleep(2000), null);

    // Down moves into the result list, Return opens the highlighted row. On this WhatsApp the first Down only moves focus and
    // highlights nothing, so keep pressing Down (max 3) until the list area visibly changes, i.e. the highlight ring appeared.
    // One Return only: a blind second one could send a draft message if the chat had in fact opened.
    await stillInWhatsApp();
    for (let i = 0; i < 3; i++) {
      await sysevents('key code 125');
      await sleep(300);
      if (!resultsSettled) { if (i === 1) break; continue; } // cannot watch the screen: two Downs, as observed
      if ((await list().catch(() => resultsSettled)) !== resultsSettled) break;
    }
    await stillInWhatsApp(); // Return in the wrong app could submit a form or send a message
    await sysevents('key code 36');

    if (already === null) { // OCR unavailable: the old heuristic
      if (!paneBefore) { await sleep(800); return `Opened the WhatsApp chat for ${name}.`; }
      if (await settles(pane, paneBefore, 2000)) return `Opened the WhatsApp chat for ${name}.`;
    } else {
      for (let i = 0; i < 6; i++) { // the header names the chat once it is open
        if (await headerHas(name, win)) return `Opened the WhatsApp chat for ${name}.`;
        await sleep(150);
      }
    }
    throw new Error(`I searched WhatsApp for ${name} but the chat did not open (maybe no chat has that name). Do not try again; tell the user.`);
  }

  async function typeInChat(text, knownWindow) {
    if (/[\r\n\t]/.test(text)) throw new Error('Only single-line text can be typed.');
    if (!knownWindow) await waFront(); // right after openChat, WhatsApp is already in front
    await stillInWhatsApp();
    // Click the message box first so the text cannot land in the search field or the chat list.
    const { x, y, w, h } = knownWindow || await waWindow();
    await run('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics');
function run(argv) {
  const p = $.CGPointMake(Number(argv[0]), Number(argv[1]));
  for (const t of [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent($(), t, p, $.kCGMouseButtonLeft));
}`, String(Math.round(x + 0.68 * w)), String(Math.round(y + h - 26))]);
    await sleep(100);
    await stillInWhatsApp();
    await paste(text); // pasting is instant; typing key by key took seconds
    return 'Typed in the WhatsApp message box (not sent).';
  }

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
      def: fn('whatsapp_open_chat', 'Open the WhatsApp chat with a person or group by name (instant if it is already open). Does not type or send anything. If it fails, do not retry: tell the user.', { name: { type: 'string' } }, ['name']),
      run: logged('whatsapp_open_chat', async ({ name }) => openChat(await resolveName(name))),
    },
    type_in_whatsapp_chat: {
      def: fn('type_in_whatsapp_chat', 'Type text into the message box of the WhatsApp chat that is currently open, without sending it. Use when the user says to type in this chat.', { text: { type: 'string' } }, ['text']),
      run: logged('type_in_whatsapp_chat', async ({ text }) => typeInChat(text)),
    },
    whatsapp_type_to: {
      def: fn('whatsapp_type_to', 'Open the WhatsApp chat with a person (instant if already open) and type a message in it WITHOUT sending. Use for "type/write hi to Rishabh". Sending needs a separate press of return, which the user confirms.', { name: { type: 'string' }, text: { type: 'string' } }, ['name', 'text']),
      run: logged('whatsapp_type_to', async ({ name, text }) => {
        const win = await waWindow().catch(() => null);
        const opened = await openChat(await resolveName(name));
        return `${opened} ${await typeInChat(text, win && await waWindow())}`;
      }),
    },
    type_text: {
      def: fn('type_text', 'Type a single line of text into the focused field of the front app (it must be an allowed app). Never presses Return.', { text: { type: 'string' } }, ['text']),
      run: logged('type_text', async ({ text }) => {
        if (/[\r\n\t]/.test(text)) throw new Error('Only single-line text can be typed.');
        const app = (await requireAllowed()).toLowerCase();
        const role = await osa(`tell application "System Events" to tell (first application process whose frontmost is true)
try
  return (value of attribute "AXSubrole" of (value of attribute "AXFocusedUIElement")) as text
on error
  return ""
end try
end tell`);
        if (role === 'AXSecureTextField') throw new Error('That is a password field, so I will not type into it.');
        if (app === 'google chrome' || app === 'safari') {
          let kind;
          try {
            kind = await osa(app === 'safari'
              ? 'on run argv\ntell application "Safari" to do JavaScript (item 1 of argv) in current tab of front window\nend run'
              : 'on run argv\ntell application "Google Chrome" to tell active tab of front window to execute javascript (item 1 of argv)\nend run', FIELD_JS);
          } catch {
            throw new Error('I cannot tell whether that box is a password field, so I will not type there. Turn on JavaScript from Apple Events in the browser, or type it yourself.');
          }
          if (kind === 'password' || kind === 'iframe') throw new Error('That box is a password field or sits inside an embedded frame, so I will not type into it.');
        }
        await paste(text);
        return 'Typed.';
      }),
    },
    press_keys: {
      def: fn('press_keys', 'Press a key or shortcut in the front app (it must be an allowed app), e.g. "cmd+f", "tab", "down", "escape", "return". Return/Enter asks the user to confirm first.', { keys: { type: 'string' } }, ['keys']),
      run: logged('press_keys', async ({ keys }) => {
        const script = keyScript(keys);
        const go = async () => { await requireAllowed(); await sysevents(script); return `Pressed ${keys}.`; };
        if (/(^|\+)(return|enter)$/i.test(keys.trim())) return confirm(`Press ${keys} in ${await frontApp()}.`, go, frontApp);
        return go();
      }),
    },
    click_in_chrome_page: {
      def: fn('click_in_chrome_page', 'Click a link, button or list item on the web page in the active Chrome tab by its visible text (e.g. a Google Drive file, a YouTube video). Use double=true to open items in file lists like Google Drive. If nothing matches, the result lists the visible labels: retry with one of them.',
        { text: { type: 'string' }, double: { type: 'boolean' } }, ['text']),
      run: logged('click_in_chrome_page', async ({ text, double }) => {
        if (!allowedApps().includes('google chrome')) throw new Error('Google Chrome is not in the allowed apps list.');
        const tabUrl = () => osa('tell application "Google Chrome" to return URL of active tab of front window');
        const attempt = async (confirmed) => {
          let out;
          try {
            out = await osa('on run argv\ntell application "Google Chrome" to tell active tab of front window to execute javascript (item 1 of argv)\nend run', pageClickScript(text, double, confirmed));
          } catch (e) {
            if (/turned off/i.test(e.message)) throw new Error('Chrome is blocking this. The user must turn on View > Developer > Allow JavaScript from Apple Events in Chrome.');
            throw e;
          }
          if (out.startsWith('NOMATCH')) throw new Error(out);
          if (out.startsWith('RISKY ')) return confirm(`Click "${out.slice(6)}" on the Chrome page.`, () => attempt(true), tabUrl);
          return out;
        };
        return RISKY_CLICK.test(text) ? confirm(`Click "${text}" on the Chrome page.`, () => attempt(true), tabUrl) : attempt(false);
      }),
    },
    click_ui_element: {
      def: fn('click_ui_element', 'Click a button or row in a NATIVE app window (not a web page: use click_in_chrome_page for Chrome pages) by its visible label. The front app must be allowed. Can be slow in big windows.', { label: { type: 'string' } }, ['label']),
      run: logged('click_ui_element', async ({ label }) => {
        // The script reports "RISKY <label>" instead of clicking when the element it found sounds dangerous and the user has not said yes.
        const attempt = async (confirmed) => {
          await requireAllowed();
          const out = await osa(`on run argv
set q to item 1 of argv
set confirmed to (item 2 of argv is "yes")
set AppleScript's text item delimiters to "|"
set riskyWords to text items of (item 3 of argv)
set AppleScript's text item delimiters to ""
tell application "System Events"
  tell (first application process whose frontmost is true)
    repeat with el in (entire contents of window 1)
      try
        set lbl to ""
        try
          set lbl to lbl & (name of el)
        end try
        try
          set lbl to lbl & " " & (description of el)
        end try
        try
          set lbl to lbl & " " & (title of el)
        end try
        if lbl contains q then
          if not confirmed then
            repeat with w in riskyWords
              if lbl contains (w as text) then return "RISKY " & lbl
            end repeat
          end if
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
end run`, label, confirmed ? 'yes' : 'no', RISKY_WORDS.join('|'));
          if (out.startsWith('RISKY ')) return confirm(`Click "${out.slice(6).trim()}" in ${await frontApp()}.`, () => attempt(true), frontApp);
          return `Clicked "${label}".`;
        };
        return RISKY_CLICK.test(label) ? confirm(`Click "${label}" in ${await frontApp()}.`, () => attempt(true), frontApp) : attempt(false);
      }),
    },
  };

  return { tools, takePending };
};
module.exports.keyScript = keyScript;
module.exports.pageClickScript = pageClickScript;
