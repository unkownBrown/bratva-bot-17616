// Moderasi: /warn (+ klik kanan > Apps > Beri peringatan) yang dikirim lewat DM, /dm, /mod (timeout, kick, ban, purge, riwayat, ...), dan /automod.
// Mati sampai dinyalakan di /panel → Fitur lainnya. Command-nya baru muncul di Discord setelah dinyalakan.
const {
  SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, InteractionContextType, MessageFlags, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: P,
} = require('discord.js');
const store = require('../store');
const access = require('../access');
const runtime = require('../runtime');
const kasus = require('./kasus');
const tampil = require('./tampilan');
const aksi = require('./aksi');
const auto = require('./auto');
const { parseDurasi } = require('../waktu');

const EPHEMERAL = MessageFlags.Ephemeral;
const CTX = 'Beri peringatan';
const SLASH = new Set(['warn', 'dm', 'mod', 'automod']);
const cfg = () => store.loadSettings().moderasi;

// ---------- definisi command ----------

const warnContext = new ContextMenuCommandBuilder().setName(CTX).setType(ApplicationCommandType.User)
  .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(P.ModerateMembers);

function commands() {
  const g = (b) => b.setContexts(InteractionContextType.Guild);
  const alasan = (o, wajib = false) => o.setName('alasan').setDescription('Alasan (tampil di DM dan log)').setRequired(wajib).setMaxLength(900).setAutocomplete(true);
  const member = (o, desc = 'Member yang dituju') => o.setName('member').setDescription(desc).setRequired(true);
  const channel = (o, desc) => o.setName('channel').setDescription(desc).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  return [
    g(new SlashCommandBuilder().setName('warn').setDescription('Beri peringatan ke member, dikirim lewat DM').setDefaultMemberPermissions(P.ModerateMembers))
      .addUserOption((o) => member(o, 'Member yang diperingatkan'))
      .addStringOption((o) => alasan(o, true))
      .addStringOption((o) => o.setName('bukti').setDescription('Link bukti / screenshot (opsional)').setMaxLength(300))
      .addBooleanOption((o) => o.setName('diam').setDescription('Catat saja, jangan kirim DM')),
    g(new SlashCommandBuilder().setName('dm').setDescription('Kirim pesan DM ke member lewat bot (bukan peringatan)').setDefaultMemberPermissions(P.ModerateMembers))
      .addUserOption((o) => member(o, 'Penerima pesan'))
      .addStringOption((o) => o.setName('pesan').setDescription('Isi pesan').setRequired(true).setMaxLength(1500))
      .addBooleanOption((o) => o.setName('anonim').setDescription('Sembunyikan namamu dari pesan')),
    g(new SlashCommandBuilder().setName('mod').setDescription('Alat moderasi').setDefaultMemberPermissions(P.ModerateMembers))
      .addSubcommand((s) => s.setName('timeout').setDescription('Bungkam member sementara')
        .addUserOption((o) => member(o))
        .addStringOption((o) => o.setName('durasi').setDescription('Contoh: 10m, 2j, 1d (m = menit, j = jam, d = hari). Maks 28d').setRequired(true).setMaxLength(20))
        .addStringOption((o) => alasan(o)))
      .addSubcommand((s) => s.setName('untimeout').setDescription('Cabut timeout member')
        .addUserOption((o) => member(o)).addStringOption((o) => alasan(o)))
      .addSubcommand((s) => s.setName('kick').setDescription('Keluarkan member dari server')
        .addUserOption((o) => member(o)).addStringOption((o) => alasan(o)))
      .addSubcommand((s) => s.setName('ban').setDescription('Blokir member dari server')
        .addUserOption((o) => member(o)).addStringOption((o) => alasan(o))
        .addIntegerOption((o) => o.setName('hari').setDescription('Hapus pesan dia dari berapa hari terakhir (0-7)').setMinValue(0).setMaxValue(7)))
      .addSubcommand((s) => s.setName('unban').setDescription('Buka blokir lewat ID user')
        .addStringOption((o) => o.setName('id').setDescription('ID user yang di-ban').setRequired(true).setMaxLength(25))
        .addStringOption((o) => alasan(o)))
      .addSubcommand((s) => s.setName('purge').setDescription('Hapus pesan terakhir di channel ini')
        .addIntegerOption((o) => o.setName('jumlah').setDescription('1 sampai 100').setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption((o) => o.setName('member').setDescription('Hanya pesan milik member ini (dicari di 100 pesan terakhir)')))
      .addSubcommand((s) => s.setName('slowmode').setDescription('Atur slowmode channel')
        .addIntegerOption((o) => o.setName('detik').setDescription('0 untuk mematikan, maksimal 21600').setRequired(true).setMinValue(0).setMaxValue(21600))
        .addChannelOption((o) => channel(o, 'Channel (kosong = channel ini)')))
      .addSubcommand((s) => s.setName('lock').setDescription('Kunci channel: member biasa tidak bisa mengirim pesan')
        .addChannelOption((o) => channel(o, 'Channel (kosong = channel ini)')).addStringOption((o) => alasan(o)))
      .addSubcommand((s) => s.setName('unlock').setDescription('Buka kunci channel')
        .addChannelOption((o) => channel(o, 'Channel (kosong = channel ini)')))
      .addSubcommand((s) => s.setName('riwayat').setDescription('Lihat riwayat moderasi seorang member')
        .addUserOption((o) => member(o)))
      .addSubcommand((s) => s.setName('kasus').setDescription('Lihat detail satu kasus')
        .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor kasus').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('hapus').setDescription('Hapus peringatan (tidak dihitung lagi, jejaknya tetap ada)')
        .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor kasus peringatan').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('alasan').setDescription('Kenapa dihapus').setMaxLength(300)))
      .addSubcommand((s) => s.setName('catatan').setDescription('Tulis catatan internal tentang member (tidak dikirim ke dia)')
        .addUserOption((o) => member(o)).addStringOption((o) => o.setName('isi').setDescription('Isi catatan').setRequired(true).setMaxLength(900)))
      .addSubcommand((s) => s.setName('cek').setDescription('Cek izin bot untuk moderasi (khusus pengelola)')),
    g(new SlashCommandBuilder().setName('automod').setDescription('Atur auto-moderasi (khusus pengelola)'))
      .addSubcommand((s) => s.setName('status').setDescription('Lihat dan nyalakan / matikan aturan'))
      .addSubcommandGroup((gr) => gr.setName('kata').setDescription('Daftar kata terlarang')
        .addSubcommand((s) => s.setName('tambah').setDescription('Tambah kata (pisahkan koma untuk banyak)')
          .addStringOption((o) => o.setName('kata').setDescription('Contoh: kata1, kata2').setRequired(true).setMaxLength(300)))
        .addSubcommand((s) => s.setName('hapus').setDescription('Hapus kata dari daftar')
          .addStringOption((o) => o.setName('kata').setDescription('Kata yang dihapus').setRequired(true).setMaxLength(100)))
        .addSubcommand((s) => s.setName('daftar').setDescription('Lihat daftar kata')))
      .addSubcommandGroup((gr) => gr.setName('link').setDescription('Situs yang boleh dikirim saat aturan Link menyala')
        .addSubcommand((s) => s.setName('izinkan').setDescription('Izinkan sebuah situs')
          .addStringOption((o) => o.setName('domain').setDescription('Contoh: youtube.com').setRequired(true).setMaxLength(100)))
        .addSubcommand((s) => s.setName('cabut').setDescription('Cabut izin sebuah situs')
          .addStringOption((o) => o.setName('domain').setDescription('Contoh: youtube.com').setRequired(true).setMaxLength(100))))
      .addSubcommand((s) => s.setName('abaikan-channel').setDescription('Channel ini kebal auto-moderasi (jalankan lagi untuk mencabut)')
        .addChannelOption((o) => channel(o, 'Channel').setRequired(true)))
      .addSubcommand((s) => s.setName('abaikan-role').setDescription('Role ini kebal auto-moderasi (jalankan lagi untuk mencabut)')
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand((s) => s.setName('batas').setDescription('Atur angka batas aturan')
        .addIntegerOption((o) => o.setName('mention').setDescription('Maks mention per pesan (2-50)').setMinValue(2).setMaxValue(50))
        .addIntegerOption((o) => o.setName('flood-pesan').setDescription('Berapa pesan dianggap flood (3-30)').setMinValue(3).setMaxValue(30))
        .addIntegerOption((o) => o.setName('flood-detik').setDescription('Dalam berapa detik (2-60)').setMinValue(2).setMaxValue(60))
        .addIntegerOption((o) => o.setName('flood-timeout').setDescription('Timeout setelah flood, menit (0 = tidak)').setMinValue(0).setMaxValue(1440))
        .addIntegerOption((o) => o.setName('kapital-persen').setDescription('Persen huruf kapital (30-100)').setMinValue(30).setMaxValue(100))),
  ].map((c) => c.toJSON());
}

// Dipakai interactions.commandJSON(). /automod boleh dipasang sendiri; sisanya ikut tombol Moderasi.
function enabledCommands() {
  const settings = store.loadSettings();
  if (settings.moderasi.aktif) return [...commands(), warnContext.toJSON()];
  if (settings.automod.aktif) return commands().filter((c) => c.name === 'automod');
  return [];
}

const owns = (i) => {
  if (i.isChatInputCommand?.() || i.isAutocomplete?.()) return SLASH.has(i.commandName);
  if (i.isUserContextMenuCommand?.()) return i.commandName === CTX;
  return Boolean((i.isMessageComponent?.() || i.isModalSubmit?.()) && /^(mod|am):/.test(i.customId ?? ''));
};

// ---------- balasan & izin ----------

const reply = (i, content, extra = {}) => i.reply({ content, flags: EPHEMERAL, ...extra });
const say = (i, content, extra = {}) => (i.deferred || i.replied ? i.editReply({ content, ...extra }) : reply(i, content, extra));

const NAMA_IZIN = {
  [P.ModerateMembers]: 'Timeout Members', [P.KickMembers]: 'Kick Members', [P.BanMembers]: 'Ban Members',
  [P.ManageMessages]: 'Manage Messages', [P.ManageChannels]: 'Manage Channels',
};
const IZIN_SUB = {
  timeout: P.ModerateMembers, untimeout: P.ModerateMembers, kick: P.KickMembers, ban: P.BanMembers, unban: P.BanMembers,
  purge: P.ManageMessages, slowmode: P.ManageChannels, lock: P.ManageChannels, unlock: P.ManageChannels,
};

// Peringatan, DM, riwayat, catatan: izin Timeout Members atau pengelola bot. Tindakan berat wajib punya izin Discord aslinya.
function puas(i, perm = P.ModerateMembers, { pengelola = false } = {}) {
  if (i.memberPermissions?.has(perm)) return true;
  return pengelola && access.isManager(i);
}
async function izinDitolak(i, perm) {
  await reply(i, `Kamu butuh izin **${NAMA_IZIN[perm] ?? 'moderator'}** di server ini untuk itu.`);
  return false;
}

const dmTeks = (s) => ({
  terkirim: '📩 DM terkirim ke dia.',
  gagal: '⚠️ DM tidak bisa terkirim (dia menutup DM dari member server). Tindakan tetap tercatat.',
  tidak: 'DM tidak dikirim.',
}[s] ?? '');

// ---------- peringatan ----------

async function lakukanWarn(i, user, alasan, { bukti = null, diam = false } = {}) {
  const res = await aksi.warn(i.guild, { mod: i.user, modMember: i.member, user, reason: alasan, bukti, diam });
  const baris = [`⚠️ **Peringatan #${res.case.id}** dicatat untuk ${user} · peringatan aktif: **${res.count}**.`, dmTeks(res.dm)];
  if (res.eskalasi) baris.push(`${res.eskalasi.ok ? '🔨' : '❗'} Eskalasi otomatis: ${res.eskalasi.teks}.`);
  return say(i, baris.filter(Boolean).join('\n'), { allowedMentions: { parse: [] } });
}

async function slashWarn(i) {
  if (!puas(i, P.ModerateMembers, { pengelola: true })) return izinDitolak(i, P.ModerateMembers);
  await i.deferReply({ flags: EPHEMERAL });
  return lakukanWarn(i, i.options.getUser('member', true), i.options.getString('alasan', true), {
    bukti: i.options.getString('bukti'), diam: Boolean(i.options.getBoolean('diam')),
  });
}

const field = (id, label, style, { value, placeholder, max, required = false } = {}) => {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required);
  if (value) input.setValue(String(value).slice(0, max ?? 4000));
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  if (max) input.setMaxLength(max);
  return new ActionRowBuilder().addComponents(input);
};

// Klik kanan member > Apps > Beri peringatan: kotak isian untuk menulis pesan peringatannya.
async function contextWarn(i) {
  if (!puas(i, P.ModerateMembers, { pengelola: true })) return izinDitolak(i, P.ModerateMembers);
  return i.showModal(new ModalBuilder().setCustomId(`mod:w:${i.targetId}`).setTitle('Beri peringatan').addComponents(
    field('alasan', 'Pesan peringatan (dikirim ke DM dia)', TextInputStyle.Paragraph, { required: true, max: 900, placeholder: 'Contoh: Jangan spam di #general ya. Ini peringatan pertama.' }),
    field('bukti', 'Link bukti (opsional)', TextInputStyle.Short, { max: 300 }),
  ));
}

async function submitWarn(i) {
  const [, kind, userId] = i.customId.split(':');
  if (kind !== 'w') return null;
  if (!puas(i, P.ModerateMembers, { pengelola: true })) return izinDitolak(i, P.ModerateMembers);
  await i.deferReply({ flags: EPHEMERAL });
  const user = await i.client.users.fetch(userId);
  return lakukanWarn(i, user, i.fields.getTextInputValue('alasan').trim(), { bukti: i.fields.getTextInputValue('bukti')?.trim() || null });
}

async function slashDm(i) {
  if (!puas(i, P.ModerateMembers, { pengelola: true })) return izinDitolak(i, P.ModerateMembers);
  await i.deferReply({ flags: EPHEMERAL });
  const user = i.options.getUser('member', true);
  const res = await aksi.kirimPesan(i.guild, { mod: i.user, user, pesan: i.options.getString('pesan', true), anonim: Boolean(i.options.getBoolean('anonim')) });
  return say(i, `${res.dm === 'terkirim' ? '✅ Pesan terkirim' : '⚠️ Pesan tidak terkirim'} ke ${user}. ${res.dm === 'gagal' ? 'Dia menutup DM dari member server.' : ''}`.trim(), { allowedMentions: { parse: [] } });
}

// ---------- /mod ----------

const alasanOf = (i) => i.options.getString('alasan') ?? null;

async function slashMod(i) {
  const sub = i.options.getSubcommand();
  if (sub === 'cek') {
    if (!access.isManager(i)) return reply(i, 'Ini khusus yang punya izin Manage Server atau role pengelola bot.');
    return reply(i, '', { embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('Izin bot untuk moderasi').setDescription(aksi.izinBot(i.guild))] });
  }
  const perm = IZIN_SUB[sub];
  if (!puas(i, perm ?? P.ModerateMembers, { pengelola: !perm })) return izinDitolak(i, perm ?? P.ModerateMembers);
  const guild = i.guild;
  const base = { mod: i.user, modMember: i.member };
  const target = () => i.options.getUser('member', true);
  const mentionNone = { allowedMentions: { parse: [] } };

  switch (sub) {
    case 'timeout': {
      const ms = parseDurasi(i.options.getString('durasi', true));
      if (!ms) return reply(i, 'Durasinya tidak dimengerti. Contoh: `10m`, `2j`, `1d`, `1j30m` (m = menit, j = jam, d = hari).');
      await i.deferReply({ flags: EPHEMERAL });
      const user = target();
      const r = await aksi.timeout(guild, { ...base, user, ms, reason: alasanOf(i) });
      return say(i, `🔇 ${user} di-timeout sampai <t:${Math.floor(r.case.until / 1000)}:f> (kasus #${r.case.id}). ${dmTeks(r.dm)}`, mentionNone);
    }
    case 'untimeout': {
      await i.deferReply({ flags: EPHEMERAL });
      const user = target();
      const r = await aksi.untimeout(guild, { mod: i.user, user, reason: alasanOf(i) });
      return say(i, `🔊 Timeout ${user} dicabut (kasus #${r.case.id}).`, mentionNone);
    }
    case 'kick': {
      await i.deferReply({ flags: EPHEMERAL });
      const user = target();
      const r = await aksi.kick(guild, { ...base, user, reason: alasanOf(i) });
      return say(i, `👢 ${user.tag ?? user.username} dikeluarkan (kasus #${r.case.id}). ${dmTeks(r.dm)}`, mentionNone);
    }
    case 'ban': {
      await i.deferReply({ flags: EPHEMERAL });
      const user = target();
      const r = await aksi.ban(guild, { ...base, user, reason: alasanOf(i), hariPesan: i.options.getInteger('hari') ?? 0 });
      return say(i, `🔨 ${user.tag ?? user.username} diblokir (kasus #${r.case.id}). ${dmTeks(r.dm)}`, mentionNone);
    }
    case 'unban': {
      await i.deferReply({ flags: EPHEMERAL });
      const r = await aksi.unban(guild, { mod: i.user, userId: i.options.getString('id', true).trim(), reason: alasanOf(i) });
      return say(i, `✅ ${r.case.userTag} dibuka blokirnya (kasus #${r.case.id}).`, mentionNone);
    }
    case 'purge': {
      await i.deferReply({ flags: EPHEMERAL });
      const n = await aksi.purge(guild, { mod: i.user, channel: i.channel, jumlah: i.options.getInteger('jumlah', true), user: i.options.getUser('member') });
      return say(i, `🧹 ${n} pesan dihapus. (Pesan yang lebih tua dari 14 hari tidak bisa dihapus massal.)`);
    }
    case 'slowmode': {
      await i.deferReply({ flags: EPHEMERAL });
      const channel = i.options.getChannel('channel') ?? i.channel;
      const detik = i.options.getInteger('detik', true);
      await aksi.slowmode(guild, { mod: i.user, channel, detik });
      return say(i, detik ? `🐢 Slowmode <#${channel.id}> sekarang ${detik} detik.` : `Slowmode <#${channel.id}> dimatikan.`);
    }
    case 'lock': {
      await i.deferReply({ flags: EPHEMERAL });
      const channel = i.options.getChannel('channel') ?? i.channel;
      await aksi.lock(guild, { mod: i.user, channel, alasan: alasanOf(i) });
      return say(i, `🔒 <#${channel.id}> dikunci. Buka lagi dengan \`/mod unlock\`.`);
    }
    case 'unlock': {
      await i.deferReply({ flags: EPHEMERAL });
      const channel = i.options.getChannel('channel') ?? i.channel;
      await aksi.unlock(guild, { mod: i.user, channel });
      return say(i, `🔓 <#${channel.id}> dibuka.`);
    }
    case 'riwayat': {
      const user = target();
      const aktif = kasus.activeWarns(guild.id, user.id, cfg().kedaluwarsaHari).length;
      return reply(i, '', { embeds: [tampil.riwayatEmbed(guild, user, kasus.forUser(guild.id, user.id), aktif)] });
    }
    case 'kasus': {
      const c = kasus.get(guild.id, i.options.getInteger('nomor', true));
      return c ? reply(i, '', { embeds: [tampil.kasusEmbed(c)] }) : reply(i, 'Kasus itu tidak ada.');
    }
    case 'hapus': {
      await i.deferReply({ flags: EPHEMERAL });
      const nomor = i.options.getInteger('nomor', true);
      await aksi.hapusPeringatan(guild, { mod: i.user, id: nomor, alasan: alasanOf(i) });
      return say(i, `🗑️ Peringatan #${nomor} dihapus. Tidak dihitung lagi, tapi tetap ada di riwayat.`);
    }
    case 'catatan': {
      const user = target();
      const r = aksi.catatan(guild, { mod: i.user, user, isi: i.options.getString('isi', true) });
      return reply(i, `📝 Catatan #${r.case.id} disimpan untuk ${user}. Dia tidak diberi tahu.`, mentionNone);
    }
    default: return null;
  }
}

// ---------- /automod ----------

const RULE_KEYS = ['aktif', 'invite', 'link', 'kata', 'mention', 'flood', 'kapital', 'peringatan', 'balasChannel'];

function statusAuto() {
  const c = store.loadSettings().automod;
  const on = (b) => (b ? '✅' : '❌');
  const lines = [
    `${on(c.aktif)} **Auto-moderasi ${c.aktif ? 'menyala' : 'mati'}**`,
    '',
    `${on(c.invite)} Undangan server lain`,
    `${on(c.link)} Link${c.link ? ` (diizinkan: ${c.linkIzin.join(', ') || 'tidak ada'})` : ''}`,
    `${on(c.kata)} Kata terlarang (${c.kataDaftar.length} kata)`,
    `${on(c.mention)} Mention massal (maksimal ${c.mentionMaks})`,
    `${on(c.flood)} Flood: ${c.floodPesan} pesan dalam ${c.floodDetik} detik${c.floodTimeoutMenit ? `, lalu timeout ${c.floodTimeoutMenit} menit` : ''}`,
    `${on(c.kapital)} Huruf kapital ≥ ${c.kapitalPersen}% (minimal ${c.kapitalMin} huruf)`,
    '',
    `Dihitung sebagai peringatan: ${c.peringatan ? 'ya' : 'tidak (hanya hapus pesan + DM)'}`,
    `Balasan singkat di channel: ${c.balasChannel ? 'ya' : 'tidak'}`,
    `Diabaikan: ${c.abaikanChannel.length} channel, ${c.abaikanRole.length} role`,
    '',
    'Moderator (punya izin Manage Messages / Timeout), admin, dan pemilik server tidak pernah kena. Atur lainnya dengan `/automod kata`, `/automod link`, `/automod batas`, `/automod abaikan-channel`, `/automod abaikan-role`.',
  ];
  if (!runtime.features.content) lines.push('', '**Message Content Intent belum nyala**: aturan undangan, link, kata, dan kapital tidak bisa membaca isi pesan. Nyalakan di Developer Portal lalu restart bot.');
  const btn = (key, label) => new ButtonBuilder().setCustomId(`am:t:${key}`).setLabel(label)
    .setStyle(c[key] ? ButtonStyle.Success : ButtonStyle.Secondary);
  const row = (...b) => new ActionRowBuilder().addComponents(...b);
  return {
    embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('AUTO-MODERASI').setDescription(lines.join('\n'))],
    components: [
      row(btn('aktif', 'Auto-moderasi'), btn('invite', 'Undangan'), btn('link', 'Link'), btn('kata', 'Kata terlarang'), btn('mention', 'Mention')),
      row(btn('flood', 'Flood'), btn('kapital', 'Kapital'), btn('peringatan', 'Hitung peringatan'), btn('balasChannel', 'Balas di channel')),
    ],
  };
}

