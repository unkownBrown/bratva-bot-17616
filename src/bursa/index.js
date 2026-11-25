// Bursa harga Disnaker: /harga, /jual, /penghasilan, /rekap, /bursa (pengelola).
// Mati sampai dinyalakan di /panel → Bursa harga. Command-nya baru muncul di Discord setelah dinyalakan.
const {
  SlashCommandBuilder, InteractionContextType, MessageFlags, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');
const store = require('../store');
const access = require('../access');
const panels = require('../panels');
const h = require('./harga');
const data = require('./data');
const t = require('./tampilan');

const EPHEMERAL = MessageFlags.Ephemeral;
const COMMANDS = new Set(['harga', 'jual', 'penghasilan', 'rekap', 'bursa']);
const MENIT_BATAL = 30; // member boleh membatalkan penjualannya sendiri selama ini; sesudahnya hanya pengelola
const MAKS_BARIS = 25;
const KHUSUS = 'Ini khusus yang punya izin Manage Server atau role pengelola bot.';
const cfg = () => store.loadSettings().bursa;

// ---------- command ----------

function commands() {
  const g = (b) => b.setContexts(InteractionContextType.Guild);
  const periode = (o, ekstra = []) => o.setName('periode').setDescription('Periode (bawaan: minggu ini)').addChoices(
    { name: 'Hari ini', value: 'hari' }, { name: 'Minggu ini', value: 'minggu' }, { name: 'Bulan ini', value: 'bulan' },
    { name: 'Semua waktu', value: 'semua' }, ...ekstra,
  );
  const lalu = [{ name: 'Minggu lalu', value: 'minggulalu' }];
  return [
    g(new SlashCommandBuilder().setName('harga').setDescription('Lihat daftar harga Disnaker terbaru'))
      .addStringOption((o) => o.setName('cari').setDescription('Lihat satu barang saja (kosong = semua)').setAutocomplete(true).setMaxLength(60))
      .addBooleanOption((o) => o.setName('tampilkan').setDescription('Tampilkan ke semua orang di channel ini')),
    g(new SlashCommandBuilder().setName('jual').setDescription('Catat barang yang sudah kamu jual ke Disnaker'))
      .addStringOption((o) => o.setName('barang').setDescription('Barang yang dijual (kosong = catat banyak barang sekaligus)').setAutocomplete(true).setMaxLength(60))
      .addIntegerOption((o) => o.setName('jumlah').setDescription('Berapa (bawaan 1)').setMinValue(1).setMaxValue(h.MAKS_JUMLAH))
      .addStringOption((o) => o.setName('satuan').setDescription('Satuan jumlah (bawaan: paket, atau pcs untuk barang satuan)')
        .addChoices({ name: 'Paket', value: 'paket' }, { name: 'Pcs (eceran)', value: 'pcs' })),
    g(new SlashCommandBuilder().setName('penghasilan').setDescription('Lihat total penghasilan dari penjualanmu'))
      .addStringOption((o) => periode(o))
      .addUserOption((o) => o.setName('member').setDescription('Member lain (khusus pengelola)')),
    g(new SlashCommandBuilder().setName('rekap').setDescription('Rekap penghasilan semua orang (khusus pengelola)'))
      .addStringOption((o) => periode(o, lalu))
      .addBooleanOption((o) => o.setName('tampilkan').setDescription('Tampilkan ke semua orang di channel ini')),
    g(new SlashCommandBuilder().setName('bursa').setDescription('Atur bursa harga Disnaker (khusus pengelola)'))
      .addSubcommand((s) => s.setName('harga-baru').setDescription('Tempel daftar harga terbaru (otomatis dibaca dan diperbarui)'))
      .addSubcommand((s) => s.setName('atur').setDescription('Tambah barang atau ubah harga satu barang')
        .addStringOption((o) => o.setName('nama').setDescription('Nama barang').setRequired(true).setAutocomplete(true).setMaxLength(60))
        .addIntegerOption((o) => o.setName('harga').setDescription('Harga per paket (atau per pcs kalau isi = 1)').setRequired(true).setMinValue(1).setMaxValue(h.MAKS_HARGA))
        .addIntegerOption((o) => o.setName('isi').setDescription('Isi satu paket dalam pcs (bawaan: tetap / 1)').setMinValue(1).setMaxValue(100000))
        .addStringOption((o) => o.setName('kategori').setDescription('Kelompok, mis. Tambang Baru atau Depot').setMaxLength(30)))
      .addSubcommand((s) => s.setName('hapus').setDescription('Hapus barang dari daftar harga (catatan lama tetap ada)')
        .addStringOption((o) => o.setName('barang').setDescription('Barang yang dihapus').setRequired(true).setAutocomplete(true).setMaxLength(60)))
      .addSubcommand((s) => s.setName('papan').setDescription('Pasang papan harga di sebuah channel (ikut diperbarui otomatis)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel tujuan').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
      .addSubcommand((s) => s.setName('riwayat').setDescription('Penjualan terbaru (lengkap dengan nomornya)')
        .addUserOption((o) => o.setName('member').setDescription('Hanya penjualan member ini')))
      .addSubcommand((s) => s.setName('hapus-catatan').setDescription('Hapus satu penjualan yang salah catat')
        .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor penjualan (lihat di /bursa riwayat)').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('ekspor').setDescription('Unduh semua catatan penjualan sebagai file CSV (buka di Excel)')
        .addStringOption((o) => periode(o))),
  ].map((c) => c.toJSON());
}

const enabledCommands = () => (cfg().aktif ? commands() : []);

const owns = (i) => ((i.isChatInputCommand?.() || i.isAutocomplete?.()) && COMMANDS.has(i.commandName))
  || Boolean((i.isMessageComponent?.() || i.isModalSubmit?.()) && /^kb:/.test(i.customId ?? ''));

// ---------- pembantu ----------

const reply = (i, content, extra = {}) => i.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] }, ...extra });
const say = (i, content) => (i.deferred || i.replied ? i.editReply({ content }) : reply(i, content));
const userTag = (u) => u.tag ?? u.username;

