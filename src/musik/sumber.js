// Sumber lagu: ubah apa pun yang diketik member (judul, link YouTube, link Spotify, link situs lain) jadi daftar lagu yang bisa diputar.
const net = require('node:net');
const crypto = require('node:crypto');
const store = require('../store');
const alat = require('./alat');
const spotify = require('./spotify');

const FORMAT = 'bestaudio[acodec=opus]/bestaudio/best';
const STREAM_TTL = 25 * 60 * 1000; // alamat stream YouTube kadaluarsa beberapa jam, 25 menit aman
const YT_HOST = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

const cfg = () => store.loadSettings().musik;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

class MusikError extends Error {}

// ---------- pesan error yang enak dibaca ----------

function friendly(err) {
  const m = String(err?.stderr || err?.message || err);
  const rules = [
    [/sign in to confirm|not a bot|confirm you.?re not/i, 'YouTube menolak permintaan dari IP bot ini (diminta verifikasi bot). Biasanya terjadi di hosting / VPS. Solusi: taruh cookies.txt di folder data (lihat README bagian Musik).'],
    [/private video/i, 'Video ini privat.'],
    [/confirm your age|age.restricted|inappropriate for some users/i, 'Video dibatasi umur. Perlu cookies.txt dari akun yang sudah verifikasi umur.'],
    [/not available in your country|blocked it in your country|geo.?restrict/i, 'Video ini diblokir di negara tempat bot berjalan.'],
    [/members.only|join this channel/i, 'Video ini khusus member channel.'],
    [/live event will begin|premieres in|this live event/i, 'Siaran langsung / premiere ini belum mulai.'],
    [/video unavailable|not available|has been removed|no longer available|copyright/i, 'Video tidak tersedia.'],
    [/unsupported url/i, 'Link ini belum didukung. Coba link YouTube, Spotify, SoundCloud, atau ketik judul lagunya.'],
    [/kelamaan|timed? ?out/i, 'Terlalu lama menunggu balasan. Coba lagi sebentar lagi.'],
  ];
  for (const [re, text] of rules) if (re.test(m)) return text;
  return m.split('\n')[0].slice(0, 300);
}

// ---------- mengenali input ----------

function blockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(h)) return true;
  const kind = net.isIP(h);
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) return h === '::1' || h === '::' || /^(fc|fd|fe[89ab])/.test(h) || h.startsWith('::ffff:');
  return false;
}

// -> { type: 'spotify' | 'youtube-video' | 'youtube-playlist' | 'url' | 'search', ... }
function classify(input) {
  const q = clean(input).slice(0, 500);
  if (!q) throw new MusikError('Isi dulu judul lagu atau link-nya.');
  const sp = spotify.parse(q);
  if (sp) return { type: 'spotify', ref: sp };
  let url = null;
  try {
    url = new URL(q);
  } catch {
    // bukan link: pencarian judul
  }
  if (url && /^https?:$/.test(url.protocol)) {
    if (blockedHost(url.hostname)) throw new MusikError('Link ke alamat internal / lokal tidak diizinkan.');
    if (YT_HOST.test(url.hostname)) {
      const v = url.hostname.includes('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v') || /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(url.pathname)?.[1];
      const list = url.searchParams.get('list');
      const playlistId = list && !/^(RD|LL|WL|UL)/.test(list) ? list : null; // RD = mix otomatis YouTube, bukan playlist sungguhan
      if (v) return { type: 'youtube-video', url: `https://www.youtube.com/watch?v=${v}` };
      if (playlistId) return { type: 'youtube-playlist', url: `https://www.youtube.com/playlist?list=${playlistId}` };
    }
    return { type: 'url', url: url.href };
  }
  return { type: 'search', query: q.replace(/[\r\n]+/g, ' ').slice(0, 200) };
}

// ---------- yt-dlp ----------

// Jalankan fungsi yt-dlp. Kalau gagalnya tanda yt-dlp ketinggalan zaman, perbarui otomatis lalu coba sekali lagi.
async function repairing(fn) {
  await alat.ensureYtdlp();
  try {
    return await fn();
  } catch (err) {
    const updated = await alat.updateIfOutdated(err).catch(() => false);
    if (!updated) throw err;
    return fn();
  }
}

const thumbOf = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function candidateOf(e) {
  const id = e.id;
  return {
    id, url: /^https?:/.test(e.url ?? '') ? e.url : `https://www.youtube.com/watch?v=${id}`,
    title: clean(e.title), channel: clean(e.channel ?? e.uploader),
    durationMs: Math.round((Number(e.duration) || 0) * 1000),
    live: e.live_status === 'is_live' || e.is_live === true,
    thumbnail: e.thumbnails?.at(-1)?.url ?? thumbOf(id),
  };
}

async function search(query, n = 5) {
  const out = await repairing(() => alat.run(['--flat-playlist', '-J', `ytsearch${n}:${query}`], { timeout: 45000 }));
  const data = JSON.parse(out);
  return (data.entries ?? []).filter((e) => e?.id).map(candidateOf);
}

