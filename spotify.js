// Spotify by exact name: "play Nights by Frank Ocean", "play the Blonde album". Needs a FREE developer key (client id and secret
// from developer.spotify.com, set as SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env) only to look the name up; playing is
// done through the Spotify app itself. Without keys, or without the app, play_music falls back to other ways.
const squash = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// "nights by frank ocean on spotify" -> { kind: 'track', title: 'nights', artist: 'frank ocean' }
function parseRequest(spoken) {
  let q = String(spoken || '').replace(/\b(?:on|in|using|with)\s+spotify\b/gi, '').replace(/^\s*(?:play\s+)?(?:the\s+)?(?:(?:song|track)\s+)?/i, '').replace(/\s+/g, ' ').trim();
  let kind = 'track';
  if (/\balbum\b/i.test(q)) { kind = 'album'; q = q.replace(/\b(?:the\s+)?album\b/gi, ''); }
  else if (/\bplaylist\b/i.test(q)) { kind = 'playlist'; q = q.replace(/\b(?:the\s+)?playlist\b/gi, ''); }
  else if (/\b(?:radio|artist)\b/i.test(q)) { kind = 'artist'; q = q.replace(/\b(?:the\s+)?(?:radio|artist)\b/gi, ''); }
  q = q.replace(/^(?:the\s+)/i, '').replace(/\s+/g, ' ').trim();
  const by = q.match(/^(.+?)\s+by\s+(.+)$/i);
  return by ? { kind, title: by[1].trim(), artist: by[2].trim() } : { kind, title: q, artist: '' };
}

// Structured first (exact title and artist), then plain words if that finds nothing close.
const queries = ({ kind, title, artist }) => {
  if (!title) return [];
  const plain = `${title} ${artist}`.trim();
  if (kind === 'track') return artist ? [`track:${title} artist:${artist}`, plain] : [title];
  if (kind === 'album') return artist ? [`album:${title} artist:${artist}`, plain] : [`album:${title}`, title];
  return [plain];
};
const nameOf = (item) => item.name || '';
const close = (want, got) => { const a = squash(want), b = squash(got); return !!a && (b === a || b.startsWith(a) || a.startsWith(b) || b.includes(a)); };

module.exports = ({ env = process.env, fetchImpl = (...a) => fetch(...a) } = {}) => {
  let token = null; // { value, until }
  const configured = () => !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
  async function getToken() {
    if (token && Date.now() < token.until) return token.value;
    const res = await fetchImpl('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials', signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'Spotify refused the developer key. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.' : `Spotify answered ${res.status}.`);
    const j = await res.json();
    token = { value: j.access_token, until: Date.now() + (Number(j.expires_in) - 60) * 1000 };
    return token.value;
  }
  // -> { uri, kind, name, artist } or null when nothing close was found.
  async function find(spoken) {
    const req = parseRequest(spoken);
    const type = req.kind === 'artist' ? 'artist' : req.kind;
    for (const q of queries(req)) {
      const res = await fetchImpl(`https://api.spotify.com/v1/search?type=${type}&limit=5&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Spotify search answered ${res.status}.`);
      const items = ((await res.json())[`${type}s`]?.items || []).filter(Boolean);
      const hit = items.find((i) => close(req.title, nameOf(i)) && (!req.artist || type === 'playlist' || close(req.artist, (i.artists || []).map((a) => a.name).join(' ')))) || (req.artist ? null : items[0]);
      if (hit) return { uri: hit.uri, kind: type, name: nameOf(hit), artist: (hit.artists || []).map((a) => a.name).join(', ') || hit.owner?.display_name || '' };
    }
    return null;
  }
  return { configured, find };
};
module.exports.parseRequest = parseRequest;
module.exports.queries = queries;
