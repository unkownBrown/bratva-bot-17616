// Logika murni semua game (tanpa Discord, tanpa data) supaya gampang dites. Semua yang mengundi menerima `acak(n)` = bilangan bulat 0..n-1.
const crypto = require('node:crypto');

const acak = (n) => crypto.randomInt(n);

function kocok(arr, rng = acak) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- slot ----------
// Tiga gulungan. Dua gambar sama = taruhan kembali, tiga gambar sama = hadiah berlipat. Peluang kembali sekitar 93%.

const ISI = [['🍒', 8], ['🍋', 6], ['🍇', 4], ['🔔', 3], ['⭐', 2], ['💎', 1]]; // gambar dan berapa kali muncul di satu gulungan (24 posisi)
const STRIP = ISI.flatMap(([s, n]) => Array(n).fill(s));
const KALI_SLOT = { '🍒': 5, '🍋': 8, '🍇': 12, '🔔': 20, '⭐': 40, '💎': 100 };

function nilaiSlot(g) {
  const [a, b, c] = g;
  if (a === b && b === c) return { kali: KALI_SLOT[a], jenis: 'tiga' };
  if (a === b || b === c || a === c) return { kali: 1, jenis: 'pasang' };
  return { kali: 0, jenis: 'kalah' };
}

function putarSlot(rng = acak) {
  const gulungan = [0, 1, 2].map(() => STRIP[rng(STRIP.length)]);
  return { gulungan, ...nilaiSlot(gulungan) };
}

// ---------- dadu ----------
// Dua dadu. Kecil (2-6) dan besar (8-12) dibayar 2x, tujuh dibayar 5x. Peluang kembali sekitar 83%.

const PILIHAN_DADU = { kecil: { nama: 'Kecil (2-6)', kali: 2 }, tujuh: { nama: 'Tujuh', kali: 5 }, besar: { nama: 'Besar (8-12)', kali: 2 } };
const kelompokDadu = (total) => (total < 7 ? 'kecil' : total === 7 ? 'tujuh' : 'besar');

function lemparDadu(pilihan, rng = acak) {
  const d = [rng(6) + 1, rng(6) + 1];
  const total = d[0] + d[1];
  const jatuh = kelompokDadu(total);
  const menang = jatuh === pilihan;
  return { dadu: d, total, jatuh, menang, kali: menang ? PILIHAN_DADU[pilihan].kali : 0 };
}

// ---------- lempar koin ----------
// Kepala atau ekor, dibayar 2x. Satu dari 50 lemparan koinnya menggelinding hilang (kalah).

function lemparKoin(pilihan, rng = acak) {
  const r = rng(100);
  const sisi = r < 2 ? 'hilang' : r < 51 ? 'kepala' : 'ekor';
  const menang = sisi === pilihan;
  return { sisi, menang, kali: menang ? 2 : 0 };
}

// ---------- suit ----------

const SUIT = ['batu', 'gunting', 'kertas'];
const MENGALAHKAN = { batu: 'gunting', gunting: 'kertas', kertas: 'batu' };

function mainSuit(pilihan, rng = acak) {
  const bot = SUIT[rng(3)];
  const hasil = pilihan === bot ? 'seri' : MENGALAHKAN[pilihan] === bot ? 'menang' : 'kalah';
  return { bot, hasil, kali: hasil === 'menang' ? 2 : hasil === 'seri' ? 1 : 0 };
}

// ---------- XO (tic-tac-toe) ----------
// Papan = string 9 karakter: ' ' kosong, 'X', 'O'.

const GARIS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const papanKosong = () => ' '.repeat(9);

function pemenangXo(papan) {
  for (const [a, b, c] of GARIS) if (papan[a] !== ' ' && papan[a] === papan[b] && papan[b] === papan[c]) return { simbol: papan[a], garis: [a, b, c] };
  return null;
}
const penuhXo = (papan) => !papan.includes(' ');

function langkahXo(papan, pos, simbol) {
  if (!Number.isInteger(pos) || pos < 0 || pos > 8 || papan[pos] !== ' ') return null;
  return papan.slice(0, pos) + simbol + papan.slice(pos + 1);
}

