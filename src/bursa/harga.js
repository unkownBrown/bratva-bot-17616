// Bursa harga Disnaker: daftar harga bawaan, pembaca daftar yang ditempel, pencocokan nama barang,
// hitungan penjualan, dan batas waktu (hari / minggu / bulan dalam WIB). Semua fungsi di sini murni, gampang dites.

const MATA_UANG = '$';
const MAKS_JUMLAH = 1_000_000;
const MAKS_HARGA = 1_000_000_000;
const MAKS_ISI = 100_000;

// Daftar awal (regulasi terbaru). Dipakai sekali waktu fitur pertama dipakai; seterusnya diubah lewat "Perbarui harga".
const BAWAAN = [
  ['Tambang Baru', [
    ['Alumunium powder', 20000, 100], ['Iron powder', 20000, 100], ['Metalscrap', 20000, 100],
    ['Alumunium', 20000, 100], ['Berlian', 6000, 1],
  ]],
  ['Depot', [
    ['Kaca', 50000, 100], ['Botol', 50000, 100], ['Plastik', 25000, 100],
    ['Karet', 15000, 100], ['Karung', 18000, 100], ['Baja', 20000, 100],
  ]],
];

// ---------- teks & angka ----------

const angka = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const uang = (n) => `${n < 0 ? '-' : ''}${MATA_UANG}${angka(Math.abs(n))}`;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'barang';

const judul = (s) => String(s).toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()).trim();

const satuanDari = (isi) => (isi > 1 ? 'paket' : 'pcs');

function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// "1.000" / "1,000" / "1000" -> 1000. Pecahan ("1.5") sengaja ditolak (NaN).
function bacaAngka(t) {
  const s = String(t ?? '').trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  if (/^\d+$/.test(s)) return Number(s);
  return NaN;
}

// ---------- mencari barang ----------

// Cocokkan teks ketikan dengan daftar barang.
//   Urutan: sama persis -> awalan / mengandung (kalau hanya satu yang cocok) -> salah ketik 1-2 huruf (kalau hanya satu).
//   ketat = true: hanya sama persis atau salah ketik (dipakai saat menempel daftar harga).
// Hasil: { item } | { ambigu: [item...] } | {}
function cari(items, teks, { ketat = false } = {}) {
  const q = norm(teks);
  if (!q) return {};
  const nama = (b) => norm(b.nama);
  const exact = items.filter((b) => nama(b) === q || b.id === q);
  if (exact.length === 1) return { item: exact[0] };
  if (exact.length > 1) return { ambigu: exact };
  if (!ketat && q.length >= 3) {
    const awal = items.filter((b) => nama(b).startsWith(q));
    if (awal.length === 1) return { item: awal[0] };
    if (awal.length > 1) return { ambigu: awal };
    const isi = items.filter((b) => nama(b).includes(q));
    if (isi.length === 1) return { item: isi[0] };
    if (isi.length > 1) return { ambigu: isi };
  }
  const batas = q.length >= 8 ? 2 : q.length >= (ketat ? 6 : 5) ? 1 : 0;
  if (batas) {
    const dekat = items.map((b) => ({ b, d: levenshtein(nama(b), q) })).filter((x) => x.d <= batas).sort((x, y) => x.d - y.d);
    if (dekat.length === 1 || (dekat.length > 1 && dekat[0].d < dekat[1].d)) return { item: dekat[0].b };
    if (dekat.length > 1) return { ambigu: dekat.map((x) => x.b) };
  }
  return {};
}

// ---------- membaca daftar harga yang ditempel ----------

const SIMBOL = /(?:\$|rp\.?)\s*(\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(k|rb|ribu|jt|juta)\b)?/i;
const POLOS = /(\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(k|rb|ribu|jt|juta)\b)?/i;
const KALI = { k: 1e3, rb: 1e3, ribu: 1e3, jt: 1e6, juta: 1e6 };

