// YouTube by voice: a channel by name, a video by search, and "the second one" from the list Alfred last opened.
// It reads YouTube's own public pages (the same data the page is built from), so it needs no key and no browser setting, and
// it works in whichever browser the user is in. What it opens is a plain link; the list of videos it remembers is the list it
// fetched, never a guess about what is on the screen.
const { closest } = require('./fuzzy');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CHANNELS_ONLY = 'EgIQAg%3D%3D'; // YouTube's own "Type: Channel" search filter
const ID = /^[\w-]{6,20}$/;
const squash = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const MAX_AGE = 15 * 60 * 1000; // "the second one" stops meaning that list after a while

const ORDINALS = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5,
  sixth: 6, '6th': 6, six: 6, seventh: 7, '7th': 7, seven: 7, eighth: 8, '8th': 8, eight: 8, ninth: 9, '9th': 9, nine: 9, tenth: 10, '10th': 10, ten: 10, last: -1 };
const ordinal = (w) => { const k = String(w).toLowerCase().trim(); return k in ORDINALS ? ORDINALS[k] : /^\d{1,2}$/.test(k) ? Number(k) : null; };

// ytInitialData is a JSON object assigned inside the page.
function pageData(html) {
  const m = String(html).match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error('YouTube sent a page I could not read.');
  return JSON.parse(m[1]);
}
const collect = (x, key, out = []) => {
  if (Array.isArray(x)) x.forEach((v) => collect(v, key, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k === key) out.push(v); collect(v, key, out); }
  return out;
};
const text = (t) => (t && (t.simpleText || (t.runs || []).map((r) => r.text).join(''))) || '';

const UNITS = { K: 1e3, M: 1e6, B: 1e9 };
const subscribers = (s) => { const m = String(s || '').match(/([\d.,]+)\s*([KMB])?\s+subscribers?/i); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * (UNITS[(m[2] || '').toUpperCase()] || 1)) : 0; };

// Channels in a "channels only" search: [{ id, title, handle, subs }]
function channelsIn(data) {
  return collect(data, 'channelRenderer').map((c) => {
    const parts = [text(c.subscriberCountText), text(c.videoCountText)]; // YouTube puts the @handle and the subscriber count in either
    return { id: c.channelId, title: text(c.title), handle: parts.find((p) => p.startsWith('@')) || '', subs: subscribers(parts.find((p) => /subscribers?/i.test(p))) };
  }).filter((c) => c.id && c.title);
}
// Ordinary videos (never Shorts, never ads) in search results: [{ id, title, channel, length }]
const searchVideosIn = (data) => collect(data, 'videoRenderer').filter((v) => ID.test(v.videoId || '')).map((v) => ({ id: v.videoId, title: text(v.title), channel: text(v.ownerText), length: text(v.lengthText) }));
// A channel's Videos tab, newest first.
const channelVideosIn = (data) => collect(data, 'lockupViewModel').filter((l) => l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && ID.test(l.contentId || ''))
  .map((l) => ({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content || '', channel: '', length: '' }));

