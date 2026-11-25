// Lirik: cari di LRCLIB (gratis, tanpa kunci), ubah format LRC jadi baris berwaktu, dan tentukan baris mana yang sedang dinyanyikan.
const BASE = 'https://lrclib.net/api';
const UA = 'BratvaBot/2.1 (bot musik Discord; https://lrclib.net)';
const TIMEOUT = 9000;

// ---------- membersihkan judul YouTube ----------

// Kata sampah di judul video yang bikin pencarian lirik meleset.
const NOISE = /(official|video|clip|lyrics?|lirik|audio|visuali[sz]er|\bmv\b|m\/v|\bhd\b|\bhq\b|\b[48]k\b|remaster|explicit|karaoke|full album|\btopic\b|vevo|resmi|with lyrics|color coded|perform|session|\bprod\b|sub\b|subtitle|terjemahan|\bcc\b)/i;
const FEAT = /\b(?:ft|feat|featuring)\b\.?/i;

function stripBrackets(s) {
  // Buang kurung yang isinya kata sampah atau "feat", sisanya (misalnya "Taylor's Version") dipertahankan.
  return s.replace(/[(\[{【「『（][^)\]}】」』）]*[)\]}】」』）]/g, (group) => (NOISE.test(group) || FEAT.test(group) ? ' ' : group));
}

function cleanTitle(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ');
  s = stripBrackets(s);
  s = s.replace(new RegExp(`\\s*[-–—|~:]\\s*(?:${NOISE.source})[^]*$`, 'i'), ''); // "... - Official Audio"
  const feat = s.search(FEAT);
  if (feat > 0) s = s.slice(0, feat);
  return s.replace(/\s*[-–—|~]+\s*$/, '').replace(/\s+/g, ' ').trim();
}

function cleanArtist(raw) {
  return String(raw ?? '')
    .replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\s*official(?: channel)?$/i, '')
    .replace(/\s+/g, ' ').trim();
}

const firstArtist = (s) => cleanArtist(String(s ?? '').split(/\s*(?:,|&|;|\bx\b|\bfeat\.?\b|\bft\.?\b)\s*/i)[0]);

// Daftar tebakan "artis + judul" untuk dicari, yang paling yakin duluan.
function guesses(track) {
  const out = [];
  const add = (artist, title) => {
    artist = cleanArtist(artist);
    title = cleanTitle(title);
    if (!title) return;
    if (!out.some((g) => g.artist.toLowerCase() === artist.toLowerCase() && g.title.toLowerCase() === title.toLowerCase())) out.push({ artist, title });
  };

  // Data bersih dari Spotify atau metadata musik YouTube.
  if (track.artist && track.title && track.clean) add(firstArtist(track.artist), track.title);

  const cleaned = cleanTitle(track.title);
  const parts = cleaned.split(/\s+[-–—|~]\s+/);
  if (parts.length >= 2) {
    add(parts[0], parts.slice(1).join(' - '));
    add(parts[1], parts[0]); // kadang formatnya "Judul - Artis"
  }
  add(firstArtist(track.artist || track.uploader), cleaned);
  add('', cleaned);
  return out.slice(0, 4);
}

// ---------- format LRC ----------

// "[01:23.45] teks" -> [{ t: milidetik, text }]. Mendukung beberapa waktu dalam satu baris, tag [offset:], dan tag kata (LRC lanjutan).
function parseLrc(text) {
  const out = [];
  let offset = 0;
  const stamp = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const times = [];
    let rest = raw;
    for (let m = stamp.exec(rest); m; m = stamp.exec(rest)) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
      times.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + frac);
      rest = rest.slice(m[0].length);
    }
    if (!times.length) {
      const o = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
      if (o) offset = Number(o[1]);
      continue;
    }
    const line = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim();
    for (const t of times) out.push({ t, text: line });
  }
  out.sort((a, b) => a.t - b.t);
  return offset ? out.map((l) => ({ ...l, t: Math.max(0, l.t - offset) })) : out;
}

