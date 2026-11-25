// Semua game: slot, dadu, lempar koin, suit, XO, kuis, blackjack.
// Aturan koin: taruhan dipotong lebih dulu dalam satu langkah sinkron, hasil diundi, hadiah dibayar di langkah yang sama, baru dibalas ke Discord.
// Jadi tombol yang ditekan berulang atau bersamaan tidak bisa menggandakan koin.
const { EmbedBuilder, MessageFlags } = require('discord.js');
const store = require('../store');
const access = require('../access');
const runtime = require('../runtime');
const data = require('./data');
const games = require('./games');
const soal = require('./soal');
const t = require('./tampilan');

const EPHEMERAL = MessageFlags.Ephemeral;
const cfg = () => store.peekSettings().game;

// Bisa diubah (tes memakai ini supaya tidak menunggu dan hasilnya bisa dipastikan).
const opsi = { rng: games.acak, animasiMs: 800, kuisDetik: 20, xoAjakMenit: 5, xoIdleMenit: 10, bjIdleMenit: 5, jedaDetik: 3 };

const reply = (i, content, extra = {}) => i.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] }, ...extra });
const umum = { allowedMentions: { parse: [] } };
const who = (i) => (i.member?.id ? i.member : i.user);
const namaDi = (i) => i.member?.displayName ?? i.user.globalName ?? i.user.username;
const embed = (warna, judul, isi) => new EmbedBuilder().setColor(warna).setTitle(judul).setDescription(isi);
const diam = () => {};

// ---------- pembantu ----------

const jedaMain = new Map(); // "guild:user" -> waktu main terakhir (cegah spam command)

// Mengembalikan teks penolakan, atau null kalau boleh main.
function gerbang(i, { jeda = true } = {}) {
  const boleh = cfg().channelBoleh ?? [];
  const sah = !boleh.length || boleh.includes(i.channelId) || (i.channel?.parentId && boleh.includes(i.channel.parentId)) || access.isManager(i);
  if (!sah) return `Game cuma bisa dimainkan di ${boleh.map((id) => `<#${id}>`).join(' ')}.`;
  if (jeda) {
    const key = `${i.guildId}:${i.user.id}`;
    const now = Date.now();
    const sisa = (jedaMain.get(key) ?? 0) + opsi.jedaDetik * 1000 - now;
    if (sisa > 0) return `Santai dulu, tunggu ${Math.ceil(sisa / 1000)} detik.`;
    jedaMain.set(key, now);
  }
  return null;
}

// Taruhan dari option "taruhan". Mengembalikan angka, atau teks kalau tidak valid.
function bacaTaruhan(i, wajib = true) {
  const n = i.options.getInteger('taruhan') ?? 0;
  const maks = cfg().taruhanMaks;
  if (!Number.isInteger(n) || n < 0 || (wajib && n < 1)) return 'Tulis taruhannya (minimal 1 koin).';
  if (n > maks) return `Taruhan maksimal ${t.koinTeks(maks)}.`;
  return n;
}

const kurang = (i, saldo) => reply(i, `Koinmu cuma ${t.koinTeks(saldo)}. Ambil \`/harian\` dulu atau pakai taruhan lebih kecil.`);

// Potong taruhan. false = koin tidak cukup (sudah dibalas ke user).
function potong(i, n) {
  if (n <= 0) return true;
  const subjek = who(i);
  if (data.kurangiKoin(i.guildId, subjek, n)) return true;
  kurang(i, data.koin(i.guildId, subjek));
  return false;
}

// Bayar hasil dan catat statistik. Mengembalikan saldo sekarang.
function bayar(i, taruhan, kembali) {
  const subjek = who(i);
  if (kembali > 0) data.tambahKoin(i.guildId, subjek, kembali);
  if (taruhan > 0) data.catatMain(i.guildId, subjek, kembali > taruhan);
  return data.koin(i.guildId, subjek);
}

const tunggu = (ms) => (ms > 0 ? runtime.sleep(ms) : Promise.resolve());

// ---------- slot ----------

