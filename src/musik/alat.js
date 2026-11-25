// Alat bantu mesin musik: ffmpeg dan yt-dlp. Dipasang dan diperbarui sendiri, tidak perlu instal manual.
//  - ffmpeg: dari paket ffmpeg-static (ikut npm install), atau ffmpeg di PATH, atau FFMPEG_PATH.
//  - yt-dlp: diunduh otomatis ke data/bin saat pertama kali, lalu diperbarui berkala dan otomatis saat YouTube mengubah sesuatu.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn, spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const store = require('../store');

const BIN_DIR = path.join(store.DIR, 'bin');
const CACHE_DIR = path.join(BIN_DIR, 'cache');
const IS_WIN = process.platform === 'win32';
const YTDLP_FILE = process.env.YTDLP_PATH ? path.resolve(process.env.YTDLP_PATH) : path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');

const info = {
  ytdlp: { version: null, channel: null, checkedAt: 0, updatedAt: 0, note: null, error: null, busy: false },
  ffmpeg: { path: null, version: null, libopus: false, error: null },
  flags: { jsRuntimes: false, remoteComponents: false },
};
const children = new Set(); // semua proses (ffmpeg dan yt-dlp) yang sedang jalan, dimatikan waktu bot berhenti
const ytChildren = new Set(); // khusus yt-dlp: file-nya tidak boleh diganti saat sedang dipakai

const cfg = () => store.loadSettings().musik;

// ---------- ffmpeg ----------

let ffmpegMemo;
function ffmpeg() {
  if (ffmpegMemo !== undefined) return ffmpegMemo;
  const candidates = [process.env.FFMPEG_PATH];
  try {
    candidates.push(require('ffmpeg-static'));
  } catch {
    // paket opsional, tidak masalah kalau tidak ada
  }
  candidates.push('ffmpeg');
  for (const bin of candidates.filter(Boolean)) {
    const r = spawnSync(bin, ['-version'], { timeout: 10000, windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0) continue;
    const enc = spawnSync(bin, ['-hide_banner', '-encoders'], { timeout: 10000, windowsHide: true, encoding: 'utf8' });
    info.ffmpeg = {
      path: bin, version: /version\s+(\S+)/.exec(r.stdout)?.[1] ?? '?',
      libopus: /\blibopus\b/.test(enc.stdout ?? ''), error: null,
    };
    ffmpegMemo = bin;
    return bin;
  }
  info.ffmpeg.error = 'ffmpeg tidak ketemu. Jalankan npm install (paket ffmpeg-static), atau pasang ffmpeg dan isi FFMPEG_PATH.';
  ffmpegMemo = null;
  return null;
}

// ---------- yt-dlp: unduh ----------

function assetName() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'yt-dlp_arm64.exe' : arch === 'ia32' ? 'yt-dlp_x86.exe' : 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') {
    const musl = !process.report?.getReport?.().header?.glibcVersionRuntime;
    if (arch === 'x64') return musl ? 'yt-dlp_musllinux' : 'yt-dlp_linux';
    if (arch === 'arm64') return musl ? 'yt-dlp_musllinux_aarch64' : 'yt-dlp_linux_aarch64';
    if (arch === 'arm') return 'yt-dlp_linux_armv7l';
  }
  return 'yt-dlp'; // versi Python, butuh python3 di komputernya
}

const channelName = () => (cfg().kanalYtdlp === 'stable' ? 'stable' : 'nightly');
const downloadUrl = (channel) => (channel === 'stable'
  ? `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName()}`
  : `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/${assetName()}`);