// Indeks baris terakhir yang waktunya sudah lewat (-1 kalau belum ada yang mulai). Pencarian biner.
function indexAt(lines, ms) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// Biar tanda markdown di lirik tidak merusak tampilan embed.
const esc = (s) => String(s).replace(/([\\*_~`|>[\]])/g, '\\$1').replace(/^([#-])/gm, '\\$1');
const show = (line) => (line?.text ? esc(line.text) : '♪');

// Jendela lirik: dua baris sebelumnya, baris sekarang (tebal), tiga baris berikutnya.
function windowText(lines, idx, { before = 2, after = 3 } = {}) {
  if (!lines.length) return '';
  if (idx < 0) {
    return ['*♪ ...*', ...lines.slice(0, after + 1).map((l) => show(l))].join('\n');
  }
  const out = [];
  for (let i = Math.max(0, idx - before); i < idx; i++) out.push(`*${show(lines[i])}*`);
  out.push(`**▶ ${show(lines[idx])}**`);
  for (let i = idx + 1; i <= Math.min(lines.length - 1, idx + after); i++) out.push(show(lines[i]));
  return out.join('\n');
}

// ---------- LRCLIB ----------

async function getJson(path, params) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB membalas ${res.status}`);
  return res.json();
}

const hasText = (r) => r && (r.syncedLyrics || r.plainLyrics);

// Pilih hasil terbaik: yang punya lirik berwaktu dan durasinya paling dekat.
function pick(results, wantSec) {
  const list = (Array.isArray(results) ? results : [results]).filter((r) => hasText(r) && !r.instrumental);
  if (!list.length) return null;
  const diff = (r) => (wantSec && r.duration ? Math.abs(r.duration - wantSec) : 0);
  list.sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) || diff(a) - diff(b));
  const best = list[0];
  if (wantSec && best.duration && diff(best) > 12) return null; // beda versi, kemungkinan besar lirik salah waktu
  return { record: best, approx: Boolean(wantSec && best.duration && diff(best) > 4) };
}

function shape(record, approx) {
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  return {
    id: record.id, artist: record.artistName, title: record.trackName, approx,
    synced: synced.length >= 3 ? synced : null,
    plain: record.plainLyrics ?? null,
  };
}

const cache = new Map(); // kunci lagu -> hasil (atau null kalau tidak ada)
const MISS_MS = 20 * 60 * 1000;

function remember(key, value) {
  if (cache.size >= 300) cache.delete(cache.keys().next().value);
  cache.set(key, { value, at: Date.now() });
}

// track: { key, title, artist, uploader, album, durationMs, clean }
async function find(track) {
  const key = track.key ?? `${track.artist}|${track.title}`;
  const hit = cache.get(key);
  if (hit && (hit.value || Date.now() - hit.at < MISS_MS)) return hit.value;

  const wantSec = track.durationMs ? Math.round(track.durationMs / 1000) : 0;
  let found = null;
  for (const g of guesses(track)) {
    try {
      if (g.artist && track.album && wantSec) {
        const exact = await getJson('/get', { track_name: g.title, artist_name: g.artist, album_name: track.album, duration: wantSec });
        const p = exact && hasText(exact) && !exact.instrumental ? { record: exact, approx: false } : null;
        if (p) { found = p; break; }
      }
      const res = await getJson('/search', g.artist ? { track_name: g.title, artist_name: g.artist } : { track_name: g.title });
      const p = res && pick(res, wantSec);
      if (p) { found = p; break; }
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') continue;
      throw err;
    }
  }
  // Cadangan: pencarian bebas dengan semua kata.
  if (!found) {
    const q = [guesses(track)[0]?.artist, guesses(track)[0]?.title].filter(Boolean).join(' ');
    if (q) {
      const res = await getJson('/search', { q }).catch(() => null);
      found = res && pick(res, wantSec);
    }
  }
  const value = found ? shape(found.record, found.approx) : null;
  remember(key, value);
  return value;
}

module.exports = { cleanTitle, cleanArtist, guesses, parseLrc, indexAt, windowText, esc, find, pick, cache };
