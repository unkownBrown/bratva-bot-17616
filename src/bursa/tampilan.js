// Tampilan bursa harga: papan harga, struk penjualan, penghasilan, rekap, riwayat, hasil pembaruan harga, dan ekspor CSV.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../store');
const panels = require('../panels');
const runtime = require('../runtime');
const h = require('./harga');

const { uang, angka } = h;
const { ts } = runtime;

const accent = () => panels.asColor(store.loadContent().meta.warna);
const clip = (text, n) => (String(text).length > n ? `${String(text).slice(0, n - 1)}…` : String(text));

const IKON = [[/tambang/i, '⛏️'], [/depot/i, '📦']];
const ikon = (kategori) => IKON.find(([re]) => re.test(kategori))?.[1] ?? '🏷️';

// Pecah daftar baris jadi beberapa teks (masing-masing <= max huruf) supaya muat di satu field embed.
function bagi(lines, max = 1000) {
  const out = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > max) {
      out.push(cur);
      cur = '';
    }
    cur += `${cur ? '\n' : ''}${clip(line, max)}`;
  }
  if (cur) out.push(cur);
  return out;
}

const bar = (frac, n = 10) => {
  const isi = Math.max(0, Math.min(n, Math.round(frac * n)));
  return '█'.repeat(isi) + '░'.repeat(n - isi);
};

const hargaTeks = (b) => (b.isi > 1 ? `${uang(b.harga)} / paket (${angka(b.isi)} pcs)` : `${uang(b.harga)} / pcs`);
const perPcs = (b) => (b.isi > 1 ? ` · ≈ ${uang(b.harga / b.isi)}/pcs` : '');

// ---------- papan harga ----------

function tombolBursa() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kb:m').setLabel('Catat penjualan').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kb:s').setLabel('Penghasilanku').setStyle(ButtonStyle.Secondary),
  );
}

function papanPayload(barang, diperbarui) {
  const embed = new EmbedBuilder().setColor(accent()).setTitle('BURSA HARGA DISNAKER TERBARU')
    .setFooter({ text: 'Catat hasil jualanmu dengan /jual atau tombol di bawah' });
  if (diperbarui) embed.setTimestamp(diperbarui);
  if (!barang.length) {
    embed.setDescription('Daftar harga masih kosong. Pengelola bisa mengisinya dengan `/bursa harga-baru`.');
    return { embeds: [embed], components: [tombolBursa()] };
  }
  embed.setDescription('Regulasi harga terbaru. Harga per paket, isi paket tertulis di sebelahnya.');
  const grup = new Map();
  for (const b of barang) grup.set(b.kategori, [...(grup.get(b.kategori) ?? []), b]);
  let n = 0;
  for (const [kategori, items] of grup) {
    const potongan = bagi(items.map((b) => `**${clip(b.nama, 60)}** · ${hargaTeks(b)}`));
    for (const [i, teks] of potongan.entries()) {
      if (n++ >= 24) break;
      embed.addFields({ name: clip(`${ikon(kategori)} ${kategori.toUpperCase()}${i ? ' (lanjutan)' : ''}`, 250), value: teks });
    }
  }
  return { embeds: [embed], components: [tombolBursa()] };
}

function barangEmbed(b) {
  return new EmbedBuilder().setColor(accent()).setTitle(clip(b.nama, 200))
    .setDescription([`${ikon(b.kategori)} ${b.kategori}`, `**${hargaTeks(b)}**${perPcs(b)}`].join('\n'))
    .setFooter({ text: 'Catat penjualan dengan /jual' });
}

// ---------- struk penjualan ----------

const barisStruk = (b) => `**${clip(b.nama, 60)}** · ${h.jumlahTeks(b)} → **${uang(b.total)}**`;

function strukEmbed({ trx, galat = [], hari, minggu, menitBatal }) {
  const embed = new EmbedBuilder().setColor(0x2e9e5b).setTitle(`Penjualan tercatat #${trx.id}`)
    .setDescription([...trx.baris.map(barisStruk), '', `**Total: ${uang(trx.total)}**`].join('\n').slice(0, 4000))
    .addFields(
      { name: 'Hari ini', value: `${uang(hari.total)} · ${hari.jumlahTrx} penjualan`, inline: true },
      { name: 'Minggu ini', value: `${uang(minggu.total)} · ${minggu.jumlahTrx} penjualan`, inline: true },
    )
    .setFooter({ text: `Salah input? Klik Batalkan (berlaku ${menitBatal} menit).` }).setTimestamp(trx.at);
  if (galat.length) {
    const teks = bagi(galat.map((g) => `• \`${g.teks}\`: ${g.alasan}`), 1000)[0];
    embed.addFields({ name: '⚠️ Baris ini tidak dicatat', value: teks });
  }
  return embed;
}

