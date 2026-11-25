// Data game & level di data/game.json: XP, koin, klaim harian, tangan blackjack dan permainan XO yang sedang berjalan, soal kuis buatan pengelola.
// Ditulis tertunda lewat src/db.js dan ikut Backup. Semua perubahan koin terjadi di satu langkah sinkron (tidak ada await di tengah),
// jadi taruhan dan hadiah tidak bisa ganda walau banyak orang menekan tombol bersamaan.
const store = require('../store');
const db = require('../db').open(store.FILES.game, () => ({}));

const KOIN_AWAL = 100;
const MAKS_KOIN = 1_000_000_000_000; // batas wajar supaya angka tidak meluap
const namaDari = (user) => String(user?.displayName ?? user?.globalName ?? user?.username ?? user?.tag ?? '').slice(0, 40);

function guild(guildId) {
  const g = (db.data[guildId] ??= {});
  g.pemain ??= {};
  g.bj ??= {}; // userId -> tangan blackjack yang sedang berjalan
  g.xo ??= {}; // id permainan -> tantangan / permainan XO
  g.soal ??= []; // soal kuis buatan pengelola
  return g;
}

// Data satu pemain; dibuat saat pertama dipakai (modal awal KOIN_AWAL).
function pemain(guildId, user) {
  const g = guild(guildId);
  const p = (g.pemain[user.id] ??= { xp: 0, koin: KOIN_AWAL, pesan: 0, main: 0, menang: 0, harian: null, nama: namaDari(user) });
  const nama = namaDari(user);
  if (nama && p.nama !== nama) p.nama = nama;
  return p;
}

// Lihat tanpa membuat data baru (untuk /rank dan /koin milik orang lain).
const lihat = (guildId, userId) => guild(guildId).pemain[userId] ?? null;
const semua = (guildId) => Object.entries(guild(guildId).pemain).map(([id, p]) => ({ id, ...p }));
function hapusPemain(guildId, userId) {
  const g = guild(guildId);
  if (!g.pemain[userId]) return false;
  delete g.pemain[userId];
  db.save();
  return true;
}

// Peringkat (1 = teratas) berdasarkan XP atau koin. Seri diurutkan dari yang paling dulu terdaftar (urutan di file).
function urutan(guildId, kunci = 'xp') {
  return semua(guildId).filter((p) => p[kunci] > 0).sort((a, b) => b[kunci] - a[kunci]);
}
const peringkat = (guildId, userId, kunci = 'xp') => {
  const i = urutan(guildId, kunci).findIndex((p) => p.id === userId);
  return i < 0 ? null : i + 1;
};

// ---------- koin ----------

const koin = (guildId, user) => pemain(guildId, user).koin;

function tambahKoin(guildId, user, n) {
  const p = pemain(guildId, user);
  p.koin = Math.min(MAKS_KOIN, Math.max(0, p.koin + Math.trunc(n)));
  db.save();
  return p.koin;
}

// Kurangi koin hanya kalau cukup. Mengembalikan true kalau berhasil.
function kurangiKoin(guildId, user, n) {
  const p = pemain(guildId, user);
  n = Math.trunc(n);
  if (!(n >= 0) || p.koin < n) return false;
  p.koin -= n;
  db.save();
  return true;
}

// Catat hasil satu permainan untuk statistik.
function catatMain(guildId, user, menang) {
  const p = pemain(guildId, user);
  p.main += 1;
  if (menang) p.menang += 1;
  db.save();
}

// ---------- soal kuis buatan pengelola ----------

const MAKS_SOAL = 50;
function tambahSoal(guildId, soal) {
  const g = guild(guildId);
  if (g.soal.length >= MAKS_SOAL) return false;
  g.soal.push(soal);
  db.save();
  return true;
}
function hapusSoal(guildId, nomor) {
  const g = guild(guildId);
  if (!(nomor >= 1 && nomor <= g.soal.length)) return null;
  const [s] = g.soal.splice(nomor - 1, 1);
  db.save();
  return s;
}

module.exports = {
  KOIN_AWAL, MAKS_KOIN, MAKS_SOAL, guild, pemain, lihat, semua, hapusPemain, urutan, peringkat,
  koin, tambahKoin, kurangiKoin, catatMain, tambahSoal, hapusSoal,
  save: () => db.save(), flush: () => db.flush(), db,
};