function ubahAuto(fn) {
  const settings = store.loadSettings();
  const out = fn(settings.automod);
  store.saveSettings(settings);
  return out;
}

const listText = (arr) => arr.map((x) => `\`${x}\``).join(', ');

async function slashAuto(i) {
  const group = i.options.getSubcommandGroup?.(false) ?? null;
  const sub = i.options.getSubcommand();
  if (!group && sub === 'status') return reply(i, '', statusAuto());

  if (group === 'kata') {
    const c = store.loadSettings().automod;
    if (sub === 'daftar') {
      return reply(i, c.kataDaftar.length ? `Kata terlarang (${c.kataDaftar.length}):\n||${c.kataDaftar.join(', ')}||` : 'Daftar kata masih kosong. Tambah dengan `/automod kata tambah`.');
    }
    const input = i.options.getString('kata', true).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const valid = input.filter((k) => k.length <= 50);
    if (!valid.length) return reply(i, 'Tidak ada kata yang valid (maksimal 50 huruf per kata).');
    const hasil = ubahAuto((a) => {
      if (sub === 'tambah') {
        const baru = valid.filter((k) => !a.kataDaftar.includes(k));
        a.kataDaftar = [...a.kataDaftar, ...baru].slice(0, 300);
        return baru;
      }
      const lama = valid.filter((k) => a.kataDaftar.includes(k));
      a.kataDaftar = a.kataDaftar.filter((k) => !valid.includes(k));
      return lama;
    });
    const extra = sub === 'tambah' && !c.kata ? '\nAturan **Kata terlarang** masih mati. Nyalakan lewat `/automod status`.' : '';
    return reply(i, `${hasil.length ? `${sub === 'tambah' ? 'Ditambahkan' : 'Dihapus'}: ||${hasil.join(', ')}||` : 'Tidak ada yang berubah.'}${extra}`);
  }

  if (group === 'link') {
    const domain = auto.domainBersih(i.options.getString('domain', true));
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return reply(i, 'Domainnya tidak valid. Contoh: `youtube.com`');
    const daftar = ubahAuto((a) => {
      a.linkIzin = sub === 'izinkan' ? [...new Set([...a.linkIzin, domain])].slice(0, 100) : a.linkIzin.filter((d) => auto.domainBersih(d) !== domain);
      return a.linkIzin;
    });
    return reply(i, `${sub === 'izinkan' ? 'Diizinkan' : 'Dicabut'}: \`${domain}\`\nSitus yang boleh: ${daftar.length ? listText(daftar) : '(tidak ada, semua link dihapus)'}\nAturan **Link** harus menyala di \`/automod status\`.`);
  }

  if (sub === 'abaikan-channel' || sub === 'abaikan-role') {
    const isChannel = sub === 'abaikan-channel';
    const target = isChannel ? i.options.getChannel('channel', true) : i.options.getRole('role', true);
    const added = ubahAuto((a) => {
      const key = isChannel ? 'abaikanChannel' : 'abaikanRole';
      const has = a[key].includes(target.id);
      a[key] = has ? a[key].filter((x) => x !== target.id) : [...a[key], target.id];
      return !has;
    });
    return reply(i, `${isChannel ? `<#${target.id}>` : `<@&${target.id}>`} ${added ? 'sekarang kebal dari auto-moderasi' : 'tidak lagi diabaikan'}.`, { allowedMentions: { parse: [] } });
  }

  if (sub === 'batas') {
    const map = { mention: 'mentionMaks', 'flood-pesan': 'floodPesan', 'flood-detik': 'floodDetik', 'flood-timeout': 'floodTimeoutMenit', 'kapital-persen': 'kapitalPersen' };
    const diubah = ubahAuto((a) => {
      const out = [];
      for (const [opt, key] of Object.entries(map)) {
        const v = i.options.getInteger(opt);
        if (v !== null && v !== undefined) {
          a[key] = v;
          out.push(`${opt} = ${v}`);
        }
      }
      return out;
    });
    return reply(i, diubah.length ? `Disimpan: ${diubah.join(', ')}.` : 'Tidak ada angka yang kamu isi.');
  }
  return null;
}

async function tombolAuto(i) {
  const [, aksiId, key] = i.customId.split(':');
  if (aksiId !== 't' || !RULE_KEYS.includes(key)) return null;
  ubahAuto((a) => { a[key] = !a[key]; });
  if (key === 'aktif') refreshCommands(i.guild);
  return i.update(statusAuto());
}

async function handleAuto(i) {
  if (!access.isManager(i)) return reply(i, 'Ini khusus yang punya izin Manage Server atau role pengelola bot.');
  if (i.isChatInputCommand()) return slashAuto(i);
  return tombolAuto(i);
}

// Pasang ulang daftar command di server (muncul / hilang sesuai fitur yang menyala).
function refreshCommands(guild) {
  const { commandJSON } = require('../interactions');
  guild.commands.set(commandJSON()).catch((err) => console.error(`[moderasi] pasang command: ${err.message}`));
}

// ---------- pengaturan dari /panel → Fitur lainnya ----------

function settingsModal() {
  const c = cfg();
  return new ModalBuilder().setCustomId('set:modsubmit').setTitle('Atur moderasi').addComponents(
    field('eskalasi', 'Eskalasi (jumlah = tindakan)', TextInputStyle.Short, { value: aksi.formatEskalasi(c.eskalasi.aturan), max: 200, placeholder: '3=timeout 60m, 5=kick, 7=ban' }),
    field('kedaluwarsa', 'Peringatan kedaluwarsa (hari, 0 = tidak)', TextInputStyle.Short, { value: String(c.kedaluwarsaHari), max: 4 }),
    field('alasan', 'Alasan cepat (satu per baris)', TextInputStyle.Paragraph, { value: c.alasanCepat.join('\n'), max: 1000 }),
  );
}

// Hasil: { ok: true } atau { error: 'pesan' }. Tidak ada yang disimpan kalau ada isian yang salah.
function saveSettings(i) {
  const esk = aksi.parseEskalasi(i.fields.getTextInputValue('eskalasi'));
  if (esk.error) return { error: esk.error };
  const hari = Number(String(i.fields.getTextInputValue('kedaluwarsa') || '0').trim());
  if (!Number.isInteger(hari) || hari < 0 || hari > 3650) return { error: 'Kedaluwarsa harus angka hari (0 = tidak pernah).' };
  const alasan = String(i.fields.getTextInputValue('alasan') ?? '').split('\n').map((s) => s.trim().slice(0, 100)).filter(Boolean).slice(0, 25);
  const settings = store.loadSettings();
  settings.moderasi.eskalasi.aturan = esk.aturan;
  settings.moderasi.kedaluwarsaHari = hari;
  settings.moderasi.alasanCepat = alasan;
  store.saveSettings(settings);
  return { ok: true };
}

// ---------- pintu masuk ----------

async function handle(i) {
  try {
    if (i.isAutocomplete?.()) {
      const f = i.options.getFocused(true);
      const q = String(f.value ?? '').toLowerCase();
      return await i.respond(f.name === 'alasan'
        ? cfg().alasanCepat.filter((a) => a.toLowerCase().includes(q)).slice(0, 25).map((a) => ({ name: a.slice(0, 100), value: a.slice(0, 100) }))
        : []);
    }
    if (i.commandName === 'automod' || /^am:/.test(i.customId ?? '')) return await handleAuto(i);

    if (!cfg().aktif) {
      return await reply(i, access.isManager(i)
        ? 'Moderasi belum dinyalakan. Buka **/panel → Fitur lainnya** lalu nyalakan **Moderasi**.'
        : 'Fitur moderasi belum dinyalakan oleh pengelola server.');
    }
    if (i.isUserContextMenuCommand?.()) return await contextWarn(i);
    if (i.isModalSubmit?.()) return await submitWarn(i);
    switch (i.commandName) {
      case 'warn': return await slashWarn(i);
      case 'dm': return await slashDm(i);
      case 'mod': return await slashMod(i);
      default: return null;
    }
  } catch (err) {
    if (!(err instanceof aksi.ModError)) console.error(`[moderasi] ${err.stack ?? err.message}`);
    return say(i, `❌ ${aksi.friendly(err)}`).catch(() => {});
  }
}

// Tombol "Kasus moderasi" di panel kontrol.
const kasusTerbaru = (guild) => tampil.daftarEmbed(guild, kasus.recent(guild.id, 15), kasus.summary(guild.id, 7));

// Ringkasan satu baris untuk /panel → Status bot.
function summary(guildId) {
  const s = store.loadSettings();
  return `Moderasi: ${s.moderasi.aktif ? 'aktif' : 'mati'} · Auto-moderasi: ${s.automod.aktif ? 'aktif' : 'mati'} · ${kasus.total(guildId)} kasus tercatat`;
}

module.exports = {
  commands, enabledCommands, owns, handle, settingsModal, saveSettings, kasusTerbaru, summary, refreshCommands,
  onMessage: auto.onMessage, flush: kasus.flush, CTX,
};