// ---------- blackjack ----------
// Kartu 0..51: nomor % 13 = peringkat (0 = As, 9-12 = 10 J Q K), nomor / 13 = jenis. Bandar berhenti di 17 (termasuk 17 lunak).

const PERINGKAT = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const JENIS = ['♠', '♥', '♦', '♣'];
const teksKartu = (c) => `${PERINGKAT[c % 13]}${JENIS[Math.floor(c / 13)]}`;
const nilaiKartu = (c) => { const r = c % 13; return r === 0 ? 11 : r >= 9 ? 10 : r + 1; };

function nilaiTangan(kartu) {
  let total = 0;
  let as = 0;
  for (const c of kartu) {
    total += nilaiKartu(c);
    if (c % 13 === 0) as += 1;
  }
  while (total > 21 && as > 0) {
    total -= 10;
    as -= 1;
  }
  return { total, lunak: as > 0 };
}

const blackjackAlami = (kartu) => kartu.length === 2 && nilaiTangan(kartu).total === 21;

// Mulai tangan baru: dua kartu untuk pemain dan bandar. Mengembalikan state yang bisa disimpan di JSON.
function mulaiBj(taruhan, rng = acak) {
  const dek = kocok([...Array(52).keys()], rng);
  const s = { taruhan, dek, pemain: [], bandar: [], selesai: false, ganda: false };
  s.pemain.push(dek.pop());
  s.bandar.push(dek.pop());
  s.pemain.push(dek.pop());
  s.bandar.push(dek.pop());
  if (blackjackAlami(s.pemain) || blackjackAlami(s.bandar)) s.selesai = true;
  return s;
}

function tarikBj(s) {
  s.pemain.push(s.dek.pop());
  if (nilaiTangan(s.pemain).total >= 21) s.selesai = true;
  return s;
}

// Bandar menarik sampai minimal 17, lalu tangan dinilai.
function bandarMain(s) {
  while (nilaiTangan(s.bandar).total < 17) s.bandar.push(s.dek.pop());
  s.selesai = true;
  return s;
}

// Hasil akhir dan total koin yang dikembalikan ke pemain (taruhan sudah dipotong di awal).
function hasilBj(s) {
  const p = nilaiTangan(s.pemain).total;
  const b = nilaiTangan(s.bandar).total;
  const t = s.taruhan;
  if (blackjackAlami(s.pemain) && !s.ganda) {
    return blackjackAlami(s.bandar) ? { hasil: 'seri', kembali: t } : { hasil: 'blackjack', kembali: t * 2 + Math.floor(t / 2) };
  }
  if (p > 21) return { hasil: 'bust', kembali: 0 };
  if (blackjackAlami(s.bandar)) return { hasil: 'kalah', kembali: 0 };
  if (b > 21 || p > b) return { hasil: 'menang', kembali: t * 2 };
  if (p === b) return { hasil: 'seri', kembali: t };
  return { hasil: 'kalah', kembali: 0 };
}

// Dari state sampai hasil: kalau pemain tidak bust dan bukan natural, bandar jalan dulu.
function selesaikanBj(s) {
  const p = nilaiTangan(s.pemain).total;
  if (p <= 21 && !blackjackAlami(s.pemain) && !blackjackAlami(s.bandar)) bandarMain(s);
  s.selesai = true;
  return hasilBj(s);
}

const tanganTeks = (kartu, tutup = false) => (tutup ? `${teksKartu(kartu[0])} 🂠` : kartu.map(teksKartu).join(' '));

module.exports = {
  acak, kocok,
  STRIP, KALI_SLOT, nilaiSlot, putarSlot,
  PILIHAN_DADU, kelompokDadu, lemparDadu, lemparKoin,
  SUIT, MENGALAHKAN, mainSuit,
  papanKosong, pemenangXo, penuhXo, langkahXo,
  teksKartu, nilaiKartu, nilaiTangan, blackjackAlami, mulaiBj, tarikBj, bandarMain, hasilBj, selesaikanBj, tanganTeks,
};
