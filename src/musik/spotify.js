// Spotify cuma dipakai buat membaca judul dan artis (audionya sendiri diputar dari YouTube, Spotify tidak mengizinkan streaming lewat bot).
//  - Tanpa pengaturan apa pun: baca halaman embed Spotify (track, album, playlist, artis; playlist maksimal 100 lagu).
//  - Opsional: isi SPOTIFY_CLIENT_ID dan SPOTIFY_CLIENT_SECRET (gratis di developer.spotify.com) supaya playlist panjang dan lebih stabil.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TYPES = ['track', 'album', 'playlist', 'artist'];
const MAX_TRACKS = 200;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const timeout = () => AbortSignal.timeout(12000);

// Kenali link / URI Spotify. Hasil: { type, id } atau null.
function parse(input) {
  const s = String(input ?? '').trim();
  let m = /^spotify:(track|album|playlist|artist):([A-Za-z0-9]{10,40})$/.exec(s);
  if (m) return { type: m[1], id: m[2] };
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname) && url.hostname !== 'spotify.link') return null;
  if (url.hostname === 'spotify.link') return { type: 'short', url: s };
  m = /\/(track|album|playlist|artist)\/([A-Za-z0-9]{10,40})/.exec(url.pathname);
  return m ? { type: m[1], id: m[2] } : null;
}

// ---------- tanpa kunci: halaman embed ----------

function entityFromHtml(html) {
  const next = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (next) {
    const data = JSON.parse(next[1]);
    const entity = data?.props?.pageProps?.state?.data?.entity ?? data?.props?.pageProps?.data?.entity;
    if (entity) return entity;
  }
  const old = /<script[^>]*id="resource"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (old) {
    let raw = old[1];
    try {
      return JSON.parse(raw);
    } catch {
      raw = decodeURIComponent(raw);
      return JSON.parse(raw);
    }
  }
  throw new Error('Format halaman Spotify berubah, jadi bot belum bisa membacanya.');
}

const artistsOf = (e) => (Array.isArray(e.artists) ? e.artists.map((a) => a.name).filter(Boolean).join(', ') : clean(e.subtitle));
const imageOf = (e) => e.coverArt?.sources?.[0]?.url ?? e.visualIdentity?.image?.slice(-1)[0]?.url ?? e.images?.[0]?.url ?? e.cover?.url ?? null;

function trackFrom(item, fallbackImage, album) {
  const title = clean(item.title ?? item.name);
  const artist = clean(item.subtitle ?? artistsOf(item)).replace(/ /g, ' ');
  if (!title) return null;
  const uri = String(item.uri ?? '');
  return {
    id: /spotify:track:(\w+)/.exec(uri)?.[1] ?? item.id ?? null,
    title, artist, album: album ?? null,
    durationMs: Number(item.duration ?? item.duration_ms) || 0,
    thumbnail: imageOf(item) ?? fallbackImage,
  };
}

async function viaEmbed({ type, id }) {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: timeout(),
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'Link Spotify tidak ketemu (mungkin privat).' : `Spotify membalas ${res.status}.`);
  const entity = entityFromHtml(await res.text());
  const image = imageOf(entity);
  if (type === 'track') {
    const t = trackFrom({ ...entity, subtitle: entity.artists ? undefined : entity.subtitle }, image);
    if (!t) throw new Error('Data lagu dari Spotify kosong.');
    return { type, title: t.title, thumbnail: image, tracks: [t] };
  }
  const list = (entity.trackList ?? entity.tracks ?? []).map((i) => trackFrom(i, image, type === 'album' ? clean(entity.name ?? entity.title) : null)).filter(Boolean);
  if (!list.length) throw new Error('Daftar lagu di link ini kosong atau tidak bisa dibaca (playlist privat?).');
  return { type, title: clean(entity.name ?? entity.title), thumbnail: image, tracks: list.slice(0, MAX_TRACKS) };
}

// ---------- opsional: API resmi ----------