function bersihBaris(mentah) {
  return String(mentah).replace(/[*_`~]/g, '').replace(/\s*\|\s*/g, ' : ').replace(/^\s*(?:[-•▪▫·>]+|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ').replace(/^[\s:]+|[\s]+$/g, '').trim();
}

// Satu baris barang: "Kaca : $50.000 / Paket (100 pcs)". null = bukan baris barang (tidak ada harga), { galat } = kelihatannya barang tapi tidak valid.
function bacaItem(baris) {
  const sep = baris.search(/[:=：]/);
  let nama;
  let sisa;
  if (sep > 0) {
    nama = baris.slice(0, sep);
    sisa = baris.slice(sep + 1);
  } else {
    const m = SIMBOL.exec(baris);
    if (!m) return null; // tanpa pemisah, harga harus pakai $ / Rp supaya judul seperti "REGULASI 2026" tidak dianggap barang
    nama = baris.slice(0, m.index);
    sisa = baris.slice(m.index);
  }
  const harga = SIMBOL.exec(sisa) ?? POLOS.exec(sisa);
  if (!harga) return null;
  nama = nama.replace(/[\s\-–—:=]+$/g, '').replace(/^[\s\-–—]+/, '').trim();
  if (!/\p{L}/u.test(nama)) return null;
  if (nama.length > 60) return { galat: 'nama barang kepanjangan (maksimal 60 huruf)' };
  const ke = harga[2] ? KALI[harga[2].toLowerCase()] : 1;
  const nilai = bacaAngka(harga[1]) * ke;
  if (!Number.isFinite(nilai) || nilai < 1 || nilai > MAKS_HARGA) return { galat: 'harga tidak valid' };
  const setelah = sisa.slice(harga.index + harga[0].length);
  const pcs = /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:pcs|pc|biji|buah|unit|item|lembar|butir)\b/i.exec(setelah)
    ?? /\bisi\s*:?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/i.exec(setelah);
  const isi = pcs ? bacaAngka(pcs[1]) : (/\b(?:paket|pack|pkt|dus|box|krat)\b/i.test(setelah) ? null : 1);
  if (isi !== null && (!Number.isInteger(isi) || isi < 1 || isi > MAKS_ISI)) return { galat: 'isi paket tidak valid' };
  return { nama, harga: nilai, isi };
}

const KATA_JUDUL = /\b(HARGA|BURSA|REGULASI|TERBARU|DISNAKER|UPDATE|INFO|PENGUMUMAN)\b/;
function adalahHeader(mentah, baris) {
  if (/[:：]\s*$/.test(String(mentah).replace(/[*_`~\s]+$/g, '')) && /\p{L}/u.test(baris)) return true;
  return /^[A-Z][A-Z0-9 &/-]{1,29}$/.test(baris) && !KATA_JUDUL.test(baris);
}
const namaKategori = (baris) => judul(baris.replace(/[:：\s]+$/g, '').replace(/^#+\s*/, '')).slice(0, 30);

// Daftar yang ditempel -> { items: [{ nama, harga, isi, kategori }], tidakTerbaca: [{ baris, alasan }], peringatan: [] }
function parseDaftar(text) {
  const hasil = { items: [], tidakTerbaca: [], peringatan: [] };
  let kategori = null;
  for (const mentah of String(text ?? '').split(/\r?\n/)) {
    const baris = bersihBaris(mentah);
    if (!baris) continue;
    const item = bacaItem(baris);
    if (item === null) {
      if (adalahHeader(mentah, baris)) kategori = namaKategori(baris) || kategori;
      continue;
    }
    if (item.galat) {
      hasil.tidakTerbaca.push({ baris: baris.slice(0, 80), alasan: item.galat });
      continue;
    }
    const kembar = hasil.items.findIndex((x) => norm(x.nama) === norm(item.nama));
    if (kembar >= 0) {
      hasil.peringatan.push(`${item.nama} muncul dua kali, yang terakhir dipakai.`);
      hasil.items.splice(kembar, 1);
    }
    hasil.items.push({ ...item, kategori });
  }
  return hasil;
}

// ---------- membaca catatan penjualan ----------

const UNIT = '(paket|pkt|pack|pcs|pc|biji|buah)';
const NOMOR = '(\\d{1,3}(?:[.,]\\d{3})+|\\d+)';
const RE_NAMA_DULU = new RegExp(`^(.+?)(?:\\s*[:=]\\s*|\\s+x\\s*|\\s*×\\s*|\\s+)${NOMOR}\\s*${UNIT}?$`);
const RE_JUMLAH_DULU = new RegExp(`^${NOMOR}\\s*(?:[x×]\\s+|×\\s*)?${UNIT}?\\s*(?:[x×]\\s+|dari\\s+|of\\s+)?(.+)$`);
const normSatuan = (u) => (!u ? null : /^p(aket|kt|ack)$/.test(u) ? 'paket' : 'pcs');

// "kaca 3", "botol 2 paket", "plastik x5", "3 kaca", "150 pcs karet", "berlian: 4" -> { nama, qty, satuan|null } atau { galat }
function bacaBaris(mentah) {
  const s = String(mentah).toLowerCase().replace(/[*_`~]/g, '').replace(/^\s*[-•]+\s+/, '').replace(/\s+/g, ' ').trim();
  let m = RE_NAMA_DULU.exec(s);
  let nama;
  let qty;
  let unit;
  if (m) [, nama, qty, unit] = m;
  else if ((m = RE_JUMLAH_DULU.exec(s))) [, qty, unit, nama] = m;
  else if (/\d[.,]\d{1,2}(?!\d)/.test(s)) return { galat: 'jumlah harus bilangan bulat (gunakan pcs untuk eceran)' };
  else return { galat: 'tidak ada jumlahnya (contoh: kaca 3)' };
  nama = nama.replace(/[\s:=\-–—]+$/g, '').replace(/^[\s:=\-–—]+/, '').trim();
  if (!/\p{L}/u.test(nama)) return { galat: 'nama barangnya kosong' };
  const n = bacaAngka(qty);
  if (!Number.isInteger(n) || n < 1) return { galat: 'jumlah harus bilangan bulat (gunakan pcs untuk eceran)' };
  if (n > MAKS_JUMLAH) return { galat: `jumlah terlalu besar (maksimal ${angka(MAKS_JUMLAH)})` };
  return { nama, qty: n, satuan: normSatuan(unit) };
}

// Beberapa baris sekaligus -> { baris: [{ item, qty, satuan }], galat: [{ teks, alasan }] }
function parseJual(text, items) {
  const hasil = { baris: [], galat: [] };
  for (const mentah of String(text ?? '').split(/\r?\n/)) {
    if (!mentah.trim()) continue;
    const b = bacaBaris(mentah);
    if (b.galat) { hasil.galat.push({ teks: mentah.trim().slice(0, 60), alasan: b.galat }); continue; }
    const c = cari(items, b.nama);
    if (c.item) hasil.baris.push({ item: c.item, qty: b.qty, satuan: b.satuan ?? satuanDari(c.item.isi) });
    else if (c.ambigu) hasil.galat.push({ teks: mentah.trim().slice(0, 60), alasan: `"${b.nama}" bisa ${c.ambigu.slice(0, 4).map((x) => x.nama).join(' / ')}. Tulis lebih lengkap` });
    else hasil.galat.push({ teks: mentah.trim().slice(0, 60), alasan: `barang "${b.nama}" tidak ada di daftar harga` });
  }
  return hasil;
}

// ---------- hitungan ----------

// Satu baris penjualan. Harga di daftar = harga per paket (isi barang pcs); eceran dihitung sebanding.
function hitung(item, qty, satuan) {
  const pakai = item.isi === 1 ? 'pcs' : (satuan ?? satuanDari(item.isi));
  const pcs = pakai === 'paket' ? qty * item.isi : qty;
  const total = pakai === 'paket' ? item.harga * qty : Math.round((item.harga * qty) / item.isi);
  return { itemId: item.id, nama: item.nama, qty, satuan: pakai, pcs, isi: item.isi, harga: item.harga, total };
}

// "3 paket (300 pcs)" / "250 pcs (2 paket + 50 pcs)" / "5 pcs"
function jumlahTeks(b) {
  if (b.isi <= 1) return `${angka(b.qty)} pcs`;
  if (b.satuan === 'paket') return `${angka(b.qty)} paket (${angka(b.pcs)} pcs)`;
  const paket = Math.floor(b.pcs / b.isi);
  return paket ? `${angka(b.pcs)} pcs (${angka(paket)} paket${b.pcs % b.isi ? ` + ${angka(b.pcs % b.isi)} pcs` : ''})` : `${angka(b.pcs)} pcs`;
}

// Total pcs -> teks ringkas untuk rekap ("12 paket + 30 pcs" / "7 pcs").
function pcsTeks(pcs, isi) {
  if (isi <= 1) return `${angka(pcs)} pcs`;
  const paket = Math.floor(pcs / isi);
  const sisa = pcs % isi;
  if (!paket) return `${angka(sisa)} pcs`;
  return sisa ? `${angka(paket)} paket + ${angka(sisa)} pcs` : `${angka(paket)} paket`;
}

// ---------- waktu (WIB, UTC+7) ----------

const WIB = 7 * 3600e3;
const HARI = 86400e3;
const awalHari = (t = Date.now()) => Math.floor((t + WIB) / HARI) * HARI - WIB;
const awalMinggu = (t = Date.now()) => awalHari(t) - ((new Date(awalHari(t) + WIB).getUTCDay() + 6) % 7) * HARI; // Senin 00.00 WIB
function awalBulan(t = Date.now()) {
  const d = new Date(t + WIB);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - WIB;
}

const PERIODE = {
  hari: 'Hari ini', minggu: 'Minggu ini', bulan: 'Bulan ini', semua: 'Semua waktu', minggulalu: 'Minggu lalu',
};
function rentang(periode, now = Date.now()) {
  switch (periode) {
    case 'hari': return { dari: awalHari(now), sampai: Infinity, label: PERIODE.hari };
    case 'minggu': return { dari: awalMinggu(now), sampai: Infinity, label: `${PERIODE.minggu} (sejak Senin)` };
    case 'minggulalu': return { dari: awalMinggu(now) - 7 * HARI, sampai: awalMinggu(now), label: PERIODE.minggulalu };
    case 'bulan': return { dari: awalBulan(now), sampai: Infinity, label: PERIODE.bulan };
    default: return { dari: 0, sampai: Infinity, label: PERIODE.semua };
  }
}

const tanggalFmt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' });
const tanggal = (ms) => tanggalFmt.format(ms);

module.exports = {
  MATA_UANG, MAKS_JUMLAH, MAKS_HARGA, BAWAAN, PERIODE,
  angka, uang, norm, slug, judul, satuanDari, bacaAngka, cari, parseDaftar, parseJual, bacaBaris, bacaItem,
  hitung, jumlahTeks, pcsTeks, awalHari, awalMinggu, awalBulan, rentang, tanggal, HARI,
};