// Info satu video / link sekaligus alamat stream-nya (satu kali panggilan yt-dlp).
async function videoInfo(url) {
  const out = await repairing(() => alat.run(['-j', '--no-playlist', '-f', FORMAT, url], { timeout: 70000 }));
  const j = JSON.parse(out.trim().split('\n').find((l) => l.startsWith('{')) ?? '{}');
  if (!j.url && !j.requested_formats?.[0]?.url) throw new MusikError('yt-dlp tidak memberi alamat audio untuk link ini.');
  const fmt = j.url ? j : j.requested_formats[0];
  return {
    id: j.id, url: j.webpage_url || url, title: clean(j.title), channel: clean(j.channel ?? j.uploader),
    artist: clean(j.artist ?? j.creator ?? ''), ytTrack: clean(j.track ?? ''), album: clean(j.album ?? ''),
    durationMs: Math.round((Number(j.duration) || 0) * 1000), live: Boolean(j.is_live),
    thumbnail: j.thumbnail ?? (j.id && j.extractor_key === 'Youtube' ? thumbOf(j.id) : null),
    site: j.extractor_key ?? 'web',
    stream: { url: fmt.url, headers: fmt.http_headers ?? j.http_headers ?? {}, protocol: fmt.protocol ?? j.protocol ?? 'https', at: Date.now() },
  };
}

function overLimit(durationMs) {
  const max = Number(cfg().maksDurasiMenit) || 0;
  return max > 0 && durationMs > max * 60000;
}

// ---------- membentuk objek lagu ----------

function trackFromInfo(info, by) {
  const yt = info.site === 'Youtube';
  return {
    key: yt && info.id ? `yt:${info.id}` : `web:${crypto.createHash('sha1').update(info.url).digest('hex').slice(0, 12)}`,
    source: yt ? 'youtube' : 'web', title: info.title || 'Tanpa judul', artist: info.artist, channel: info.channel,
    album: info.album, ytTrack: info.ytTrack, durationMs: info.durationMs, live: info.live,
    thumbnail: info.thumbnail, url: info.url, lazy: false, stream: info.stream, by,
  };
}

function trackFromCandidate(c, by) {
  return {
    key: `yt:${c.id}`, source: 'youtube', title: c.title, artist: '', channel: c.channel, album: '', ytTrack: '',
    durationMs: c.durationMs, live: c.live, thumbnail: c.thumbnail, url: c.url, lazy: false, stream: null, by,
  };
}

function trackFromSpotify(t, by) {
  return {
    key: t.id ? `sp:${t.id}` : `sp:${crypto.createHash('sha1').update(`${t.artist}|${t.title}`).digest('hex').slice(0, 12)}`,
    source: 'spotify', title: t.title, artist: t.artist, channel: '', album: t.album ?? '', ytTrack: '',
    durationMs: t.durationMs, live: false, thumbnail: t.thumbnail, url: null, spotifyId: t.id,
    lazy: true, stream: null, by,
  };
}

// ---------- mencocokkan lagu Spotify ke YouTube ----------

const BAD = /(karaoke|instrumental|cover|live|remix|sped ?up|slowed|reverb|nightcore|8d|bass ?boost|tutorial|reaction|mashup|piano version|acoustic version)/i;

// Semakin tinggi semakin cocok: durasi paling dekat, kanal resmi / Topic, tanpa embel-embel versi lain.
function score(c, want) {
  let s = 0;
  if (c.live || !c.durationMs) return -100;
  if (want.durationMs) {
    const diff = Math.abs(c.durationMs - want.durationMs) / 1000;
    s -= Math.min(diff, 60);
    if (diff <= 3) s += 12;
  }
  const title = c.title.toLowerCase();
  const wantTitle = want.title.toLowerCase();
  const wantArtist = want.artist.split(',')[0].trim().toLowerCase();
  if (BAD.test(title) && !BAD.test(wantTitle)) s -= 18;
  if (wantTitle && title.includes(wantTitle)) s += 6;
  if (wantArtist && (title.includes(wantArtist) || c.channel.toLowerCase().includes(wantArtist))) s += 6;
  if (/- topic$/i.test(c.channel)) s += 6;
  if (/official/i.test(title) || /vevo$/i.test(c.channel)) s += 2;
  if (/lyrics?|lirik/i.test(title) && !/lyrics?/.test(wantTitle)) s -= 2; // video lirik kadang punya intro
  return s;
}

function bestMatch(candidates, want) {
  return candidates
    .map((c) => ({ c, s: score(c, want) }))
    .filter((x) => x.s > -100)
    .sort((a, b) => b.s - a.s)[0]?.c ?? null;
}

