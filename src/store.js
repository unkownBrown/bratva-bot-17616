const fs = require('node:fs');
const path = require('node:path');

// Semua data (teks panel, pengaturan, data anggota, gambar) ada di satu folder.
// Di hosting yang punya disk permanen, arahkan dengan environment variable DATA_DIR.
const BUNDLED = path.join(__dirname, '..', 'data');
const DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : BUNDLED;
const FILES = {
  content: path.join(DIR, 'content.json'),
  backup: path.join(DIR, 'content.bak.json'),
  state: path.join(DIR, 'state.json'),
  settings: path.join(DIR, 'settings.json'),
  members: path.join(DIR, 'members.json'),
  moderasi: path.join(DIR, 'moderasi.json'),
  komunitas: path.join(DIR, 'komunitas.json'),
  bursa: path.join(DIR, 'bursa.json'),
  game: path.join(DIR, 'game.json'),
};

// Mode manual: tidak ada yang memposting, bikin role, atau bikin channel sendiri sampai kamu menyalakannya lewat Pengaturan.
const DEFAULT_SETTINGS = {
  versi: 2,
  otomatis: { panel: false },
  logs: { aktif: false, channel: 'logs-anggota', akunBaruHari: 7, keluarCepatJam: 24, invite: true, raid: { aktif: true, jumlah: 5, detik: 60 } },
  roster: { aktif: false, channel: 'list-anggota', role: ['godfather', 'underboss', 'moderator', 'gangster'] },
  aktivitas: { aktif: false, channel: 'activity-anggota', hari: 7, tidakAktifHari: 14, top: 10 },
  backup: { aktif: false, jam: 6, channel: 'panel-backup' },
  status: { aktif: true, bio: false, teks: '{online} online · {anggota} anggota', bioTeks: '{server} · {online} online dari {total} member. Ketik /panel.', menit: 5, bioMenit: 30 },
  // Musik (YouTube / Spotify + lirik berjalan). Mati sampai dinyalakan di Pengaturan.
  musik: {
    aktif: false, lirik: true, maksAntrian: 200, maksDurasiMenit: 180, diamMenit: 3, kosongDetik: 60,
    updateOtomatis: true, updateJam: 12, kanalYtdlp: 'nightly',
  },
  // Moderasi: peringatan lewat DM, timeout / kick / ban, riwayat kasus. Mati sampai dinyalakan di Pengaturan -> Fitur lainnya.
  moderasi: {
    aktif: false, channel: 'logs-moderasi', dm: true, tampilkanModerator: true, kedaluwarsaHari: 0,
    eskalasi: { aktif: false, aturan: [{ jumlah: 3, aksi: 'timeout', menit: 60 }, { jumlah: 5, aksi: 'kick' }, { jumlah: 7, aksi: 'ban' }] },
    alasanCepat: ['Spam', 'Kata kasar / toxic', 'Promosi tanpa izin', 'Mengganggu member lain', 'Melanggar aturan channel'],
  },
  // Auto-moderasi: hapus pesan yang melanggar, kirim DM, dan (kalau mau) tambah peringatan.
  automod: {
    aktif: false, peringatan: true, balasChannel: true,
    invite: true, link: false, linkIzin: ['youtube.com', 'youtu.be', 'tenor.com', 'giphy.com', 'discord.com'],
    kata: false, kataDaftar: [], mention: true, mentionMaks: 5,
    flood: true, floodPesan: 6, floodDetik: 8, floodTimeoutMenit: 5,
    kapital: false, kapitalPersen: 70, kapitalMin: 15,
    abaikanChannel: [], abaikanRole: [],
  },
  sambutan: {
    aktif: false, channel: 'selamat-datang', pesan: 'Selamat datang {user} di **{server}**! Kamu member ke-{jumlah}.',
    keluar: false, pesanKeluar: '{nama} keluar dari server.',
    dm: false, pesanDm: 'Hai {nama}, selamat datang di **{server}**! Baca aturan dulu ya sebelum ngobrol.',
    roleOtomatis: [],
  },
  // Poll, giveaway, pengingat, AFK, /info, /umumkan.
  komunitas: { aktif: false, afk: true },
  // Bursa harga Disnaker: daftar harga, catat penjualan, total penghasilan, rekap mingguan otomatis.
  // role = siapa yang boleh mencatat penjualan (kosong = semua member). channel = log penjualan dan rekap.
  bursa: { aktif: false, channel: 'logs-bursa', log: true, rekapMingguan: true, role: [] },
  // Level: XP dari chat dan voice, naik level, hadiah role. channel = tempat pengumuman naik level (kosong / tidak ketemu = di channel tempat orang ngobrol).
  // hadiah = [{ level, role }]. abaikanChannel = channel yang chat-nya tidak dihitung XP.
  level: {
    aktif: false, channel: 'level-up', umumkan: true, voice: true,
    xpMin: 15, xpMaks: 25, jedaDetik: 60, xpVoice: 5, abaikanChannel: [], hadiah: [],
  },
  // Game dan koin: slot, dadu, lempar koin, suit, XO, kuis, blackjack. channelBoleh = kosong berarti boleh di semua channel.
  game: { aktif: false, channelBoleh: [], taruhanMaks: 5000, harian: 200, kuis: 50, koinNaikLevel: 50 },
  // Log voice (masuk / keluar voice). Nama "pesan" dipertahankan supaya pengaturan lama dan channel yang sudah dihubungkan tetap jalan.
  pesan: { aktif: false, channel: 'logs-pesan', abaikanBot: true },
  // Log share screen: siapa mulai / selesai share screen di voice dan berapa lama (bot tidak bisa merekam videonya). tundaDetik = share yang lebih singkat dari ini tidak diumumkan.
  layar: { aktif: false, channel: 'video-recorder', abaikanBot: true, tundaDetik: 5 },
};

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`${path.basename(file)} formatnya salah (${err.message}). Cek koma / tanda kutip.`);
  }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Dipanggil sekali waktu bot nyala. Kalau DATA_DIR kosong (disk baru), isi bawaan disalin dulu.