// Which channel did they mean? An exact name wins (the most-subscribed one, "David Dobrik" over "David Dobrik Too"); otherwise a
// channel whose name starts with it, the biggest first; otherwise the one that sounds closest. Never a guess below that.
function pickChannel(said, channels) {
  const q = squash(String(said).replace(/\b(?:youtube|channel|official)\b/gi, ''));
  if (!q || !channels.length) return null;
  const big = (a, b) => b.subs - a.subs;
  const exact = channels.filter((c) => squash(c.title.replace(/\bofficial\b/i, '')) === q).sort(big);
  if (exact.length) return exact[0];
  const starts = channels.filter((c) => squash(c.title).startsWith(q) || (q.length >= 4 && squash(c.title).includes(q))).sort(big);
  if (starts.length) return starts[0];
  const near = closest(said, channels.map((c) => c.title));
  return near ? channels.find((c) => c.title === near) : null;
}

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// The page in front, in the order the user sees it, read from the page itself (needs the browser's "Allow JavaScript from Apple Events"):
// [{ id, channel, title }]. Shorts, ads, the sidebar and comments are skipped. Document order is the on-screen order.
const SCREEN_JS = `(() => {
  const SKIP = 'ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytm-shorts-lockup-view-model, ytd-guide-renderer, ytd-mini-guide-renderer, #guide, ytd-comments, #movie_player, ytd-miniplayer, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-masthead';
  const out = [], seen = new Set();
  for (const card of document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model')) {
    if (card.closest(SKIP) || card.offsetParent === null || !card.getBoundingClientRect().height) continue; // hidden promos have no size
    if (card.matches('yt-lockup-view-model') && card.closest('ytd-rich-item-renderer')) continue; // counted once, through its rich item
    const text = card.textContent.replace(/\\s+/g, ' ').trim();
    if (/^\\d+\\s+videos?\\b/i.test(text) || card.querySelector('a[href*="/playlist?"]')) continue; // a playlist is not a video
    const link = card.querySelector('a[href*="/watch?v="]');
    const m = link && link.getAttribute('href').match(/[?&]v=([\\w-]{6,20})/);
    if (!m || seen.has(m[1])) continue;
    const t = card.querySelector('a#video-title, a#video-title-link, a.yt-lockup-metadata-view-model__title, h3 a, h3');
    const title = ((t && (t.getAttribute('title') || t.getAttribute('aria-label') || t.textContent)) || '').replace(/\\s+/g, ' ').trim();
    if (!title) continue;
    const c = card.querySelector('ytd-channel-name a, ytd-channel-name, #channel-name a, a[href^="/@"], a[href^="/channel/"], .yt-content-metadata-view-model__metadata-text');
    seen.add(m[1]);
    out.push(m[1] + '\\t' + (c ? c.textContent.trim().replace(/\\s+/g, ' ').replace(/^(.+?) \\1$/, '$1') : '') + '\\t' + title.slice(0, 160));
    if (out.length >= 30) break;
  }
  return out.join('\\n');
})()`;
const parseScreen = (out) => String(out).split('\n').filter((l) => l.includes('\t')).map((l) => { const [id, channel, title] = l.split('\t'); return { id, channel, title }; });
// Throws when the browser blocks JavaScript from Apple Events (browsers.js words that for the user).
const realScreen = async (browserApi, b) => parseScreen(await browserApi.runJs(b, SCREEN_JS));

