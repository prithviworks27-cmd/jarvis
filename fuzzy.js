// Speech recognition spells unusual names by sound ("Claude" comes out as "Clawed" or "Cloud"). Compare by consonant
// skeleton, then take the closest by edit distance. Used to snap a heard name to a real app or contact.
const skeleton = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[aeiouwyh]/g, '');

// Edit distance where swapping two neighbouring letters counts as one edit.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// The candidate that sounds most like `heard`, or null. Same skeleton wins; one wrong consonant is allowed only when the
// whole words are still close, so a made-up name does not snap to something unrelated.
function closest(heard, candidates) {
  const h = String(heard).toLowerCase().replace(/\.app$/, '').trim();
  const hk = skeleton(h);
  if (hk.length < 2) return null;
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const gap = distance(hk, skeleton(c));
    const full = distance(h, c.toLowerCase());
    if (gap > 1 || (gap === 1 && (hk.length < 3 || full > 3))) continue;
    const score = gap * 100 + full;
    if (score < bestScore) { best = c; bestScore = score; }
  }
  return best;
}

module.exports = { closest };
