// Menyalakan dan menjaga bot di dalam server Netlify (Early Access). Tidak ada yang spesifik Discord di sini:
// loadBot() memberi objek { start, stop } (index.js di akar proyek), env dan log bisa diganti supaya mudah diuji.
//
// Cara kerjanya:
// - Server Netlify berhenti sendiri setelah 5 menit tanpa permintaan, kecuali ada pekerjaan yang dititipkan lewat context.waitUntil().
//   Selama bot menyala, setiap permintaan menitipkan satu promise "umur bot" yang baru selesai kalau bot berhenti.
// - Fungsi terjadwal jaga-bot.mjs memanggil /status tiap beberapa menit. Kalau server sudah mati (ganti instance tiap maksimal 8 jam,
//   deploy baru, atau crash), panggilan itu menyalakannya lagi dan bot ikut menyala.
// - Saat Netlify mematikan instance, shutdown() menyimpan data, memutus Discord, lalu melepas promise tadi.

export const ULANG_GAGAL_MS = 60_000; // jeda minimal antar percobaan login ulang di instance yang sama

export function createHost({ loadBot, env = process.env, log = console, now = Date.now, ulangMs = ULANG_GAGAL_MS, restartMs = 1000 }) {
  let state = 'idle'; // idle | starting | running | failed | stopping | stopped
  let reason = null; // 'token' | 'login'
  let bot = null;
  let lastTry = 0;
  let booting = null;
  let paused = false; // dimatikan dari dashboard: penjaga 3 menit tidak boleh menyalakan lagi
  let lifetime = Promise.resolve();
  let release = () => {};

  const alive = () => state === 'starting' || state === 'running';

  function boot() {
    if (booting) return booting;
    if (paused) return Promise.resolve();
    if (state === 'starting' || state === 'running' || state === 'stopping') return Promise.resolve();
    if (state === 'failed' && now() - lastTry < ulangMs) return Promise.resolve();
    lastTry = now();
    state = 'starting';
    reason = null;
    lifetime = new Promise((resolve) => { release = resolve; });
    booting = (async () => {
      await null; // mulai di tick berikutnya: kalau gagal seketika, finally di bawah tidak boleh jalan sebelum `booting` terisi
      try {
        if (!env.DISCORD_TOKEN) {
          const err = new Error('DISCORD_TOKEN belum diisi di Netlify (Site configuration → Environment variables).');
          err.code = 'NO_TOKEN';
          throw err;
        }
        bot ??= await loadBot();
        await bot.start({ onRestart });
        state = 'running';
        log.log('[netlify] bot menyala');
      } catch (err) {
        state = 'failed';
        reason = err.code === 'NO_TOKEN' ? 'token' : 'login';
        log.error(`[netlify] bot gagal menyala: ${err.message}`);
        release(); // gagal: jangan tahan instance, biar berhenti dan dicoba lagi oleh panggilan penjaga berikutnya
      } finally {
        booting = null;
      }
    })();
    return booting;
  }

  // Bot minta restart (setelah menyimpan data dan memutus Discord): nyalakan lagi di proses yang sama.
  function onRestart() {
    state = 'stopped';
    release();
    const t = setTimeout(() => { boot(); }, restartMs);
    t.unref?.();
  }

  async function shutdown() {
    if (state === 'stopping') return;
    const was = state;
    state = 'stopping';
    try {
      await booting;
      if (bot && (was === 'running' || was === 'starting')) await bot.stop('Netlify');
    } catch (err) {
      log.error(`[netlify] gagal berhenti rapi: ${err.message}`);
    }
    state = 'stopped';
    release();
  }

  const teks = () => ({
    idle: 'belum menyala',
    starting: 'sedang menyala',
    running: 'nyala',
    failed: reason === 'token' ? 'gagal: DISCORD_TOKEN belum diisi' : 'gagal login (lihat log fungsi di Netlify)',
    stopping: 'sedang berhenti',
    stopped: 'berhenti',
  })[state];

  // Bangunkan bot (kalau tidak dimatikan dari dashboard) dan titipkan umur bot supaya server tidak dianggap diam.
  function touch(context) {
    boot(); // tidak ditunggu: permintaan dijawab langsung, bot menyala di belakang
    if (alive()) context?.waitUntil?.(lifetime);
  }

  // Dipakai dashboard web: matikan bot dan tahan penjaga, atau nyalakan lagi.
  async function stopBot() {
    paused = true;
    await booting;
    if (state === 'running' || state === 'starting') await shutdown();
  }

  async function startBot() {
    paused = false;
    if (state === 'stopping') await shutdown();
    if (state === 'stopped' || state === 'failed' || state === 'idle') {
      state = 'idle';
      lastTry = 0;
      await boot();
    }
  }

  async function handler(req, context) {
    const { pathname } = new URL(req.url);
    touch(context);
    if (pathname !== '/' && pathname !== '/status') return new Response('Tidak ada.', { status: 404 });
    return new Response(`bratva-bot: ${teks()}\n`, {
      status: state === 'failed' ? 503 : 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return { boot, shutdown, handler, touch, stopBot, startBot, getBot: () => bot, paused: () => paused, state: () => state, alive };
}
