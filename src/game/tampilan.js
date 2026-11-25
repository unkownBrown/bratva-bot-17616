// Tampilan game dan level: embed, tombol, papan XO.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../store');
const panels = require('../panels');
const games = require('./games');
const lv = require('./level');

const accent = () => panels.asColor(store.loadContent().meta.warna);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const angka = (n) => Math.trunc(Number(n) || 0).toLocaleString('id-ID');
const koinTeks = (n) => `🪙 ${angka(n)}`;
const HIJAU = 0x2e9e5b;
const MERAH = 0xb91c1c;
const ABU = 0x6b7280;
const EMAS = 0xd4a017;

const bar = (bagian, panjang = 12) => {
  const penuh = Math.max(0, Math.min(panjang, Math.round(bagian * panjang)));
  return '▰'.repeat(penuh) + '▱'.repeat(panjang - penuh);
};

const tombol = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(clip(label, 80)).setStyle(style);
const baris = (...c) => new ActionRowBuilder().addComponents(...c);

// ---------- level, rank, top, koin ----------

function rankEmbed({ id, nama, p, posisi, jumlah, koin = null, avatar = null }) {
  const x = lv.info(p?.xp ?? 0);
  const desc = x.maks
    ? `**LEVEL MAKSIMAL** · ${angka(x.total)} XP`
    : `${bar(x.xpLevel / x.butuh)} ${angka(x.xpLevel)} / ${angka(x.butuh)} XP ke level ${x.level + 1}`;
  const e = new EmbedBuilder().setColor(accent()).setTitle(clip(`Rank ${nama}`, 250)).setDescription(desc).addFields(
    { name: 'Level', value: String(x.level), inline: true },
    { name: 'Peringkat', value: posisi ? `#${posisi} dari ${jumlah}` : 'belum ada', inline: true },
    { name: 'Total XP', value: angka(x.total), inline: true },
    { name: 'Pesan', value: angka(p?.pesan ?? 0), inline: true },
  );
  if (koin !== null) e.addFields({ name: 'Koin', value: koinTeks(koin), inline: true });
  if (avatar) e.setThumbnail(avatar);
  return e;
}

const MEDALI = ['🥇', '🥈', '🥉'];
function topEmbed({ judul, daftar, jenis }) {
  const baris_ = daftar.map((p, i) => {
    const nilai = jenis === 'koin'
      ? koinTeks(p.koin)
      : `Level ${lv.info(p.xp).level} · ${angka(p.xp)} XP`;
    return `${MEDALI[i] ?? `**${i + 1}.**`} <@${p.id}> · ${nilai}`;
  });
  return new EmbedBuilder().setColor(EMAS).setTitle(clip(judul, 250))
    .setDescription(baris_.join('\n') || 'Belum ada data. Ngobrol dulu biar XP-nya jalan!');
}

function koinEmbed({ nama, p, posisi, jumlah, harianSiap, streak }) {
  const e = new EmbedBuilder().setColor(EMAS).setTitle(clip(`Dompet ${nama}`, 250)).setDescription(`# ${koinTeks(p.koin)}`).addFields(
    { name: 'Peringkat koin', value: posisi ? `#${posisi} dari ${jumlah}` : 'belum ada', inline: true },
    { name: 'Main / menang', value: `${angka(p.main)} / ${angka(p.menang)}`, inline: true },
  );
  if (harianSiap !== undefined) e.addFields({ name: 'Hadiah harian', value: harianSiap ? 'Siap diambil: `/harian`' : `Sudah diambil hari ini${streak ? ` · beruntun ${streak} hari` : ''}`, inline: false });
  return e;
}

function harianEmbed({ nama, hadiah, streak, saldo }) {
  return new EmbedBuilder().setColor(HIJAU).setTitle('Hadiah harian').setDescription(
    `${clip(nama, 60)} dapat **${koinTeks(hadiah)}**\nBeruntun **${streak} hari**${streak < 7 ? ' (makin lama makin besar sampai 7 hari)' : ' (bonus penuh)'}\nSaldo: ${koinTeks(saldo)}`,
  );
}