async function slot(i) {
  const tolak = gerbang(i);
  if (tolak) return reply(i, tolak);
  const n = bacaTaruhan(i);
  if (typeof n === 'string') return reply(i, n);
  if (!potong(i, n)) return null;
  const h = games.putarSlot(opsi.rng);
  const saldo = bayar(i, n, n * h.kali);
  const ket = h.jenis === 'tiga' ? `🎉 Tiga sama! Dibayar **${h.kali}x**` : h.jenis === 'pasang' ? 'Dua gambar sama: taruhanmu kembali.' : 'Belum beruntung, coba lagi.';
  const akhir = t.hasilEmbed({ judul: '🎰 Slot', isi: `${t.slotTeks(h.gulungan)}\n${ket}`, kembali: n * h.kali, taruhan: n, saldo, warna: h.jenis === 'tiga' ? t.EMAS : undefined });
  if (opsi.animasiMs > 0) {
    await i.reply({ embeds: [embed(t.ABU, '🎰 Slot', `${t.slotTeks([...t.SLOT_PUTAR.split(' | ')])}\nMemutar...`)], ...umum });
    await tunggu(opsi.animasiMs);
    return i.editReply({ embeds: [akhir], ...umum }).catch(diam);
  }
  return i.reply({ embeds: [akhir], ...umum });
}

// ---------- dadu ----------

async function dadu(i) {
  const tolak = gerbang(i);
  if (tolak) return reply(i, tolak);
  const pilihan = i.options.getString('pilihan');
  if (!games.PILIHAN_DADU[pilihan]) return reply(i, 'Pilih kecil, tujuh, atau besar.');
  const n = bacaTaruhan(i);
  if (typeof n === 'string') return reply(i, n);
  if (!potong(i, n)) return null;
  const h = games.lemparDadu(pilihan, opsi.rng);
  const kembali = n * h.kali;
  const saldo = bayar(i, n, kembali);
  const isi = `🎲 ${h.dadu[0]} + 🎲 ${h.dadu[1]} = **${h.total}** (${games.PILIHAN_DADU[h.jatuh].nama})\nTebakanmu: ${games.PILIHAN_DADU[pilihan].nama}`;
  return i.reply({ embeds: [t.hasilEmbed({ judul: '🎲 Dadu', isi, kembali, taruhan: n, saldo })], ...umum });
}

// ---------- lempar koin ----------

async function lempar(i) {
  const tolak = gerbang(i);
  if (tolak) return reply(i, tolak);
  const pilihan = i.options.getString('pilihan');
  if (pilihan !== 'kepala' && pilihan !== 'ekor') return reply(i, 'Pilih kepala atau ekor.');
  const n = bacaTaruhan(i, false);
  if (typeof n === 'string') return reply(i, n);
  if (!potong(i, n)) return null;
  const h = games.lemparKoin(pilihan, opsi.rng);
  const saldo = bayar(i, n, n * h.kali);
  const hasil = { kepala: '🪙 Jatuh **kepala**', ekor: '🪙 Jatuh **ekor**', hilang: '🕳️ Koinnya menggelinding masuk got dan hilang!' }[h.sisi];
  const isi = `${hasil}\nTebakanmu: **${pilihan}**${h.menang ? ' ✅' : ''}`;
  return i.reply({ embeds: [t.hasilEmbed({ judul: '🪙 Lempar koin', isi, kembali: n * h.kali, taruhan: n, saldo, warna: n === 0 ? (h.menang ? t.HIJAU : t.MERAH) : undefined })], ...umum });
}

// ---------- suit ----------

const IKON_SUIT = { batu: '✊', gunting: '✌️', kertas: '✋' };

async function suit(i) {
  const tolak = gerbang(i);
  if (tolak) return reply(i, tolak);
  const pilihan = i.options.getString('pilihan');
  if (!IKON_SUIT[pilihan]) return reply(i, 'Pilih batu, gunting, atau kertas.');
  const n = bacaTaruhan(i, false);
  if (typeof n === 'string') return reply(i, n);
  if (!potong(i, n)) return null;
  const h = games.mainSuit(pilihan, opsi.rng);
  const saldo = bayar(i, n, n * h.kali);
  const ket = h.hasil === 'menang' ? 'Kamu menang!' : h.hasil === 'seri' ? 'Seri.' : 'Bot menang.';
  const isi = `Kamu ${IKON_SUIT[pilihan]} lawan bot ${IKON_SUIT[h.bot]}\n**${ket}**`;
  return i.reply({
    embeds: [t.hasilEmbed({ judul: '✊ Suit', isi, kembali: n * h.kali, taruhan: n, saldo, warna: n === 0 ? (h.hasil === 'menang' ? t.HIJAU : h.hasil === 'seri' ? t.ABU : t.MERAH) : undefined })],
    ...umum,
  });
}