// Baris di channel log bursa.
function logPenjualan(trx) {
  return new EmbedBuilder().setColor(0x2e9e5b).setTitle(`Penjualan #${trx.id}`)
    .setDescription(`<@${trx.userId}> menjual:\n${trx.baris.map((b) => `• ${clip(b.nama, 60)} · ${h.jumlahTeks(b)} · ${uang(b.total)}`).join('\n')}`.slice(0, 4000))
    .addFields({ name: 'Total', value: uang(trx.total), inline: true })
    .setFooter({ text: `ID ${trx.userId}` }).setTimestamp(trx.at);
}

const logBatal = (trx, oleh) => new EmbedBuilder().setColor(0xb45309).setTitle(`Penjualan #${trx.id} dibatalkan`)
  .setDescription(`Penjualan milik <@${trx.userId}> senilai **${uang(trx.total)}** dibatalkan oleh <@${oleh}>.`).setTimestamp();

// ---------- penghasilan & rekap ----------

function barangBaris(perBarang, total, batas = 15) {
  const urut = [...perBarang.values()].sort((a, b) => b.total - a.total);
  const baris = urut.slice(0, batas).map((x) => {
    const persen = total ? Math.round((x.total / total) * 100) : 0;
    return `\`${bar(total ? x.total / total : 0)}\` ${String(persen).padStart(2, ' ')}% **${clip(x.nama, 40)}** · ${h.pcsTeks(x.pcs, x.isi)} · ${uang(x.total)}`;
  });
  if (urut.length > batas) baris.push(`…dan ${urut.length - batas} barang lain`);
  return baris;
}

function penghasilanEmbed({ user, label, r, ringkasan, terakhir }) {
  const nama = user.displayName ?? user.username ?? user.tag;
  const embed = new EmbedBuilder().setColor(accent()).setTitle(`Penghasilan ${clip(nama, 60)}`)
    .setThumbnail(user.displayAvatarURL?.() ?? null);
  if (!ringkasan.semua.jumlahTrx) {
    return embed.setDescription('Belum ada penjualan tercatat. Catat dengan `/jual`.');
  }
  embed.setDescription([
    `**${label}: ${uang(r.total)}** dari ${r.jumlahTrx} penjualan`,
    r.jumlahTrx ? `Rata-rata per penjualan: ${uang(r.total / r.jumlahTrx)}` : '',
  ].filter(Boolean).join('\n'));
  embed.addFields(
    { name: 'Hari ini', value: uang(ringkasan.hari.total), inline: true },
    { name: 'Minggu ini', value: uang(ringkasan.minggu.total), inline: true },
    { name: 'Bulan ini', value: uang(ringkasan.bulan.total), inline: true },
    { name: 'Semua waktu', value: `${uang(ringkasan.semua.total)} · ${ringkasan.semua.jumlahTrx} penjualan`, inline: false },
  );
  const perBarang = bagi(barangBaris(r.perBarang, r.total));
  if (perBarang.length) embed.addFields({ name: `Per barang (${label.toLowerCase()})`, value: perBarang[0] });
  if (terakhir.length) {
    embed.addFields({
      name: 'Penjualan terakhir',
      value: bagi(terakhir.map((t) => `**#${t.id}** · ${ts(t.at, 'R')} · ${uang(t.total)} · ${clip(t.baris.map((b) => b.nama).join(', '), 60)}`))[0],
    });
  }
  return embed.setFooter({ text: 'Dihitung dari harga saat penjualan dicatat' });
}

const MEDALI = ['🥇', '🥈', '🥉'];

function rekapEmbed({ judul, label, r, dari, sampai }) {
  const embed = new EmbedBuilder().setColor(accent()).setTitle(clip(judul ?? `Rekap penghasilan · ${label}`, 250));
  const rentang = dari && Number.isFinite(sampai) ? `${h.tanggal(dari)} – ${h.tanggal(sampai - 1)}` : null;
  if (!r.jumlahTrx) return embed.setDescription(`${rentang ? `${rentang}\n` : ''}Belum ada penjualan tercatat di periode ini.`);
  embed.setDescription([
    rentang,
    `**Total: ${uang(r.total)}** dari ${r.jumlahTrx} penjualan oleh ${r.perUser.size} orang`,
    `Rata-rata per penjualan: ${uang(r.total / r.jumlahTrx)}`,
  ].filter(Boolean).join('\n'));
  const orang = [...r.perUser.values()].sort((a, b) => b.total - a.total);
  const baris = orang.slice(0, 15).map((u, i) => `${MEDALI[i] ?? `${i + 1}.`} <@${u.userId}> · **${uang(u.total)}** · ${u.trx} penjualan`);
  if (orang.length > 15) baris.push(`…dan ${orang.length - 15} orang lain`);
  embed.addFields({ name: 'Per orang', value: bagi(baris)[0] });
  const barang = bagi(barangBaris(r.perBarang, r.total));
  if (barang.length) embed.addFields({ name: 'Per barang', value: barang[0] });
  return embed;
}

