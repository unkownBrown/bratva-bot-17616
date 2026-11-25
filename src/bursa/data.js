// Data bursa harga di data/bursa.json: daftar harga, catatan penjualan (transaksi), dan posisi papan harga. Ditulis tertunda, ikut Backup.
// Harga yang dipakai tiap penjualan disalin ke catatannya, jadi mengubah harga tidak pernah mengubah penghasilan yang sudah tercatat.
const store = require('../store');
const h = require('./harga');
const db = require('../db').open(store.FILES.bursa, () => ({}));

function bawaan() {
  const out = [];
  for (const [kategori, items] of h.BAWAAN) {
    for (const [nama, harga, isi] of items) out.push({ id: h.slug(nama), nama, kategori, harga, isi });
  }
  return out;
}

// Data satu server. Daftar harga diisi dari daftar bawaan sekali saja (kalau kamu hapus semua barang, tidak diisi lagi).
function guild(guildId) {
  const g = (db.data[guildId] ??= {});
  if (!Array.isArray(g.barang)) {
    g.barang = bawaan();
    g.diperbarui = Date.now();
  }
  g.trx ??= [];
  g.next ??= 1;
  g.papan ??= null; // { channelId, messageId }
  g.rekapTerakhir ??= 0; // awal minggu (ms) yang rekapnya sudah dikirim otomatis
  return g;
}

const barang = (guildId) => guild(guildId).barang;
const cari = (guildId, teks, opsi) => h.cari(barang(guildId), teks, opsi);

function idUnik(g, nama) {
  const dasar = h.slug(nama);
  let id = dasar;
  for (let n = 2; g.barang.some((b) => b.id === id); n++) id = `${dasar}-${n}`;
  return id;
}

// Tambah atau ubah satu barang. Hasil: { barang, baru, dulu } (dulu = harga dan isi sebelum diubah).
function simpanBarang(guildId, { nama, harga, isi, kategori }) {
  const g = guild(guildId);
  const ada = h.cari(g.barang, nama, { ketat: true }).item;
  let hasil;
  if (ada) {
    hasil = { barang: ada, baru: false, dulu: { harga: ada.harga, isi: ada.isi, kategori: ada.kategori } };
    ada.harga = harga;
    if (isi) ada.isi = isi;
    if (kategori) ada.kategori = kategori;
  } else {
    const b = { id: idUnik(g, nama), nama, kategori: kategori ?? 'Lainnya', harga, isi: isi ?? 1 };
    g.barang.push(b);
    hasil = { barang: b, baru: true, dulu: null };
  }
  g.diperbarui = Date.now();
  db.save();
  return hasil;
}

function hapusBarang(guildId, id) {
  const g = guild(guildId);
  const i = g.barang.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const [b] = g.barang.splice(i, 1);
  g.diperbarui = Date.now();
  db.save();
  return b;
}

// Terapkan hasil parseDaftar. Barang yang tidak disebut di daftar dibiarkan (hapus lewat /bursa hapus).
// Hasil: { baru: [barang], berubah: [{ barang, dulu }], sama: n, tidakDisebut: [nama] }
function terapkanDaftar(guildId, items) {
  const g = guild(guildId);
  const hasil = { baru: [], berubah: [], sama: 0, tidakDisebut: [], peringatan: [] };
  const disentuh = new Set();
  for (const it of items) {
    const ada = h.cari(g.barang, it.nama, { ketat: true }).item;
    let isi = it.isi;
    if (isi === null) {
      isi = ada?.isi ?? 1;
      if (!ada) hasil.peringatan.push(`${it.nama}: isi paket tidak disebut, dianggap 1 pcs.`);
    }
    if (ada) {
      disentuh.add(ada.id);
      const kategori = it.kategori ?? ada.kategori;
      if (ada.harga === it.harga && ada.isi === isi && ada.kategori === kategori) {
        hasil.sama += 1;
        continue;
      }
      hasil.berubah.push({ barang: ada, dulu: { harga: ada.harga, isi: ada.isi, kategori: ada.kategori } });
      Object.assign(ada, { harga: it.harga, isi, kategori });
    } else {
      const b = { id: idUnik(g, it.nama), nama: it.nama, kategori: it.kategori ?? 'Lainnya', harga: it.harga, isi };
      g.barang.push(b);
      disentuh.add(b.id);
      hasil.baru.push(b);
    }
  }
  hasil.tidakDisebut = g.barang.filter((b) => !disentuh.has(b.id)).map((b) => b.nama);
  if (hasil.baru.length || hasil.berubah.length) {
    g.diperbarui = Date.now();
    db.save();
  }
  return hasil;
}

// ---------- transaksi ----------

// baris: hasil h.hitung(...). Mengembalikan transaksi yang tersimpan.
function tambahTrx(guildId, { userId, userTag, baris, via }) {
  const g = guild(guildId);
  const trx = {
    id: g.next++, at: Date.now(), userId, userTag, via: via ?? 'slash',
    baris, total: baris.reduce((n, b) => n + b.total, 0),
  };
  g.trx.push(trx);
  db.save();
  return trx;
}

const trxById = (guildId, id) => guild(guildId).trx.find((t) => t.id === Number(id)) ?? null;

function hapusTrx(guildId, id) {
  const g = guild(guildId);
  const i = g.trx.findIndex((t) => t.id === Number(id));
  if (i < 0) return null;
  const [t] = g.trx.splice(i, 1);
  db.save();
  return t;
}

const trxTerbaru = (guildId, { userId = null, n = 15 } = {}) => {
  const semua = guild(guildId).trx;
  const out = [];
  for (let i = semua.length - 1; i >= 0 && out.length < n; i--) if (!userId || semua[i].userId === userId) out.push(semua[i]);
  return out;
};

const trxDalam = (guildId, { dari = 0, sampai = Infinity, userId = null } = {}) => guild(guildId).trx
  .filter((t) => t.at >= dari && t.at < sampai && (!userId || t.userId === userId));

// Jumlahkan transaksi: total uang, per barang, dan per orang.
function ringkas(guildId, filter = {}) {
  const out = { total: 0, jumlahTrx: 0, perBarang: new Map(), perUser: new Map() };
  for (const t of trxDalam(guildId, filter)) {
    out.total += t.total;
    out.jumlahTrx += 1;
    const u = out.perUser.get(t.userId) ?? { userId: t.userId, tag: t.userTag, total: 0, trx: 0 };
    u.total += t.total;
    u.trx += 1;
    u.tag = t.userTag ?? u.tag;
    out.perUser.set(t.userId, u);
    for (const b of t.baris) {
      const k = b.itemId ?? b.nama;
      const x = out.perBarang.get(k) ?? { nama: b.nama, pcs: 0, isi: b.isi, total: 0 };
      x.pcs += b.pcs;
      x.total += b.total;
      x.isi = b.isi;
      x.nama = b.nama;
      out.perBarang.set(k, x);
    }
  }
  return out;
}

function setPapan(guildId, papan) {
  guild(guildId).papan = papan;
  db.save();
}

const tandaiRekap = (guildId, awalMinggu) => {
  guild(guildId).rekapTerakhir = awalMinggu;
  db.save();
};

// Jumlah catatan untuk ringkasan status.
const jumlahTrx = (guildId) => guild(guildId).trx.length;

module.exports = {
  guild, barang, cari, simpanBarang, hapusBarang, terapkanDaftar,
  tambahTrx, trxById, hapusTrx, trxTerbaru, trxDalam, ringkas, setPapan, tandaiRekap, jumlahTrx,
  save: () => db.save(), flush: () => db.flush(), db,
};