async function matchSpotify(track) {
  const want = { title: track.title, artist: track.artist, durationMs: track.durationMs };
  let found = await search(`${track.artist.split(',')[0]} - ${track.title}`, 6);
  let best = bestMatch(found, want);
  if (!best) {
    found = await search(`${track.title} ${track.artist} audio`, 6);
    best = bestMatch(found, want);
  }
  if (!best) throw new MusikError(`Lagu "${track.artist} - ${track.title}" tidak ketemu di YouTube.`);
  track.url = best.url;
  track.ytId = best.id;
  track.channel = best.channel;
  track.lazy = false;
  if (!track.thumbnail) track.thumbnail = best.thumbnail;
  return track;
}

// ---------- pintu masuk ----------

// Siapkan lagu supaya langsung bisa diputar: cocokkan ke YouTube (Spotify) dan ambil alamat stream-nya.
async function prepare(track, { force = false } = {}) {
  if (track.stream && !force && Date.now() - track.stream.at < STREAM_TTL) return track;
  if (track.lazy || !track.url) await matchSpotify(track);
  const info = await videoInfo(track.url);
  track.stream = info.stream;
  track.url = info.url || track.url;
  track.live = info.live;
  track.channel = track.channel || info.channel;
  track.ytTrack = track.ytTrack || info.ytTrack;
  if (!track.artist) track.artist = info.artist;
  if (!track.album) track.album = info.album;
  if (!track.thumbnail) track.thumbnail = info.thumbnail;
  if (!track.durationMs) track.durationMs = info.durationMs;
  if (info.durationMs) track.playMs = info.durationMs; // lama audio yang sebenarnya diputar
  if (overLimit(track.playMs ?? track.durationMs)) {
    track.stream = null; // supaya pengecekan ini diulang, bukan dilewati karena "sudah siap"
    throw new MusikError(`Lagu ini lebih panjang dari batas (${cfg().maksDurasiMenit} menit).`);
  }
  return track;
}

// Hasil: { kind: 'single' | 'playlist', title, thumbnail, tracks, notes[] }
async function resolve(input, by) {
  const kind = classify(input);
  const limit = Math.max(1, Number(cfg().maksAntrian) || 200);
  const notes = [];

  if (kind.type === 'spotify') {
    const meta = await spotify.resolve(kind.ref);
    let tracks = meta.tracks.map((t) => trackFromSpotify(t, by));
    if (tracks.length > limit) {
      tracks = tracks.slice(0, limit);
      notes.push(`Dibatasi ${limit} lagu pertama.`);
    }
    if (meta.type === 'artist') notes.push('Link artis: yang diputar lagu-lagu populernya.');
    return { kind: meta.type === 'track' ? 'single' : 'playlist', title: meta.title, thumbnail: meta.thumbnail, tracks, notes, from: 'Spotify' };
  }

  if (kind.type === 'youtube-playlist') {
    const out = await repairing(() => alat.run(['--flat-playlist', '-J', '--playlist-end', String(limit), kind.url], { timeout: 90000 }));
    const data = JSON.parse(out);
    const tracks = (data.entries ?? []).filter((e) => e?.id && !/private|deleted/i.test(e.title ?? '')).map((e) => trackFromCandidate(candidateOf(e), by));
    if (!tracks.length) throw new MusikError('Playlist ini kosong atau privat.');
    return { kind: 'playlist', title: clean(data.title) || 'Playlist YouTube', thumbnail: tracks[0].thumbnail, tracks, notes, from: 'YouTube' };
  }

  if (kind.type === 'search') {
    const found = await search(kind.query, 6);
    const usable = found.find((c) => !c.live && !overLimit(c.durationMs)) ?? found[0];
    if (!usable) throw new MusikError(`Tidak ada hasil untuk "${kind.query}".`);
    const info = await videoInfo(usable.url);
    return { kind: 'single', title: info.title, thumbnail: info.thumbnail, tracks: [trackFromInfo(info, by)], notes, from: 'YouTube' };
  }

  const info = await videoInfo(kind.url);
  if (overLimit(info.durationMs)) throw new MusikError(`Lagu ini lebih panjang dari batas (${cfg().maksDurasiMenit} menit).`);
  return { kind: 'single', title: info.title, thumbnail: info.thumbnail, tracks: [trackFromInfo(info, by)], notes, from: info.site === 'Youtube' ? 'YouTube' : info.site };
}

// Untuk /musik cari: beberapa hasil buat dipilih.
async function candidates(query) {
  const q = clean(query).slice(0, 200);
  if (!q) throw new MusikError('Isi kata kunci pencarian.');
  return search(q, 8);
}

async function fromCandidate(id, by) {
  const info = await videoInfo(`https://www.youtube.com/watch?v=${id}`);
  if (overLimit(info.durationMs)) throw new MusikError(`Lagu ini lebih panjang dari batas (${cfg().maksDurasiMenit} menit).`);
  return trackFromInfo(info, by);
}

module.exports = {
  MusikError, friendly, classify, blockedHost, resolve, prepare, candidates, fromCandidate, score, bestMatch,
  trackFromSpotify, trackFromCandidate,
};