function bolehCatat(i) {
  const roles = cfg().role ?? [];
  if (!roles.length || access.isManager(i)) return true;
  const r = i.member?.roles;
  return roles.some((id) => (Array.isArray(r) ? r.includes(id) : Boolean(r?.cache?.has(id))));
}

const tolakCatat = (i) => reply(i, 'Kamu belum punya role yang boleh mencatat penjualan. Hubungi pengelola server.');

function logKe(guild, embed) {
  if (!cfg().log) return;
  const ch = panels.moduleChannel(guild, 'bursa');
  ch?.send?.({ embeds: [embed], allowedMentions: { parse: [] } })?.catch?.(() => {});
}

const ambiguText = (c, q) => `"${q}" cocok dengan beberapa barang: ${c.ambigu.slice(0, 6).map((b) => b.nama).join(', ')}. Tulis lebih lengkap.`;

function ringkasan(guildId, userId, now = Date.now()) {
  const f = (p) => data.ringkas(guildId, { ...h.rentang(p, now), userId });
  return { hari: f('hari'), minggu: f('minggu'), bulan: f('bulan'), semua: f('semua') };
}

// ---------- kotak isian ----------

const inputBaris = (id, label, placeholder, max = 4000) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true)
    .setMaxLength(max).setPlaceholder(placeholder.slice(0, 100)),
);

const jualModal = () => new ModalBuilder().setCustomId('kb:j').setTitle('Catat penjualan')
  .addComponents(inputBaris('daftar', 'Barang yang kamu jual (satu per baris)', 'kaca 3\nbotol 2 paket\nplastik 150 pcs\nberlian 5', 1500));

// customId dipilih pemanggil: 'kb:h' (lewat /bursa harga-baru) atau 'set:bursasubmit' (lewat panel).
const hargaModal = (customId = 'kb:h') => new ModalBuilder().setCustomId(customId).setTitle('Perbarui daftar harga')
  .addComponents(inputBaris('daftar', 'Tempel daftar harga terbaru', 'TAMBANG BARU :\nKaca : $50.000 / Paket (100 pcs)\nBerlian : $6.000 (1 Pcs)'));

// ---------- /harga ----------