// ---------- XO ----------

let urutan = 0;
const idBaru = () => `${Date.now().toString(36)}${(urutan++ % 1296).toString(36)}`;
const xoAktifDari = (g, userId) => Object.values(g.xo).some((x) => x.a === userId || x.b === userId);
const xoEmbed = (x, opts) => new EmbedBuilder().setColor(t.accent()).setTitle('⭕ XO').setDescription(t.xoTeks(x, opts));

async function xo(i) {
  const tolak = gerbang(i, { jeda: false });
  if (tolak) return reply(i, tolak);
  const lawan = i.options.getUser('lawan', true);
  const n = bacaTaruhan(i, false);
  if (typeof n === 'string') return reply(i, n);
  if (lawan.bot) return reply(i, 'Lawannya harus manusia, bot tidak bisa diajak main XO.');
  if (lawan.id === i.user.id) return reply(i, 'Tidak bisa menantang diri sendiri.');
  const g = data.guild(i.guildId);
  if (xoAktifDari(g, i.user.id)) return reply(i, 'Kamu masih punya tantangan atau permainan XO yang berjalan.');
  if (xoAktifDari(g, lawan.id)) return reply(i, `${lawan.username} sedang main XO. Tunggu dia selesai.`);
  const saldo = data.koin(i.guildId, who(i));
  if (n > 0 && saldo < n) return kurang(i, saldo);
  const id = idBaru();
  const x = { a: i.user.id, b: lawan.id, taruhan: n, papan: games.papanKosong(), giliran: 'a', status: 'ajak', at: Date.now(), ch: i.channelId, msg: null };
  g.xo[id] = x;
  data.save();
  await i.reply({
    content: `<@${lawan.id}>`,
    embeds: [xoEmbed(x, { status: `Menunggu <@${x.b}> menerima tantangan (${opsi.xoAjakMenit} menit).` })],
    components: t.xoAjakKomponen(id),
    allowedMentions: { users: [lawan.id] },
  });
  const m = await i.fetchReply?.().catch(() => null);
  if (m?.id) {
    x.msg = m.id;
    data.save();
  }
  return null;
}

// Akhiri permainan: bayar pemenang, catat statistik, hapus dari data. hasil = 'X' | 'O' | 'seri'.
function selesaiXo(gid, g, id, x, hasil) {
  delete g.xo[id];
  const a = { id: x.a };
  const b = { id: x.b };
  if (hasil === 'seri') {
    if (x.taruhan > 0) {
      data.tambahKoin(gid, a, x.taruhan);
      data.tambahKoin(gid, b, x.taruhan);
    }
    data.catatMain(gid, a, false);
    data.catatMain(gid, b, false);
  } else {
    const [menang, kalah] = hasil === 'X' ? [a, b] : [b, a];
    if (x.taruhan > 0) data.tambahKoin(gid, menang, x.taruhan * 2);
    data.catatMain(gid, menang, true);
    data.catatMain(gid, kalah, false);
  }
  data.save();
}