module.exports = ({ fn, browser, fetchImpl = (...a) => fetch(...a), screen = (b) => realScreen(browser, b) }) => {
  const onYoutube = async (b) => !!b && /^https?:\/\/(www\.|m\.)?youtube\.com/i.test(await browser.pageUrl(b).catch(() => ''));
  let last = null; // { kind, label, videos, at }
  const remember = (kind, label, videos) => { last = { kind, label, videos, at: Date.now() }; };
  const fresh = () => !!last && Date.now() - last.at < MAX_AGE && last.videos.length > 0;

  const get = async (url) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' } });
    if (!res.ok) throw new Error(`YouTube answered ${res.status}.`);
    return pageData(await res.text());
  };
  const open = async (url, said) => { const b = await browser.current(said); await browser.openIn(url, b); return b; };

  const searchVideos = async (query) => {
    const videos = searchVideosIn(await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`));
    if (!videos.length) throw new Error(`YouTube has no videos for "${query}".`);
    return videos;
  };

  const tools = {
    youtube_channel: {
      group: 'media',
      def: fn('youtube_channel', 'Open a YouTube channel by name in the browser the user is in, on its Videos tab (newest first). Use for "open David Dobrik\'s channel", "go to MrBeast on YouTube". Afterwards "play the second video" works.',
        { name: { type: 'string' }, tab: { type: 'string', enum: ['videos', 'shorts', 'playlists', 'live'], description: 'default videos' }, browser: { type: 'string', description: 'only if the user named a browser' } }, ['name']),
      run: async ({ name, tab, browser: said }) => {
        const found = channelsIn(await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(name)}&sp=${CHANNELS_ONLY}`));
        const ch = pickChannel(name, found);
        if (!ch) throw new Error(`I could not find a YouTube channel called ${name}.`);
        const section = ['videos', 'shorts', 'playlists', 'live'].includes(tab) ? tab : 'videos';
        const b = await open(`https://www.youtube.com/channel/${ch.id}/${section}`, said);
        let latest = '';
        if (section === 'videos') {
          try { const videos = channelVideosIn(await get(`https://www.youtube.com/channel/${ch.id}/videos`)); remember('channel', ch.title, videos); latest = videos[0] ? ` Newest video: ${videos[0].title}.` : ''; } catch { /* the page is open anyway */ }
        }
        return `Opened ${ch.title}${ch.subs ? ` (${ch.handle ? ch.handle + ', ' : ''}${(ch.subs / 1e6 >= 1 ? (ch.subs / 1e6).toFixed(1) + 'M' : Math.round(ch.subs / 1e3) + 'K')} subscribers)` : ''} on the ${section} tab${b ? ` in ${b}` : ''}.${latest}`;
      },
    },
    youtube_search: {
      group: 'media',
      def: fn('youtube_search', 'Show YouTube search results for something in the browser the user is in. Afterwards "play the second one" works. To start a video straight away use youtube_play.', { query: { type: 'string' }, browser: { type: 'string', description: 'only if the user named a browser' } }, ['query']),
      run: async ({ query, browser: said }) => {
        const videos = await searchVideos(query);
        remember('search', query, videos);
        const b = await open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, said);
        return `Opened YouTube results for "${query}"${b ? ` in ${b}` : ''}. First: ${videos[0].title}${videos[0].channel ? ` (${videos[0].channel})` : ''}.`;
      },
    },
    youtube_play: {
      group: 'media',
      def: fn('youtube_play', 'Find a video on YouTube and start playing the best match right away, e.g. "play lofi hip hop on YouTube", "play the Interstellar docking scene". Says which video it started.', { query: { type: 'string' }, browser: { type: 'string', description: 'only if the user named a browser' } }, ['query']),
      run: async ({ query, browser: said }) => {
        const videos = await searchVideos(query);
        remember('search', query, videos);
        const v = videos[0];
        const b = await open(watchUrl(v.id), said);
        return `Playing "${v.title}"${v.channel ? ` by ${v.channel}` : ''}${b ? ` in ${b}` : ''}.`;
      },
    },
    youtube_play_nth: {
      group: 'media',
      def: fn('youtube_play_nth', 'Play a video from the YouTube page the user is looking at (a search, a channel, the home feed), by its position as they see it ("play the second video", "open the third one", n = -1 for the last) or by channel ("open the Multi Atoms video", with n for the 2nd from that channel). Shorts are not videos. It reads the real page, so the order is the one on screen.',
        { n: { type: 'number', description: 'position, 1 = first; default 1' }, channel: { type: 'string', description: 'only videos from this channel' }, browser: { type: 'string', description: 'only if the user named a browser' } }),
      run: async ({ n, channel, browser: said }) => {
        const b = await browser.current(said);
        const here = await onYoutube(b);
        let videos = [], source = 'list';
        let blocked = '';
        if (here) { try { videos = await screen(b); if (videos.length) source = 'screen'; } catch (e) { blocked = e.message; } }
        if (!videos.length) {
          // A YouTube page is in front but unreadable: do NOT fall back to YouTube's public order, which can differ from what the user
          // sees (that once opened the wrong video). Only without a YouTube page in front is Alfred's own list used.
          if (here) throw new Error(blocked || 'I could not read the videos on this YouTube page.');
          if (!fresh()) throw new Error('There is no YouTube page in front. Ask me to open a channel or search first.');
          videos = last.videos;
        }
        let pool = videos;
        if (channel) {
          // An exact channel name wins ("Multi Atoms" is not "Multi Atoms Plus"); otherwise the spoken name must be part of the channel's.
          const want = squash(String(channel).replace(/\b(?:the|youtube|channel|official)\b/gi, ''));
          const exact = videos.filter((v) => squash(v.channel) === want);
          pool = exact.length ? exact : videos.filter((v) => want && squash(v.channel).includes(want));
          if (!pool.length) throw new Error(`I see no video from ${channel} here. Channels on this page: ${[...new Set(videos.map((v) => v.channel).filter(Boolean))].slice(0, 6).join(', ') || 'none readable'}.`);
        }
        const count = pool.length;
        const i = Number(n) === -1 ? count : Math.round(Number(n) || 1);
        if (!(i >= 1)) throw new Error('Which one? Say first, second, third and so on.');
        const v = pool[i - 1];
        if (!v) throw new Error(`There ${count === 1 ? 'is only 1 video' : `are only ${count} videos`}${channel ? ` from ${channel}` : ''} on this page.`);
        if (source === 'screen') await browser.navigate(b, watchUrl(v.id)); else await open(watchUrl(v.id), said);
        return `Playing ${channel ? `${channel} video ` : 'video '}number ${i}${source === 'screen' ? ' on your screen' : ` from ${last.label} (YouTube's public order, which may differ from what you see)`}: "${v.title.slice(0, 90)}"${v.channel ? ` by ${v.channel}` : ''}.`;
      },
    },
    __youtube_list: { hidden: true, def: fn('__youtube_list', 'internal'), run: async () => ((fresh() || await onYoutube(await browser.current().catch(() => null))) ? 'yes' : 'no') },
  };
  return tools;
};
module.exports.pickChannel = pickChannel;
module.exports.channelsIn = channelsIn;
module.exports.searchVideosIn = searchVideosIn;
module.exports.channelVideosIn = channelVideosIn;
module.exports.pageData = pageData;
module.exports.SCREEN_JS = SCREEN_JS;
module.exports.parseScreen = parseScreen;
module.exports.subscribers = subscribers;
module.exports.ordinal = ordinal;
