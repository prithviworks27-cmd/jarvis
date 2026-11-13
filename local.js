// Commands this Mac can settle on its own, with no language model: "open Spotify", "volume up", "pause", "scroll down",
// "what time is it", "send it". They run in tens of milliseconds instead of waiting on the network (1 to 12 seconds).
//
// The rule that keeps this safe: a sentence is handled here only when it is a WHOLE, UNAMBIGUOUS command. Anything with an
// extra clause ("open Spotify and play Frank Ocean"), a name that is not exactly an installed app ("open youtube"), or a state
// that does not fit (a bare "pause" with no music app open) returns null and goes to the model as before.
const fs = require('fs');
const os = require('os');
const path = require('path');

const squash = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// What people say -> the installed app's real name. Only used when that app is installed.
const ALIASES = { chrome: 'Google Chrome', 'google chrome': 'Google Chrome', brave: 'Brave Browser', edge: 'Microsoft Edge', code: 'Visual Studio Code', vscode: 'Visual Studio Code',
  'vs code': 'Visual Studio Code', whatsapp: 'WhatsApp', 'what s app': 'WhatsApp', settings: 'System Settings', 'system preferences': 'System Settings', 'task manager': 'Activity Monitor' };

let appCache = { at: 0, list: [] };
function installedApps() {
  if (Date.now() - appCache.at < 60000 && appCache.list.length) return appCache.list;
  const dirs = ['/Applications', '/System/Applications', '/System/Applications/Utilities', '/Applications/Utilities', path.join(os.homedir(), 'Applications')];
  appCache = { at: Date.now(), list: dirs.flatMap((d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.app')).map((f) => f.slice(0, -4)); } catch { return []; } }) };
  return appCache.list;
}
const exactApp = (spoken, apps) => {
  const want = ALIASES[String(spoken).toLowerCase().trim()] || spoken;
  return apps.find((a) => squash(a) === squash(want)) || null;
};

// "Alfred, please open Spotify." -> "open spotify"
const normalise = (text) => String(text).toLowerCase()
  .replace(/^[\s,.!?-]*(?:hey |hi |ok |okay )?(?:alfred|alfie|jarvis)[\s,.!?:-]*/i, '')
  .replace(/^(?:please|can you|could you|will you|kindly)\s+/, '').replace(/\s+(?:please|now|for me|sir)$/, '')
  .replace(/[.!?,\s]+$/, '').replace(/\s+/g, ' ').trim();

const MEDIA = { pause: 'pause', resume: 'play', play: 'play', next: 'next', skip: 'next', previous: 'previous' };
const time12 = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

// ctx: { apps, front } where front() resolves to the front app's name. Returns null, or one of
//   { tool, args }  run this tool (the reply is silent unless it fails), or { say } a spoken answer.
async function route(raw, ctx = {}) {
  const t = normalise(raw);
  if (!t || t.length > 60) return null;
  let m;

  // Open an app: only an exact installed app name. "open youtube" / "open rishabh" are for the model (site, chat).
  if ((m = t.match(/^(?:open|launch|start|switch to)\s+(?:the\s+)?(.+?)(?:\s+app)?$/) || t.match(/^(.+?)\s+(?:kholo|khol do|khol de|chalu karo|open karo)$/))) {
    const app = exactApp(m[1], ctx.apps || installedApps());
    return app ? { tool: 'open_app', args: { name: app } } : null;
  }

  // Volume.
  if ((m = t.match(/^(?:set\s+)?(?:the\s+)?volume\s+(?:to|at)\s+(\d{1,3})(?:\s*%|\s*percent)?$/) || t.match(/^(\d{1,3})\s*(?:%|percent)\s+volume$/))) return { tool: 'set_volume', args: { level: Math.min(100, Number(m[1])) } };
  if (/^(?:volume\s+up|turn\s+(?:it\s+|the\s+volume\s+)?up|louder|increase\s+(?:the\s+)?volume|volume\s+badhao)$/.test(t)) return { tool: 'set_volume', args: { change: 12 } };
  if (/^(?:volume\s+down|turn\s+(?:it\s+|the\s+volume\s+)?down|quieter|softer|lower\s+(?:the\s+)?volume|decrease\s+(?:the\s+)?volume|volume\s+(?:kam\s+karo|ghatao))$/.test(t)) return { tool: 'set_volume', args: { change: -12 } };
  if ((m = t.match(/^(mute|unmute)(?:\s+(?:the\s+)?(?:sound|volume|audio|mac|computer))?$/))) return { tool: 'set_mute', args: { muted: m[1] === 'mute' } };

  // Playback of the music app that is open (a bare "pause" with no music app is the model's: it may be a video in a tab).
  // Not "stop" or "back": those mean other things (cancel, browser back).
  if ((m = t.match(/^(pause|resume|play|next|skip|previous)(?:\s+(?:the\s+)?(?:music|song|track|playback|it|this))?$/)) && (!ctx.musicOpen || await ctx.musicOpen())) return { tool: 'media_control', args: { action: MEDIA[m[1]] } };

  // Scrolling, by the page keys of the app in front (the same allowed-app rules as every other key press).
  if ((m = t.match(/^scroll\s+(down|up)(?:\s+(?:a\s+)?(?:lot|bit|little|more))?$/))) return { tool: 'press_keys', args: { keys: m[1] === 'down' ? 'pagedown' : 'pageup' } };
  if ((m = t.match(/^(?:go\s+to\s+|scroll\s+to\s+)(?:the\s+)?(top|bottom)(?:\s+of\s+(?:the\s+)?(?:page|document))?$/))) return { tool: 'press_keys', args: { keys: m[1] === 'top' ? 'cmd+up' : 'cmd+down' } };

  // The Mac itself.
  if (/^(?:lock(?:\s+(?:the\s+)?(?:screen|mac|computer))?|turn\s+(?:the\s+)?(?:screen|display)\s+off)$/.test(t)) return { tool: 'lock_screen', args: {} };
  if ((m = t.match(/^(?:turn|switch)\s+(on|off)\s+dark\s+mode$|^dark\s+mode\s+(on|off)$|^(?:turn|switch)\s+dark\s+mode\s+(on|off)$/))) return { tool: 'set_dark_mode', args: { on: (m[1] || m[2] || m[3]) === 'on' } };
  if (/^(?:switch\s+to\s+|turn\s+on\s+)?light\s+mode$/.test(t)) return { tool: 'set_dark_mode', args: { on: false } };
  if (/^(?:switch\s+to\s+)?dark\s+mode$/.test(t)) return { tool: 'set_dark_mode', args: { on: true } };

  // Things Alfred can simply know.
  const now = ctx.now ? ctx.now() : new Date();
  if (/^what(?:'s| is)\s+the\s+time(?:\s+(?:now|right\s+now))?$|^what\s+time\s+is\s+it(?:\s+(?:now|right\s+now))?$|^(?:the\s+)?time$|^time\s+kya\s+(?:hai|hua\s+hai)$/.test(t)) return { say: `It is ${time12(now)}, ${ctx.userName || 'sir'}.` };
  if (/^what(?:'s| is)\s+(?:the\s+)?(?:today's\s+)?date(?:\s+today)?$|^what\s+day\s+is\s+(?:it|today)$|^(?:today's\s+)?date$/.test(t)) return { say: `It is ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}, ${ctx.userName || 'sir'}.` };

  // "Send it" with WhatsApp in front sends what is already typed (it asks first; it never types).
  if (/^(?:send|send\s+it|send\s+the\s+(?:text|message)|send\s+that|bhej\s+do|bhejo)$/.test(t) && ctx.front && (await ctx.front().catch(() => '')).toLowerCase() === 'whatsapp') return { tool: 'whatsapp_send', args: {} };

  return null;
}

module.exports = { route, normalise, installedApps, exactApp };
