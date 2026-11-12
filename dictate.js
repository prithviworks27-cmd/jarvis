// Dictation: the words you speak are typed into whatever app is in front. No AI in the middle, so no tool can be triggered by it.
const { execFile } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, (err, out, errout) => (err ? reject(new Error((errout || err.message).trim())) : resolve(out))));
const osa = (script, ...args) => exec('osascript', ['-e', script, ...args]);

// Whisper "hears" these from silence or room noise; typing them into your document would be wrong.
const NOISE = /^(thank you\.?|thanks for watching\.?|you\.?|bye\.?|\.+)$/i;

// Trailing space so two dictations in a row do not run together.
const cleanDictation = (raw) => {
  const t = String(raw || '').trim();
  return !t || NOISE.test(t) ? '' : `${t} `;
};

// Paste instead of typing key by key: instant (typing 20 characters key by key takes seconds), and it handles Hindi and any other
// script. Your clipboard text is put back afterwards. Callers check what kind of field has focus first.
async function paste(text) {
  const old = await exec('pbpaste', []).catch(() => '');
  await osa('on run argv\nset the clipboard to (item 1 of argv)\ntell application "System Events" to keystroke "v" using command down\nend run', text);
  await sleep(250); // let the app read the clipboard before it changes back
  if (old) await osa('on run argv\nset the clipboard to (item 1 of argv)\nend run', old);
}

async function pasteText(text) {
  const role = (await osa(`tell application "System Events" to tell (first application process whose frontmost is true)
try
  return (value of attribute "AXSubrole" of (value of attribute "AXFocusedUIElement")) as text
on error
  return ""
end try
end tell`)).trim();
  if (role === 'AXSecureTextField') throw new Error('That is a password field, so I will not type into it.');
  await paste(text);
}

module.exports = { cleanDictation, pasteText, paste };