let token = { value: null, until: 0 };
const hasApi = () => Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

async function apiToken() {
  if (token.value && Date.now() < token.until - 30000) return token.value;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: timeout(),
  });
  if (!res.ok) throw new Error(`Login API Spotify gagal (${res.status}). Cek SPOTIFY_CLIENT_ID / SECRET.`);
  const json = await res.json();
  token = { value: json.access_token, until: Date.now() + json.expires_in * 1000 };
  return token.value;
}

async function api(path) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${await apiToken()}` }, signal: timeout() });
  if (!res.ok) throw new Error(`API Spotify membalas ${res.status}`);
  return res.json();
}

const apiTrack = (t, image, album) => ({
  id: t.id, title: clean(t.name), artist: (t.artists ?? []).map((a) => a.name).join(', '),
  album: clean(t.album?.name ?? album) || null, durationMs: t.duration_ms ?? 0, thumbnail: t.album?.images?.[0]?.url ?? image,
});

async function viaApi({ type, id }) {
  if (type === 'track') {
    const t = await api(`/tracks/${id}`);
    return { type, title: clean(t.name), thumbnail: t.album?.images?.[0]?.url ?? null, tracks: [apiTrack(t)] };
  }
  if (type === 'album') {
    const a = await api(`/albums/${id}`);
    const image = a.images?.[0]?.url ?? null;
    let page = a.tracks;
    const tracks = [];
    while (page && tracks.length < MAX_TRACKS) {
      tracks.push(...page.items.map((t) => apiTrack(t, image, a.name)));
      page = page.next ? await (await fetch(page.next, { headers: { Authorization: `Bearer ${await apiToken()}` }, signal: timeout() })).json() : null;
    }
    return { type, title: clean(a.name), thumbnail: image, tracks: tracks.slice(0, MAX_TRACKS) };
  }
  if (type === 'playlist') {
    const p = await api(`/playlists/${id}?fields=name,images`);
    const tracks = [];
    for (let offset = 0; tracks.length < MAX_TRACKS; offset += 100) {
      let page;
      try {
        page = await api(`/playlists/${id}/tracks?limit=100&offset=${offset}&fields=items(track(id,name,duration_ms,artists(name),album(name,images))),next`);
      } catch {
        page = await api(`/playlists/${id}/items?limit=100&offset=${offset}`);
      }
      tracks.push(...page.items.map((i) => i.track ?? i.item).filter((t) => t?.name).map((t) => apiTrack(t)));
      if (!page.next) break;
    }
    return { type, title: clean(p.name), thumbnail: p.images?.[0]?.url ?? null, tracks: tracks.slice(0, MAX_TRACKS) };
  }
  throw new Error('Tipe link ini hanya didukung lewat halaman embed.');
}

// Link pendek spotify.link: ikuti pengalihan sekali.
async function expand(url) {
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: timeout() });
  const loc = res.headers.get('location');
  const parsed = loc && parse(loc);
  if (!parsed || parsed.type === 'short') throw new Error('Link pendek Spotify ini tidak bisa dibuka. Pakai link open.spotify.com.');
  return parsed;
}

// Hasil: { type, title, thumbnail, tracks: [{ id, title, artist, album, durationMs, thumbnail }] }
async function resolve(input) {
  let ref = typeof input === 'string' ? parse(input) : input;
  if (!ref) throw new Error('Link Spotify tidak dikenali.');
  if (ref.type === 'short') ref = await expand(ref.url);
  if (!TYPES.includes(ref.type)) throw new Error('Tipe link Spotify ini belum didukung.');

  if (hasApi() && ref.type !== 'artist') {
    try {
      return await viaApi(ref);
    } catch (err) {
      console.error(`[musik] API Spotify gagal, pakai halaman embed: ${err.message}`);
    }
  }
  return viaEmbed(ref);
}

module.exports = { parse, resolve, hasApi, entityFromHtml, MAX_TRACKS };