function infoGameEmbed({ taruhanMaks, kuis, harian, pakaiKoin }) {
  const e = new EmbedBuilder().setColor(accent()).setTitle('GAME').setDescription([
    `Koin awal ${koinTeks(100)} untuk semua orang. Tambah koin lewat \`/harian\`, menang game, atau naik level. Taruhan maksimal ${koinTeks(taruhanMaks)}.`,
  ].join('\n')).addFields(
    { name: '🎰 /slot', value: 'Tiga gambar sama = hadiah besar (sampai 100x). Dua sama = taruhan kembali.', inline: false },
    { name: '🎲 /dadu', value: 'Tebak jumlah dua dadu: kecil (2-6) atau besar (8-12) dibayar 2x, tujuh dibayar 5x.', inline: false },
    { name: '🪙 /lempar', value: 'Kepala atau ekor, dibayar 2x. Awas, kadang koinnya menggelinding hilang.', inline: false },
    { name: '✊ /suit', value: 'Batu gunting kertas lawan bot. Menang 2x, seri taruhan kembali.', inline: false },
    { name: '⭕ /xo', value: 'Tantang member lain main XO (boleh pakai taruhan). Pemenang bawa semua.', inline: false },
    { name: '❓ /kuis', value: `Siapa paling cepat menjawab benar dapat ${koinTeks(kuis)}.`, inline: false },
    { name: '🃏 /blackjack', value: 'Tarik, tahan, atau gandakan. Bandar berhenti di 17. Blackjack dibayar 3:2.', inline: false },
    { name: 'Dompet', value: `\`/koin\` (saldo), \`/harian\` (hadiah ${koinTeks(harian)} dan makin besar kalau beruntun), \`/beri\` (kirim koin), \`/top koin\`.`, inline: false },
  );
  if (!pakaiKoin) e.setFooter({ text: 'Game belum dinyalakan oleh pengelola.' });
  return e;
}

// ---------- hasil game ----------

function hasilEmbed({ judul, isi, kembali, taruhan, saldo, warna }) {
  const net = kembali - taruhan;
  const menang = net > 0;
  const seri = net === 0;
  const baris_ = [isi];
  if (taruhan > 0) {
    baris_.push('', menang ? `✅ Menang **${koinTeks(net)}**` : seri ? '🤝 Taruhan kembali' : `❌ Kalah **${koinTeks(-net)}**`, `Saldo: ${koinTeks(saldo)}`);
  }
  return new EmbedBuilder().setColor(warna ?? (menang ? HIJAU : seri ? ABU : MERAH)).setTitle(clip(judul, 250)).setDescription(baris_.join('\n'));
}

const slotTeks = (g) => `# ${g.join(' | ')}`;
const SLOT_PUTAR = '🎰 | 🎰 | 🎰';

// ---------- blackjack ----------

function bjEmbed({ s, nama, hasil = null, kembali = 0, saldo = null, bisaGanda = false }) {
  const selesai = Boolean(hasil);
  const p = games.nilaiTangan(s.pemain);
  const b = games.nilaiTangan(s.bandar);
  const judul = `🃏 Blackjack · taruhan ${koinTeks(s.taruhan)}`;
  const e = new EmbedBuilder().setColor(accent()).setTitle(clip(judul, 250)).addFields(
    { name: `${clip(nama, 40)} (${p.total}${p.lunak && !selesai ? ' lunak' : ''})`, value: games.tanganTeks(s.pemain), inline: true },
    { name: `Bandar (${selesai ? b.total : games.nilaiKartu(s.bandar[0])})`, value: games.tanganTeks(s.bandar, !selesai), inline: true },
  );
  if (!selesai) {
    e.setFooter({ text: bisaGanda ? 'Tarik kartu, tahan, atau gandakan taruhan.' : 'Tarik kartu atau tahan.' });
    return e;
  }
  const kata = { blackjack: '🃏 **BLACKJACK!** dibayar 3:2', menang: '✅ Kamu menang', seri: '🤝 Seri, taruhan kembali', kalah: '❌ Bandar menang', bust: '💥 Kartumu lewat 21' }[hasil];
  const net = kembali - s.taruhan;
  e.setColor(net > 0 ? HIJAU : net === 0 ? ABU : MERAH).setDescription([
    kata,
    net > 0 ? `Menang **${koinTeks(net)}**` : net < 0 ? `Kalah **${koinTeks(-net)}**` : '',
    saldo !== null ? `Saldo: ${koinTeks(saldo)}` : '',
  ].filter(Boolean).join('\n'));
  return e;
}

