// Works with whichever browser the user is in: Safari or a Chromium one (Chrome, Brave, Edge, Vivaldi), not only Chrome.
// "The browser I'm working in" = the front app if it is a browser, else the last browser the user was in when they spoke to
// Alfred, else any running browser. Browser names in scripts come only from the list below, never from the model.
const CHROMIUM = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Vivaldi', 'Chromium'];
const BROWSERS = ['Safari', ...CHROMIUM];
const SAID = { chrome: 'Google Chrome', 'google chrome': 'Google Chrome', brave: 'Brave Browser', edge: 'Microsoft Edge', 'microsoft edge': 'Microsoft Edge', safari: 'Safari', vivaldi: 'Vivaldi', chromium: 'Chromium' };

// "chrome", "Brave", "Google Chrome" -> the app's real name; anything else -> null.
const canonical = (name) => {
  const n = String(name || '').toLowerCase().replace(/\bbrowser\b/, '').trim();
  return BROWSERS.find((b) => b.toLowerCase() === String(name || '').toLowerCase()) || SAID[n] || null;
};
const isBrowser = (app) => !!canonical(app);
const isChromium = (b) => CHROMIUM.includes(b);

const words = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const STOP = new Set(['my', 'the', 'a', 'an', 'to', 'tab', 'tabs', 'in', 'on', 'of', 'page', 'website', 'site', 'switch', 'go', 'open', 'back', 'browser', 'window', 'wala', 'vala', 'pe', 'par', 'ka', 'ki', ...Object.keys(SAID).flatMap(words)]);
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// How well a tab fits what was said, 0..1. Speech mishears ("DSC Unit 1" for "DSA Unit 1"), so near words count for a bit less.
function tabScore(tab, query) {
  const q = words(query).filter((w) => !STOP.has(w));
  if (!q.length) return 0;
  const host = (() => { try { return new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const have = [...words(tab.title), ...words(host)];
  const one = (w) => (have.includes(w) ? 1
    : have.some((h) => (w.length >= 3 && h.startsWith(w)) || (h.length >= 3 && w.startsWith(h))) ? 0.85
      : w.length >= 3 && have.some((h) => h.length >= 3 && lev(w, h) <= 1) ? 0.6 : 0);
  return q.reduce((s, w) => s + one(w), 0) / q.length;
}
const bestTab = (tabs, query) => {
  const scored = tabs.map((t) => ({ ...t, score: tabScore(t, query) })).sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 0.6 ? scored[0] : null;
};

module.exports = ({ run, osa }) => {
  let last = null; // the browser the user was last in when they spoke to Alfred
  const frontApp = () => osa('tell application "System Events" to get name of first application process whose frontmost is true');
  const isRunning = (b) => run('pgrep', ['-x', b]).then(() => true, () => false);
  const running = async () => (await Promise.all(BROWSERS.map(async (b) => ((await isRunning(b)) ? b : null)))).filter(Boolean);

  // Called when the user starts talking (Alfred's window never takes focus, so the front app is the one they are using).
  const noteFront = async () => { try { const b = canonical(await frontApp()); if (b) last = b; } catch { /* no access yet */ } };

  // The browser to act in. `said` = a browser the user named ("on Safari"), which always wins.
  async function current(said) {
    const named = canonical(said);
    if (said && !named) throw new Error(`I do not know a browser called ${said}. I can use ${BROWSERS.join(', ')}.`);
    if (named) return named;
    const front = canonical(await frontApp().catch(() => ''));
    if (front) return front;
    const live = await running();
    if (last && live.includes(last)) return last;
    return live[0] || null;
  }

  // Every tab of one browser: [{ browser, w, t, title, url }]. Separator is a tab character, made outside the tell block
  // because "tab" means something else inside Safari's.
  async function listTabs(b) {
    if (!BROWSERS.includes(b)) return [];
    const out = await osa(`set sep to ASCII character 9
set out to ""
tell application "${b}"
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set out to out & wi & sep & ti & sep & (${b === 'Safari' ? 'name' : 'title'} of t) & sep & (URL of t) & linefeed
    end repeat
  end repeat
end tell
return out`).catch(() => '');
    return out.split('\n').filter(Boolean).map((line) => { const [w, t, title, url] = line.split('\t'); return { browser: b, w: Number(w), t: Number(t), title, url }; })
      .filter((x) => x.w > 0 && x.t > 0);
  }

  async function showTab({ browser: b, w, t }) {
    if (!BROWSERS.includes(b) || !Number.isInteger(w) || !Number.isInteger(t)) throw new Error('Bad tab.');
    await osa(b === 'Safari'
      ? `tell application "Safari"\nset current tab of window ${w} to tab ${t} of window ${w}\nset index of window ${w} to 1\nactivate\nend tell`
      : `tell application "${b}"\nset active tab index of window ${w} to ${t}\nset index of window ${w} to 1\nactivate\nend tell`);
  }

  // Finds the tab in the current browser first, then in the other open ones, and brings it (and its browser) to the front.
  async function switchTab(query, said) {
    const first = await current(said);
    const order = said ? [first] : [...new Set([first, last, ...await running()].filter(Boolean))];
    if (!order.length) throw new Error('No browser is open.');
    for (const b of order) {
      const hit = bestTab(await listTabs(b), query);
      if (hit) { await showTab(hit); return `Switched to "${hit.title}" in ${b}.`; }
    }
    const seen = (await Promise.all(order.map(listTabs))).flat().slice(0, 15).map((x) => `${x.title} (${x.browser})`);
    throw new Error(`No open tab matches "${query}". Open tabs: ${seen.join(' | ') || 'none'}`);
  }

  const pageUrl = (b) => osa(b === 'Safari' ? 'tell application "Safari" to return URL of current tab of front window' : `tell application "${b}" to return URL of active tab of front window`);
  // Runs page JavaScript in the front tab; both browsers need their "Allow JavaScript from Apple Events" setting for this.
  async function runJs(b, js) {
    try {
      return await osa(b === 'Safari'
        ? 'on run argv\ntell application "Safari" to do JavaScript (item 1 of argv) in current tab of front window\nend run'
        : `on run argv\ntell application "${b}" to tell active tab of front window to execute javascript (item 1 of argv)\nend run`, js);
    } catch (e) {
      if (/turned off|not allowed|Allow JavaScript/i.test(e.message)) {
        throw new Error(b === 'Safari' ? 'Safari is blocking this. The user must turn on Develop > Allow JavaScript from Apple Events in Safari (Settings > Advanced > Show features for web developers first).'
          : `${b} is blocking this. The user must turn on View > Developer > Allow JavaScript from Apple Events in ${b}.`);
      }
      throw e;
    }
  }
  // The visible text of the front tab. Safari gives it without any setting; Chromium browsers need JavaScript from Apple Events.
  async function pageText(b) {
    if (b === 'Safari') return osa('tell application "Safari" to return (name of current tab of front window) & linefeed & (text of current tab of front window)');
    return runJs(b, "document.title + '\\n' + document.body.innerText.slice(0, 40000)");
  }
  // Opens a URL in a given browser (or the default one).
  const openIn = async (url, b) => { await run('open', b ? ['-a', b, url] : [url]); };

  return { current, noteFront, listTabs, switchTab, pageUrl, pageText, runJs, openIn, isBrowser, canonical };
};
module.exports.tabScore = tabScore;
module.exports.bestTab = bestTab;
module.exports.canonical = canonical;
module.exports.BROWSERS = BROWSERS;