async function komponenXo(i, aksi, id, arg) {
  const gid = i.guildId;
  const g = data.guild(gid);
  const x = g.xo[id];
  if (!x) return i.update({ components: [] });
  const peserta = i.user.id === x.a || i.user.id === x.b;

  if (aksi === 'xa') {
    if (x.status !== 'ajak') return reply(i, 'Permainan ini sudah dimulai.');
    if (i.user.id === x.a) return reply(i, 'Menunggu lawanmu menerima. Klik "Tolak / batal" kalau mau membatalkan.');
    if (i.user.id !== x.b) return reply(i, 'Tantangan ini bukan untukmu.');
    if (x.taruhan > 0) {
      if (!data.kurangiKoin(gid, { id: x.a }, x.taruhan)) {
        delete g.xo[id];
        data.save();
        return i.update({ content: null, embeds: [xoEmbed(x, { status: '❌ Dibatalkan: koin penantang tidak cukup lagi.' })], components: [] });
      }
      if (!data.kurangiKoin(gid, who(i), x.taruhan)) {
        data.tambahKoin(gid, { id: x.a }, x.taruhan);
        return kurang(i, data.koin(gid, who(i)));
      }
    }
    x.status = 'main';
    x.at = Date.now();
    data.save();
    return i.update({ content: null, embeds: [xoEmbed(x)], components: t.xoKomponen(id, x) });
  }

  if (aksi === 'xr') {
    if (x.status !== 'ajak') return reply(i, 'Permainan sudah berjalan. Pakai tombol Menyerah kalau mau berhenti.');
    if (!peserta) return reply(i, 'Tantangan ini bukan untukmu.');
    delete g.xo[id];
    data.save();
    const ket = i.user.id === x.a ? 'dibatalkan oleh penantang' : 'ditolak';
    return i.update({ content: null, embeds: [xoEmbed(x, { status: `❌ Tantangan ${ket}.` })], components: [] });
  }

  if (x.status !== 'main') return reply(i, 'Tantangannya belum diterima.');
  if (!peserta) return reply(i, 'Kamu bukan pemain di permainan ini. Tantang orang lain dengan /xo.');

  if (aksi === 'xs') {
    const hasil = i.user.id === x.a ? 'O' : 'X';
    selesaiXo(gid, g, id, x, hasil);
    const menang = hasil === 'X' ? x.a : x.b;
    return i.update({ content: null, embeds: [xoEmbed(x, { status: `🏳️ <@${i.user.id}> menyerah. 🏆 <@${menang}> menang!${x.taruhan > 0 ? ` Membawa ${t.koinTeks(x.taruhan * 2)}.` : ''}` })], components: t.xoKomponen(id, x, { selesai: true }) });
  }

  // aksi === 'xc': isi satu kotak
  if (i.user.id !== x[x.giliran]) return reply(i, 'Bukan giliranmu.');
  const simbol = x.giliran === 'a' ? 'X' : 'O';
  const papan = games.langkahXo(x.papan, Number(arg), simbol);
  if (!papan) return reply(i, 'Kotak itu sudah terisi.');
  x.papan = papan;
  x.at = Date.now();
  const menang = games.pemenangXo(papan);
  if (menang || games.penuhXo(papan)) {
    selesaiXo(gid, g, id, x, menang ? menang.simbol : 'seri');
    return i.update({
      content: null,
      embeds: [xoEmbed(x, menang ? { menang: menang.simbol } : { seri: true })],
      components: t.xoKomponen(id, x, { selesai: true, garis: menang?.garis ?? [] }),
    });
  }
  x.giliran = x.giliran === 'a' ? 'b' : 'a';
  data.save();
  return i.update({ content: null, embeds: [xoEmbed(x)], components: t.xoKomponen(id, x) });
}

// ---------- kuis ----------

const kuisAktif = new Map(); // "guild:channel" -> kuis yang sedang berjalan (hanya di memori)
let urutKuis = 0;

async function kuis(i) {
  const tolak = gerbang(i);
  if (tolak) return reply(i, tolak);
  const kategori = i.options.getString('kategori') ?? 'campur';
  const key = `${i.guildId}:${i.channelId}`;
  const lama = kuisAktif.get(key);
  if (lama && Date.now() < lama.sampai) return reply(i, 'Masih ada kuis yang berjalan di channel ini. Jawab dulu ya.');
  const s = soal.pilih(kategori, data.guild(i.guildId).soal, opsi.rng);
  if (!s) return reply(i, 'Belum ada soal buatan server. Pengelola bisa menambahkannya dengan `/atur-game soal-tambah`.');
  const q = {
    qid: `${Date.now().toString(36)}${urutKuis++ % 1296}`, key, soal: s, kategori: soal.KATEGORI[kategori] ?? 'Campuran',
    hadiah: cfg().kuis, sampai: Date.now() + opsi.kuisDetik * 1000, jawab: new Set(), msg: null, timer: null,
  };
  kuisAktif.set(key, q);
  q.timer = setTimeout(() => akhiriKuis(q), opsi.kuisDetik * 1000);
  q.timer.unref?.();
  await i.reply({
    embeds: [t.kuisEmbed({ soal: s, kategori: q.kategori, hadiah: q.hadiah, detik: opsi.kuisDetik })],
    components: t.kuisTombol(q.qid, s), ...umum,
  });
  q.msg = await i.fetchReply?.().catch(() => null);
  return null;
}