async function download() {
  const channel = channelName();
  fs.mkdirSync(path.dirname(YTDLP_FILE), { recursive: true });
  const res = await fetch(downloadUrl(channel), { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!res.ok || !res.body) throw new Error(`Unduh yt-dlp gagal (${res.status}). Cek koneksi hosting ke github.com.`);
  const tmp = `${YTDLP_FILE}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  if (fs.statSync(tmp).size < 1024 * 1024) {
    fs.rmSync(tmp, { force: true });
    throw new Error('File yt-dlp yang terunduh tidak wajar (terlalu kecil).');
  }
  if (!IS_WIN) fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, YTDLP_FILE);
  info.ytdlp.channel = channel;
}

// ---------- yt-dlp: jalankan ----------

const cookiesFile = () => {
  const candidates = [process.env.YT_COOKIES, path.join(store.DIR, 'cookies.txt')].filter(Boolean);
  return candidates.find((f) => fs.existsSync(f)) ?? null;
};

function baseArgs() {
  const args = ['--no-warnings', '--no-color', '--ignore-config', '--cache-dir', CACHE_DIR, '--socket-timeout', '20', '--retries', '3'];
  // YouTube sekarang butuh runtime JavaScript buat memecahkan tantangannya. Bot ini sudah jalan di Node, jadi dipakai.
  if (info.flags.jsRuntimes && Number(process.versions.node.split('.')[0]) >= 20) args.push('--js-runtimes', `node:${process.execPath}`);
  if (info.flags.remoteComponents) args.push('--remote-components', 'ejs:github');
  const cookies = cookiesFile();
  if (cookies) args.push('--cookies', cookies);
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  return args;
}

function lastError(stderr) {
  const lines = String(stderr ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find((l) => /^ERROR:/i.test(l)) ?? lines.at(-1) ?? 'yt-dlp gagal tanpa pesan';
  return err.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, '').slice(0, 400);
}

// Jalankan yt-dlp, hasilnya teks stdout. Gagal = Error dengan .stderr.
function run(args, { timeout = 60000, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(YTDLP_FILE, raw ? args : [...baseArgs(), ...args], {
      timeout, maxBuffer: 200 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
    }, (err, stdout, stderr) => {
      children.delete(child);
      ytChildren.delete(child);
      if (err) {
        if (err.code === 'ENOENT') readyPromise = null; // file hilang (hosting di-reset): pasang ulang di pemakaian berikutnya
        const e = new Error(err.killed ? 'yt-dlp kelamaan membalas' : lastError(stderr || err.message));
        e.stderr = String(stderr ?? '');
        e.code = err.code;
        return reject(e);
      }
      resolve(stdout);
    });
    children.add(child);
    ytChildren.add(child);
  });
}

// Untuk streaming (mode cadangan): yt-dlp menulis audio ke stdout.
function spawnStream(args) {
  const child = spawn(YTDLP_FILE, [...baseArgs(), ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  ytChildren.add(child);
  child.once('close', () => { children.delete(child); ytChildren.delete(child); });
  return child;
}

async function detectFlags() {
  try {
    const help = await run(['--help'], { raw: true, timeout: 30000 });
    info.flags.jsRuntimes = help.includes('--js-runtimes');
    info.flags.remoteComponents = help.includes('--remote-components');
  } catch {
    // dibiarkan: tanpa flag ini yt-dlp tetap jalan
  }
}

async function readVersion() {
  const out = await run(['--version'], { raw: true, timeout: 30000 });
  info.ytdlp.version = out.trim();
  return info.ytdlp.version;
}

// ---------- yt-dlp: siap dipakai dan diperbarui ----------

let readyPromise = null;

// Pastikan yt-dlp ada dan bisa jalan. Aman dipanggil berkali-kali.
function ensureYtdlp() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    info.ytdlp.busy = true;
    try {
      if (!fs.existsSync(YTDLP_FILE)) {
        if (process.env.YTDLP_PATH) throw new Error(`YTDLP_PATH menunjuk file yang tidak ada: ${YTDLP_FILE}`);
        await download();
        info.ytdlp.note = `terpasang otomatis (${info.ytdlp.channel})`;
      }
      await readVersion().catch(async (err) => {
        // File rusak (unduhan terputus dsb): unduh ulang sekali.
        if (process.env.YTDLP_PATH) throw err;
        await download();
        await readVersion();
      });
      await detectFlags();
      info.ytdlp.error = null;
    } catch (err) {
      info.ytdlp.error = err.message;
      readyPromise = null; // coba lagi di pemanggilan berikutnya
      throw err;
    } finally {
      info.ytdlp.busy = false;
    }
  })();
  return readyPromise;
}

let updating = null;
let lastForced = 0;

// Perbarui yt-dlp ke versi terbaru (kanal nightly / stable sesuai pengaturan).
function updateYtdlp({ reason = 'berkala' } = {}) {
  if (updating) return updating;
  updating = (async () => {
    await ensureYtdlp();
    if (process.env.YTDLP_PATH) return; // dikelola sendiri oleh pemilik
    if (ytChildren.size > 0 && reason === 'berkala') return 'sibuk'; // jangan ganti file yang sedang dipakai yt-dlp lain
    info.ytdlp.busy = true;
    const before = info.ytdlp.version;
    try {
      try {
        await run(['--update-to', channelName()], { raw: true, timeout: 120000 });
      } catch {
        await download(); // -U tidak jalan (mis. versi Python): unduh ulang saja
      }
      await readVersion();
      await detectFlags();
      info.ytdlp.channel = channelName();
      info.ytdlp.note = before !== info.ytdlp.version ? `diperbarui ${before} → ${info.ytdlp.version} (${reason})` : `sudah terbaru (${reason})`;
      info.ytdlp.error = null;
      console.log(`[musik] yt-dlp: ${info.ytdlp.note}`);
    } catch (err) {
      info.ytdlp.error = `update gagal: ${err.message}`;
      console.error(`[musik] yt-dlp ${info.ytdlp.error}`);
    } finally {
      info.ytdlp.checkedAt = Date.now();
      info.ytdlp.updatedAt = Date.now();
      info.ytdlp.busy = false;
    }
  })().finally(() => { updating = null; });
  return updating;
}

// Pesan error yang biasanya berarti yt-dlp sudah ketinggalan zaman. Dipakai buat update paksa lalu coba lagi.
const OUTDATED = /(unable to extract|nsig|n.?sig|signature|player response|requested format is not available|http error 403|http error 400|sabr|challenge|js runtime|po.?token|precondition check failed)/i;
const looksOutdated = (message) => OUTDATED.test(String(message ?? ''));

// Update karena gagal: paling cepat tiap 30 menit supaya tidak tumpang tindih.
async function updateIfOutdated(err) {
  if (!looksOutdated(err?.stderr || err?.message)) return false;
  if (Date.now() - lastForced < 30 * 60 * 1000 || process.env.YTDLP_PATH) return false;
  lastForced = Date.now();
  await updateYtdlp({ reason: 'otomatis setelah error' });
  return true;
}

let timer = null;
// Dipanggil saat bot menyala: pasang yt-dlp kalau belum ada, lalu cek pembaruan berkala.
function startAuto() {
  if (timer) return;
  const hours = Math.max(1, Number(cfg().updateJam) || 12);
  ffmpeg();
  ensureYtdlp()
    .then(() => (cfg().updateOtomatis !== false ? updateYtdlp({ reason: 'saat bot menyala' }) : null))
    .catch((err) => console.error(`[musik] ${err.message}`));
  const tick = () => {
    if (!cfg().aktif || cfg().updateOtomatis === false) return;
    // Kalau yt-dlp sedang dipakai, coba lagi 2 menit kemudian (bot yang memutar musik terus tetap kebagian update).
    updateYtdlp().then((r) => { if (r === 'sibuk') setTimeout(tick, 120e3).unref(); }).catch(() => {});
  };
  timer = setInterval(tick, hours * 3600e3);
  timer.unref();
}

function killAll() {
  for (const child of children) {
    try { child.kill('SIGKILL'); } catch { /* sudah mati */ }
  }
  children.clear();
}

module.exports = {
  info, BIN_DIR, ffmpeg, ensureYtdlp, updateYtdlp, updateIfOutdated, looksOutdated, startAuto, killAll,
  run, spawnStream, baseArgs, cookiesFile, lastError, assetName, children, ytChildren,
};