function slashHarga(i) {
  const flags = i.options.getBoolean('tampilkan') ? undefined : EPHEMERAL;
  const q = i.options.getString('cari');
  if (q) {
    const c = data.cari(i.guildId, q);
    if (c.item) return i.reply({ embeds: [t.barangEmbed(c.item)], flags });
    return reply(i, c.ambigu ? ambiguText(c, q) : `Barang "${q}" tidak ada di daftar harga. Lihat semuanya dengan \`/harga\`.`);
  }
  const g = data.guild(i.guildId);
  return i.reply({ ...t.papanPayload(g.barang, g.diperbarui), flags });
}

// ---------- mencatat penjualan ----------

// baris: [{ item, qty, satuan }], galat: baris yang gagal dibaca (hanya untuk ditampilkan).
function catat(i, baris, galat, via) {
  if (baris.length > MAKS_BARIS) return reply(i, `Terlalu banyak baris (maksimal ${MAKS_BARIS} sekali catat).`);
  const hitung = baris.map(({ item, qty, satuan }) => h.hitung(item, qty, satuan));
  const trx = data.tambahTrx(i.guildId, { userId: i.user.id, userTag: userTag(i.user), baris: hitung, via });
  const { hari, minggu } = ringkasan(i.guildId, i.user.id, trx.at);
  logKe(i.guild, t.logPenjualan(trx));
  return i.reply({
    embeds: [t.strukEmbed({ trx, galat, hari, minggu, menitBatal: MENIT_BATAL })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kb:u:${trx.id}`).setLabel('Batalkan').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('kb:m').setLabel('Catat lagi').setStyle(ButtonStyle.Secondary),
    )],
    flags: EPHEMERAL, allowedMentions: { parse: [] },
  });
}

function slashJual(i) {
  if (!bolehCatat(i)) return tolakCatat(i);
  const nama = i.options.getString('barang');
  if (!nama) return i.showModal(jualModal());
  const c = data.cari(i.guildId, nama);
  if (c.ambigu) return reply(i, ambiguText(c, nama));
  if (!c.item) return reply(i, `Barang "${nama}" tidak ada di daftar harga. Cek \`/harga\`.`);
  const qty = i.options.getInteger('jumlah') ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > h.MAKS_JUMLAH) return reply(i, `Jumlah harus 1 sampai ${h.angka(h.MAKS_JUMLAH)}.`);
  return catat(i, [{ item: c.item, qty, satuan: i.options.getString('satuan') ?? h.satuanDari(c.item.isi) }], [], 'slash');
}

function submitJual(i) {
  if (!bolehCatat(i)) return tolakCatat(i);
  const { baris, galat } = h.parseJual(i.fields.getTextInputValue('daftar'), data.barang(i.guildId));
  if (!baris.length) {
    const sebab = galat.length ? galat.slice(0, 8).map((g) => `• \`${g.teks}\`: ${g.alasan}`).join('\n') : 'Kotaknya kosong.';
    return reply(i, `Tidak ada yang dicatat.\n${sebab}\n\nTulis satu barang per baris, contoh: \`kaca 3\`, \`botol 2 paket\`, \`plastik 150 pcs\`.`);
  }
  return catat(i, baris, galat, 'modal');
}

async function batalkan(i, id) {
  const trx = data.trxById(i.guildId, id);
  if (!trx) return i.update({ content: 'Penjualan ini sudah tidak ada (mungkin sudah dibatalkan).', embeds: [], components: [] });
  const manager = access.isManager(i);
  if (trx.userId !== i.user.id && !manager) return reply(i, 'Itu bukan penjualanmu.');
  if (!manager && Date.now() - trx.at > MENIT_BATAL * 60e3) {
    return reply(i, `Batas membatalkan sendiri (${MENIT_BATAL} menit) sudah lewat. Minta pengelola menghapusnya dengan \`/bursa hapus-catatan nomor:${id}\`.`);
  }
  data.hapusTrx(i.guildId, id);
  logKe(i.guild, t.logBatal(trx, i.user.id));
  return i.update({ content: `↩️ Penjualan #${id} (${h.uang(trx.total)}) dibatalkan.`, embeds: [], components: [] });
}

// ---------- /penghasilan dan /rekap ----------

function tampilPenghasilan(i, user, periode = 'minggu') {
  const r = data.ringkas(i.guildId, { ...h.rentang(periode), userId: user.id });
  const embed = t.penghasilanEmbed({
    user, label: h.rentang(periode).label, r, ringkasan: ringkasan(i.guildId, user.id),
    terakhir: data.trxTerbaru(i.guildId, { userId: user.id, n: 5 }),
  });
  return i.reply({ embeds: [embed], flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

function slashPenghasilan(i) {
  const target = i.options.getUser('member') ?? i.user;
  if (target.id !== i.user.id && !access.isManager(i)) return reply(i, 'Melihat penghasilan orang lain khusus pengelola.');
  return tampilPenghasilan(i, target, i.options.getString('periode') ?? 'minggu');
}

function rekapEmbedUntuk(guildId, periode, judul) {
  const rg = h.rentang(periode);
  return t.rekapEmbed({ judul, label: rg.label, r: data.ringkas(guildId, rg), dari: rg.dari, sampai: rg.sampai });
}

function slashRekap(i) {
  const flags = i.options.getBoolean('tampilkan') ? undefined : EPHEMERAL;
  return i.reply({ embeds: [rekapEmbedUntuk(i.guildId, i.options.getString('periode') ?? 'minggu')], flags, allowedMentions: { parse: [] } });
}

// ---------- papan harga ----------

// Pasang papan di channel (atau pindahkan ke channel baru). Papan lama dihapus kalau pindah channel.
async function pasangPapan(guild, channel) {
  const g = data.guild(guild.id);
  const payload = { ...t.papanPayload(g.barang, g.diperbarui), allowedMentions: { parse: [] } };
  const lama = g.papan;
  if (lama?.channelId === channel.id) {
    const msg = await channel.messages.fetch(lama.messageId).catch(() => null);
    if (msg) {
      await msg.edit(payload);
      return msg;
    }
  }
  const msg = await channel.send(payload);
  data.setPapan(guild.id, { channelId: channel.id, messageId: msg.id });
  if (lama && lama.channelId !== channel.id) {
    const ch = guild.channels.cache.get(lama.channelId);
    const m = await ch?.messages.fetch(lama.messageId).catch(() => null);
    await m?.delete?.().catch(() => {});
  }
  return msg;
}

// Dipanggil setelah harga berubah: pesan papan diedit (atau dikirim ulang kalau pesannya sudah dihapus orang).
async function refreshPapan(guild) {
  const papan = data.guild(guild.id).papan;
  if (!papan) return false;
  const ch = guild.channels.cache.get(papan.channelId);
  if (!ch) return false;
  try {
    await pasangPapan(guild, ch);
    return true;
  } catch (err) {
    console.error(`[bursa] papan harga: ${err.message}`);
    return false;
  }
}

// ---------- pengelola ----------

function submitHargaBaru(i) {
  const parse = h.parseDaftar(i.fields.getTextInputValue('daftar'));
  if (!parse.items.length) {
    const gagal = parse.tidakTerbaca.slice(0, 6).map((x) => `• \`${x.baris}\`: ${x.alasan}`).join('\n');
    return reply(i, `Tidak ada harga yang terbaca. Tulis satu barang per baris, contoh:\n\`Kaca : $50.000 / Paket (100 pcs)\`\n\`Berlian : $6.000 (1 Pcs)\`${gagal ? `\n\n${gagal}` : ''}`);
  }
  const hasil = data.terapkanDaftar(i.guildId, parse.items);
  const berubah = hasil.baru.length + hasil.berubah.length > 0;
  if (berubah) {
    refreshPapan(i.guild).catch(() => {});
    logKe(i.guild, t.hasilHargaEmbed({ hasil, parse }).setAuthor({ name: `Diperbarui oleh ${userTag(i.user)}` }));
  }
  return i.reply({ embeds: [t.hasilHargaEmbed({ hasil, parse })], flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

async function admin(i) {
  const sub = i.options.getSubcommand();
  const gid = i.guildId;
  switch (sub) {
    case 'harga-baru': return i.showModal(hargaModal('kb:h'));
    case 'atur': {
      const nama = i.options.getString('nama', true).trim();
      const harga = i.options.getInteger('harga', true);
      const isi = i.options.getInteger('isi');
      if (!/\p{L}/u.test(nama) || nama.length > 60) return reply(i, 'Nama barang tidak valid (harus ada huruf, maksimal 60).');
      if (!Number.isInteger(harga) || harga < 1 || harga > h.MAKS_HARGA) return reply(i, 'Harga tidak valid.');
      const kategori = i.options.getString('kategori')?.trim() || null;
      const r = data.simpanBarang(gid, { nama, harga, isi, kategori: kategori ? h.judul(kategori).slice(0, 30) : null });
      refreshPapan(i.guild).catch(() => {});
      const b = r.barang;
      const dulu = r.dulu ? ` (sebelumnya ${h.uang(r.dulu.harga)}${r.dulu.isi !== b.isi ? `, isi ${r.dulu.isi} pcs` : ''})` : '';
      return reply(i, `${r.baru ? '➕ Barang baru' : '✏️ Diperbarui'}: **${b.nama}** · ${t.hargaTeks(b)} · ${b.kategori}${dulu}`);
    }
    case 'hapus': {
      const q = i.options.getString('barang', true);
      const c = data.cari(gid, q);
      if (c.ambigu) return reply(i, ambiguText(c, q));
      if (!c.item) return reply(i, `Barang "${q}" tidak ada di daftar.`);
      data.hapusBarang(gid, c.item.id);
      refreshPapan(i.guild).catch(() => {});
      return reply(i, `🗑️ **${c.item.nama}** dihapus dari daftar harga. Penjualan yang sudah tercatat tidak berubah.`);
    }
    case 'papan': {
      const ch = i.options.getChannel('channel', true);
      await i.deferReply({ flags: EPHEMERAL });
      try {
        await pasangPapan(i.guild, ch);
      } catch (err) {
        return i.editReply({ content: `Gagal memasang papan di ${ch}: ${err.message}. Pastikan bot boleh melihat dan menulis di channel itu.` });
      }
      return i.editReply({ content: `Papan harga terpasang di ${ch}. Ikut diperbarui otomatis setiap harga berubah.` });
    }
    case 'riwayat': {
      const u = i.options.getUser('member');
      const list = data.trxTerbaru(gid, { userId: u?.id ?? null, n: 15 });
      return i.reply({ embeds: [t.riwayatEmbed(list, u ? `Penjualan terbaru ${userTag(u)}` : 'Penjualan terbaru')], flags: EPHEMERAL, allowedMentions: { parse: [] } });
    }
    case 'hapus-catatan': {
      const id = i.options.getInteger('nomor', true);
      const trx = data.hapusTrx(gid, id);
      if (!trx) return reply(i, `Penjualan #${id} tidak ada.`);
      logKe(i.guild, t.logBatal(trx, i.user.id));
      return reply(i, `🗑️ Penjualan #${id} milik <@${trx.userId}> (${h.uang(trx.total)}) dihapus.`);
    }
    case 'ekspor': {
      const rg = h.rentang(i.options.getString('periode') ?? 'semua');
      const list = data.trxDalam(gid, rg);
      if (!list.length) return reply(i, 'Belum ada penjualan tercatat di periode itu.');
      const nama = `penjualan-${new Date().toISOString().slice(0, 10)}.csv`;
      return i.reply({ content: `${list.length} penjualan · ${rg.label}`, files: [new AttachmentBuilder(Buffer.from(t.csv(list), 'utf8'), { name: nama })], flags: EPHEMERAL });
    }
    default: return null;
  }
}

// ---------- pintu masuk ----------

function autocomplete(i) {
  if (!cfg().aktif) return i.respond([]);
  const semua = data.barang(i.guildId);
  const q = h.norm(i.options.getFocused());
  let cocok = q ? semua.filter((b) => h.norm(b.nama).includes(q)) : semua;
  if (!cocok.length) {
    const c = h.cari(semua, q);
    cocok = c.item ? [c.item] : (c.ambigu ?? []);
  }
  return i.respond(cocok.slice(0, 25).map((b) => ({ name: `${b.nama} · ${t.hargaTeks(b)}`.slice(0, 100), value: b.nama.slice(0, 100) })));
}

async function slash(i) {
  const manager = access.isManager(i);
  if (!cfg().aktif) {
    return reply(i, manager ? 'Bursa harga belum dinyalakan. Buka **/panel → Bursa harga** lalu nyalakan **Bursa harga**.' : 'Fitur ini belum dinyalakan oleh pengelola server.');
  }
  switch (i.commandName) {
    case 'harga': return slashHarga(i);
    case 'jual': return slashJual(i);
    case 'penghasilan': return slashPenghasilan(i);
    case 'rekap': return manager ? slashRekap(i) : reply(i, KHUSUS);
    case 'bursa': return manager ? admin(i) : reply(i, KHUSUS);
    default: return null;
  }
}

async function komponen(i) {
  if (!cfg().aktif) return reply(i, 'Bursa harga sedang dimatikan oleh pengelola.');
  const [, aksi, arg] = i.customId.split(':');
  if (i.isModalSubmit()) {
    if (aksi === 'j') return submitJual(i);
    if (aksi === 'h') return access.isManager(i) ? submitHargaBaru(i) : reply(i, KHUSUS);
    return null;
  }
  switch (aksi) {
    case 'm': return bolehCatat(i) ? i.showModal(jualModal()) : tolakCatat(i);
    case 's': return tampilPenghasilan(i, i.user, 'minggu');
    case 'u': return batalkan(i, Number(arg));
    default: return null;
  }
}

async function handle(i) {
  try {
    if (i.isAutocomplete()) return await autocomplete(i);
    if (i.isChatInputCommand()) return await slash(i);
    return await komponen(i);
  } catch (err) {
    console.error(`[bursa] ${err.stack ?? err.message}`);
    if (i.isAutocomplete()) return null;
    return say(i, `❌ ${err.message}`).catch(() => {});
  }
}

// ---------- rekap mingguan otomatis ----------

let timer = null;
const percobaan = new Map(); // "guild:minggu" -> berapa kali gagal kirim

// Senin dini hari (WIB): kirim rekap minggu lalu ke channel log bursa, sekali per minggu. Tidak ada penjualan = tidak dikirim.
async function rekapMingguan(guild, now = Date.now()) {
  const c = store.peekSettings().bursa;
  if (!c.aktif || !c.rekapMingguan) return false;
  const g = data.guild(guild.id);
  const minggu = h.awalMinggu(now);
  if (g.rekapTerakhir >= minggu) return false;
  const rg = h.rentang('minggulalu', now);
  const r = data.ringkas(guild.id, rg);
  if (!r.jumlahTrx) {
    data.tandaiRekap(guild.id, minggu);
    return false;
  }
  const ch = panels.moduleChannel(guild, 'bursa');
  if (!ch?.send) return false;
  const key = `${guild.id}:${minggu}`;
  if ((percobaan.get(key) ?? 0) >= 5) return false;
  try {
    await ch.send({ embeds: [t.rekapEmbed({ judul: 'Rekap mingguan bursa harga', label: rg.label, r, dari: rg.dari, sampai: rg.sampai })], allowedMentions: { parse: [] } });
  } catch (err) {
    percobaan.set(key, (percobaan.get(key) ?? 0) + 1);
    console.error(`[bursa] rekap mingguan: ${err.message}`);
    return false;
  }
  data.tandaiRekap(guild.id, minggu);
  return true;
}

async function sweep(client, now = Date.now()) {
  for (const guild of client.guilds.cache.values()) {
    await rekapMingguan(guild, now).catch((err) => console.error(`[bursa] ${err.message}`));
  }
}

function warmup(client) {
  if (timer) return;
  timer = setInterval(() => sweep(client).catch((err) => console.error(`[bursa] ${err.message}`)), 60e3);
  timer.unref?.();
}

function shutdown() {
  clearInterval(timer);
  timer = null;
  data.flush();
}

// ---------- untuk panel ----------

function summary(guildId) {
  if (!cfg().aktif) return 'mati';
  const g = data.guild(guildId);
  const minggu = data.ringkas(guildId, h.rentang('minggu'));
  return `aktif · ${g.barang.length} barang, ${g.trx.length} penjualan tercatat · minggu ini ${h.uang(minggu.total)}`;
}

module.exports = {
  commands, enabledCommands, owns, handle, warmup, shutdown, sweep, rekapMingguan, summary, flush: data.flush,
  hargaModal, submitHargaBaru, pasangPapan, refreshPapan, rekapEmbedUntuk, data, harga: h,
};