// Waktu habis tanpa pemenang.
function akhiriKuis(q) {
  if (kuisAktif.get(q.key) !== q) return;
  kuisAktif.delete(q.key);
  q.msg?.edit?.({
    embeds: [t.kuisEmbed({ soal: q.soal, kategori: q.kategori, hadiah: q.hadiah, selesai: { pemenang: null } })],
    components: t.kuisTombol(q.qid, q.soal, { mati: true }),
  })?.catch?.(diam);
}

async function jawabKuis(i, qid, idx) {
  const q = [...kuisAktif.values()].find((x) => x.qid === qid);
  if (!q) return reply(i, 'Kuis ini sudah berakhir.');
  if (q.jawab.has(i.user.id)) return reply(i, 'Kamu sudah menjawab di kuis ini.');
  q.jawab.add(i.user.id);
  if (idx !== q.soal.benar) return reply(i, '❌ Salah. Kamu tidak bisa menjawab lagi di kuis ini.');
  clearTimeout(q.timer);
  kuisAktif.delete(q.key);
  if (q.hadiah > 0) data.tambahKoin(i.guildId, who(i), q.hadiah);
  data.catatMain(i.guildId, who(i), true);
  return i.update({
    embeds: [t.kuisEmbed({ soal: q.soal, kategori: q.kategori, hadiah: q.hadiah, selesai: { pemenang: i.user.id } })],
    components: t.kuisTombol(q.qid, q.soal, { mati: true }),
  });
}

// ---------- blackjack ----------

// Bayar hasil tangan dan hapus dari data. Mengembalikan { hasil, kembali, saldo }.
function tutupBj(gid, uid, s) {
  const g = data.guild(gid);
  const h = games.selesaikanBj(s);
  delete g.bj[uid];
  if (h.kembali > 0) data.tambahKoin(gid, { id: uid }, h.kembali);
  data.catatMain(gid, { id: uid }, h.kembali > s.taruhan);
  data.save();
  return { ...h, saldo: data.koin(gid, { id: uid }) };
}

async function blackjack(i) {
  const tolak = gerbang(i, { jeda: false });
  if (tolak) return reply(i, tolak);
  const n = bacaTaruhan(i);
  if (typeof n === 'string') return reply(i, n);
  const g = data.guild(i.guildId);
  const uid = i.user.id;
  if (g.bj[uid]) {
    const s = g.bj[uid];
    const link = s.msg ? ` https://discord.com/channels/${i.guildId}/${s.ch}/${s.msg}` : '';
    return reply(i, `Kamu masih punya permainan blackjack yang belum selesai.${link}`);
  }
  if (!potong(i, n)) return null;
  const s = games.mulaiBj(n, opsi.rng);
  s.at = Date.now();
  s.ch = i.channelId;
  s.msg = null;
  const nama = namaDi(i);
  if (s.selesai) {
    g.bj[uid] = s;
    const h = tutupBj(i.guildId, uid, s);
    return i.reply({ embeds: [t.bjEmbed({ s, nama, hasil: h.hasil, kembali: h.kembali, saldo: h.saldo })], ...umum });
  }
  g.bj[uid] = s;
  data.save();
  const bisaGanda = data.koin(i.guildId, who(i)) >= n;
  await i.reply({ embeds: [t.bjEmbed({ s, nama, bisaGanda })], components: t.bjTombol(uid, bisaGanda), ...umum });
  const m = await i.fetchReply?.().catch(() => null);
  if (m?.id) {
    s.msg = m.id;
    data.save();
  }
  return null;
}