function riwayatEmbed(list, judul) {
  const embed = new EmbedBuilder().setColor(accent()).setTitle(clip(judul, 250));
  if (!list.length) return embed.setDescription('Belum ada penjualan tercatat.');
  const baris = list.map((t) => `**#${t.id}** · <@${t.userId}> · ${ts(t.at, 'R')} · **${uang(t.total)}**\n${clip(t.baris.map((b) => `${b.nama} ×${angka(b.qty)}${b.satuan === 'pcs' && b.isi > 1 ? ' pcs' : ''}`).join(', '), 120)}`);
  return embed.setDescription(bagi(baris, 3900).join('\n').slice(0, 4000)).setFooter({ text: 'Hapus yang salah: /bursa hapus-catatan nomor' });
}

// ---------- pembaruan daftar harga ----------

function hasilHargaEmbed({ hasil, parse }) {
  const embed = new EmbedBuilder().setColor(0x2e9e5b).setTitle('Daftar harga diperbarui');
  const total = hasil.baru.length + hasil.berubah.length;
  const ringkas = [`${hasil.baru.length} barang baru`, `${hasil.berubah.length} harga berubah`, `${hasil.sama} tidak berubah`];
  embed.setDescription(total ? ringkas.join(' · ') : 'Tidak ada yang berubah. Semua harga di daftar yang kamu tempel sama dengan yang tersimpan.');
  if (!total) embed.setColor(0x6b7280);
  if (hasil.berubah.length) {
    const baris = hasil.berubah.map(({ barang: b, dulu }) => {
      const bagian = [];
      if (dulu.harga !== b.harga) bagian.push(`${uang(dulu.harga)} → **${uang(b.harga)}**`);
      if (dulu.isi !== b.isi) bagian.push(`isi ${angka(dulu.isi)} → ${angka(b.isi)} pcs`);
      if (dulu.kategori !== b.kategori) bagian.push(`kategori ${dulu.kategori} → ${b.kategori}`);
      return `**${clip(b.nama, 60)}** · ${bagian.join(' · ')}`;
    });
    embed.addFields({ name: 'Berubah', value: bagi(baris)[0] });
  }
  if (hasil.baru.length) embed.addFields({ name: 'Baru', value: bagi(hasil.baru.map((b) => `**${clip(b.nama, 60)}** · ${hargaTeks(b)} (${b.kategori})`))[0] });
  if (hasil.tidakDisebut.length) {
    embed.addFields({ name: 'Tidak ada di daftar yang ditempel (tetap dipakai)', value: clip(hasil.tidakDisebut.join(', '), 1000) });
  }
  const catatan = [...parse.peringatan, ...hasil.peringatan, ...parse.tidakTerbaca.map((t) => `Baris tidak terbaca: \`${t.baris}\` (${t.alasan})`)];
  if (catatan.length) embed.addFields({ name: '⚠️ Catatan', value: bagi(catatan.map((c) => `• ${c}`))[0] });
  return embed;
}

// ---------- ekspor ----------

const kolom = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const wibIso = (ms) => new Date(ms + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

// Satu baris per barang per penjualan. BOM di depan supaya Excel membaca huruf dengan benar.
function csv(list) {
  const rows = [['no', 'waktu_wib', 'user_id', 'user', 'barang', 'jumlah', 'satuan', 'pcs', 'harga_per_paket', 'total_baris', 'total_penjualan']];
  for (const t of list) {
    for (const b of t.baris) rows.push([t.id, wibIso(t.at), t.userId, t.userTag ?? '', b.nama, b.qty, b.satuan, b.pcs, b.harga, b.total, t.total]);
  }
  return `﻿${rows.map((r) => r.map(kolom).join(',')).join('\r\n')}\r\n`;
}

module.exports = {
  papanPayload, barangEmbed, strukEmbed, logPenjualan, logBatal, penghasilanEmbed, rekapEmbed, riwayatEmbed, hasilHargaEmbed,
  tombolBursa, csv, bagi, bar, hargaTeks,
};