function ensureData() {
  fs.mkdirSync(path.join(DIR, 'assets'), { recursive: true });
  if (DIR === BUNDLED) return;
  for (const name of ['content.json', 'settings.json']) {
    const target = path.join(DIR, name);
    const bundled = path.join(BUNDLED, name);
    // Isi bawaan tidak selalu ada (zip update tidak membawa data/). Disk kosong tanpa bawaan dipulihkan dari cadangan di channel panel-backup.
    if (!fs.existsSync(target) && fs.existsSync(bundled)) fs.copyFileSync(bundled, target);
  }
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) out[k] = isPlain(v) && isPlain(base[k]) ? merge(base[k], v) : v;
  return out;
}

// content.json dibaca ulang tiap dipakai, jadi habis diedit tidak perlu restart bot.
function loadContent() {
  const content = read(FILES.content, null);
  if (!content || typeof content.panels !== 'object') {
    throw new Error('content.json tidak valid: harus punya bagian "panels".');
  }
  content.meta ??= {};
  return content;
}

function saveContent(content) {
  if (fs.existsSync(FILES.content)) fs.copyFileSync(FILES.content, FILES.backup);
  write(FILES.content, content);
}

// Update dari versi lama (yang serba otomatis): sekali saja semua fitur yang memposting sendiri dimatikan.
// Kamu nyalakan lagi satu per satu lewat Pengaturan.
function loadSettings() {
  const raw = read(FILES.settings, {});
  const settings = merge(DEFAULT_SETTINGS, raw);
  if (raw.versi !== 2) {
    for (const mod of ['logs', 'roster', 'aktivitas', 'backup', 'pesan']) settings[mod].aktif = false;
    settings.otomatis.panel = false;
    settings.versi = 2;
    write(FILES.settings, settings);
  }
  return settings;
}
// Untuk jalur yang dipanggil di tiap pesan (auto-moderasi, AFK): hasil dipakai ulang 2 detik supaya disk tidak dibaca terus. Jangan diubah isinya.
let peeked = { at: 0, value: null };
function peekSettings() {
  const now = Date.now();
  if (!peeked.value || now - peeked.at > 2000) peeked = { at: now, value: loadSettings() };
  return peeked.value;
}
const saveSettings = (settings) => {
  peeked = { at: 0, value: null };
  write(FILES.settings, settings);
};

function loadState() {
  const state = read(FILES.state, {});
  state.panels ??= {};
  state.access ??= {};
  state.modules ??= {};
  state.boards ??= {};
  state.roleMenus ??= {};
  state.arahan ??= {};
  state.seen ??= {};
  state.forms ??= {};
  state.requests ??= {};
  return state;
}

const saveState = (state) => write(FILES.state, state);

module.exports = {
  DIR, FILES, DEFAULT_SETTINGS, read, write, ensureData,
  loadContent, saveContent, loadSettings, peekSettings, saveSettings, loadState, saveState,
};