async function komponenBj(i, aksi, uid) {
  if (i.user.id !== uid) return reply(i, 'Ini bukan permainanmu. Main sendiri dengan `/blackjack`.');
  const gid = i.guildId;
  const g = data.guild(gid);
  const s = g.bj[uid];
  if (!s) return reply(i, 'Permainan ini sudah selesai.');
  const nama = namaDi(i);
  if (aksi === 'bd') {
    if (s.pemain.length !== 2) return reply(i, 'Gandakan hanya bisa di awal, sebelum menarik kartu.');
    if (!data.kurangiKoin(gid, { id: uid }, s.taruhan)) return kurang(i, data.koin(gid, { id: uid }));
    s.taruhan *= 2;
    s.ganda = true;
    games.tarikBj(s);
  } else if (aksi === 'bh') {
    games.tarikBj(s);
  }
  if (aksi === 'bs' || aksi === 'bd' || s.selesai) {
    const h = tutupBj(gid, uid, s);
    return i.update({ embeds: [t.bjEmbed({ s, nama, hasil: h.hasil, kembali: h.kembali, saldo: h.saldo })], components: [] });
  }
  s.at = Date.now();
  data.save();
  return i.update({ embeds: [t.bjEmbed({ s, nama, bisaGanda: false })], components: t.bjTombol(uid, false) });
}

// ---------- komponen: pintu masuk ----------

async function komponen(i) {
  const [, aksi, a, b] = i.customId.split(':');
  if (aksi.startsWith('x')) return komponenXo(i, aksi, a, b);
  if (aksi.startsWith('b')) return komponenBj(i, aksi, a);
  if (aksi === 'qa') return jawabKuis(i, a, Number(b));
  return null;
}

// ---------- penyapu: tantangan XO dan blackjack yang ditinggal ----------

async function ubahPesan(client, chId, msgId, payload) {
  if (!chId || !msgId) return;
  try {
    const ch = client.channels?.cache?.get(chId) ?? await client.channels.fetch(chId);
    const m = await ch.messages.fetch(msgId);
    await m.edit(payload);
  } catch (err) {
    diam(err);
  }
}

async function sweep(client, now = Date.now()) {
  for (const [gid, g] of Object.entries(data.db.data)) {
    for (const [id, x] of Object.entries(g.xo ?? {})) {
      if (x.status === 'ajak' && now - x.at > opsi.xoAjakMenit * 60e3) {
        delete g.xo[id];
        data.save();
        await ubahPesan(client, x.ch, x.msg, { content: null, embeds: [xoEmbed(x, { status: '⌛ Tantangan kedaluwarsa karena tidak dijawab.' })], components: [] });
      } else if (x.status === 'main' && now - x.at > opsi.xoIdleMenit * 60e3) {
        // yang sedang giliran dan tidak bergerak dianggap menyerah
        const hasil = x.giliran === 'a' ? 'O' : 'X';
        const kalah = x[x.giliran];
        selesaiXo(gid, g, id, x, hasil);
        const menang = hasil === 'X' ? x.a : x.b;
        await ubahPesan(client, x.ch, x.msg, {
          content: null,
          embeds: [xoEmbed(x, { status: `⌛ <@${kalah}> terlalu lama tidak bergerak. 🏆 <@${menang}> menang!${x.taruhan > 0 ? ` Membawa ${t.koinTeks(x.taruhan * 2)}.` : ''}` })],
          components: t.xoKomponen(id, x, { selesai: true }),
        });
      }
    }
    for (const [uid, s] of Object.entries(g.bj ?? {})) {
      if (now - s.at <= opsi.bjIdleMenit * 60e3) continue;
      const h = tutupBj(gid, uid, s); // ditinggal terlalu lama: otomatis tahan
      await ubahPesan(client, s.ch, s.msg, {
        embeds: [t.bjEmbed({ s, nama: 'Pemain', hasil: h.hasil, kembali: h.kembali, saldo: h.saldo })], components: [],
      });
    }
  }
  for (const [k, w] of jedaMain) if (now - w > 60e3) jedaMain.delete(k);
}

function reset() {
  for (const q of kuisAktif.values()) clearTimeout(q.timer);
  kuisAktif.clear();
  jedaMain.clear();
}

module.exports = { opsi, slot, dadu, lempar, suit, xo, kuis, blackjack, komponen, sweep, reset, kuisAktif, bacaTaruhan, gerbang };