const bjTombol = (userId, bisaGanda) => [baris(
  tombol(`gm:bh:${userId}`, 'Tarik', ButtonStyle.Primary),
  tombol(`gm:bs:${userId}`, 'Tahan', ButtonStyle.Success),
  tombol(`gm:bd:${userId}`, 'Gandakan').setDisabled(!bisaGanda),
)];

// ---------- XO ----------

const SIMBOL = { X: '❌', O: '⭕' };

function xoTeks(x, { menang = null, seri = false, status = null } = {}) {
  const taruhan = x.taruhan > 0 ? ` · taruhan ${koinTeks(x.taruhan)} masing-masing` : '';
  const kepala = `❌ <@${x.a}> melawan ⭕ <@${x.b}>${taruhan}`;
  if (status) return `${kepala}\n${status}`;
  if (menang) return `${kepala}\n🏆 <@${menang === 'X' ? x.a : x.b}> menang!${x.taruhan > 0 ? ` Membawa ${koinTeks(x.taruhan * 2)}.` : ''}`;
  if (seri) return `${kepala}\n🤝 Seri.${x.taruhan > 0 ? ' Taruhan dikembalikan.' : ''}`;
  return `${kepala}\nGiliran ${x.giliran === 'a' ? '❌' : '⭕'} <@${x[x.giliran]}>`;
}

function xoKomponen(id, x, { selesai = false, garis = [] } = {}) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = baris();
    for (let c = 0; c < 3; c++) {
      const pos = r * 3 + c;
      const s = x.papan[pos];
      const gaya = garis.includes(pos) ? ButtonStyle.Success : ButtonStyle.Secondary;
      // Kotak kosong bernomor 1-9 (seperti papan angka), kotak yang sudah diisi hanya berisi tanda.
      const b = s === ' '
        ? tombol(`gm:xc:${id}:${pos}`, String(pos + 1), gaya)
        : new ButtonBuilder().setCustomId(`gm:xc:${id}:${pos}`).setEmoji(SIMBOL[s]).setStyle(gaya);
      b.setDisabled(selesai || s !== ' ');
      row.addComponents(b);
    }
    rows.push(row);
  }
  if (!selesai) rows.push(baris(tombol(`gm:xs:${id}`, 'Menyerah', ButtonStyle.Danger)));
  return rows;
}

const xoAjakKomponen = (id) => [baris(
  tombol(`gm:xa:${id}`, 'Terima', ButtonStyle.Success),
  tombol(`gm:xr:${id}`, 'Tolak / batal', ButtonStyle.Danger),
)];

// ---------- kuis ----------

const HURUF = ['A', 'B', 'C', 'D'];
function kuisEmbed({ soal, kategori, hadiah, detik, selesai = null }) {
  const e = new EmbedBuilder().setColor(accent()).setTitle(clip(`❓ Kuis · ${kategori}`, 250));
  const pilihan = soal.pilihan.map((t, i) => `**${HURUF[i]}.** ${t}`).join('\n');
  e.setDescription(`${clip(soal.t, 1500)}\n\n${pilihan}`);
  if (!selesai) return e.setFooter({ text: `Yang pertama menjawab benar dapat ${angka(hadiah)} koin · ${detik} detik` });
  e.setColor(selesai.pemenang ? HIJAU : ABU);
  e.addFields({ name: 'Jawaban', value: `**${HURUF[soal.benar]}.** ${soal.pilihan[soal.benar]}`, inline: true });
  e.addFields({ name: 'Pemenang', value: selesai.pemenang ? `<@${selesai.pemenang}> (+${angka(hadiah)} koin)` : 'tidak ada yang menjawab benar', inline: true });
  return e;
}

function kuisTombol(qid, soal, { mati = false } = {}) {
  return [baris(...soal.pilihan.map((t, i) => tombol(`gm:qa:${qid}:${i}`, `${HURUF[i]}. ${t}`, ButtonStyle.Secondary).setDisabled(mati)))];
}

module.exports = {
  accent, clip, angka, koinTeks, bar, tombol, baris, HIJAU, MERAH, ABU, EMAS,
  rankEmbed, topEmbed, koinEmbed, harianEmbed, infoGameEmbed, hasilEmbed, slotTeks, SLOT_PUTAR,
  bjEmbed, bjTombol, xoTeks, xoKomponen, xoAjakKomponen, kuisEmbed, kuisTombol, HURUF,
};
