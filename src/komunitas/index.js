// Fitur komunitas: /poll, /giveaway, /ingatkan, /afk, /info, /umumkan, plus sambutan member baru.
// Mati sampai dinyalakan di /panel → Fitur lainnya. Command-nya baru muncul di Discord setelah dinyalakan.
const { SlashCommandBuilder, InteractionContextType, MessageFlags, ChannelType } = require('discord.js');
const store = require('../store');
const access = require('../access');
const data = require('./data');
const poll = require('./poll');
const giveaway = require('./giveaway');
const ingatkan = require('./ingatkan');
const afk = require('./afk');
const info = require('./info');
const umumkan = require('./umumkan');
const sambutan = require('./sambutan');

const EPHEMERAL = MessageFlags.Ephemeral;
const COMMANDS = new Set(['poll', 'giveaway', 'ingatkan', 'afk', 'info', 'umumkan']);
const cfg = () => store.loadSettings().komunitas;

function commands() {
  const g = (b) => b.setContexts(InteractionContextType.Guild);
  const member = (o, wajib = false) => o.setName('member').setDescription('Member (kosong = dirimu)').setRequired(wajib);
  return [
    g(new SlashCommandBuilder().setName('poll').setDescription('Buat poll dengan tombol pilihan'))
      .addStringOption((o) => o.setName('pertanyaan').setDescription('Pertanyaan poll').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('opsi1').setDescription('Pilihan A').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('opsi2').setDescription('Pilihan B').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('opsi3').setDescription('Pilihan C').setMaxLength(100))
      .addStringOption((o) => o.setName('opsi4').setDescription('Pilihan D').setMaxLength(100))
      .addStringOption((o) => o.setName('opsi5').setDescription('Pilihan E').setMaxLength(100))
      .addStringOption((o) => o.setName('durasi').setDescription('Berakhir otomatis. Contoh: 30m, 2j, 1d (kosong = sampai ditutup)').setMaxLength(20)),
    g(new SlashCommandBuilder().setName('giveaway').setDescription('Undian berhadiah (khusus pengelola)'))
      .addSubcommand((s) => s.setName('mulai').setDescription('Mulai giveaway di channel ini')
        .addStringOption((o) => o.setName('hadiah').setDescription('Hadiahnya apa').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('durasi').setDescription('Contoh: 30m, 2j, 1d').setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName('pemenang').setDescription('Jumlah pemenang (bawaan 1)').setMinValue(1).setMaxValue(20))
        .addRoleOption((o) => o.setName('role').setDescription('Hanya yang punya role ini boleh ikut')))
      .addSubcommand((s) => s.setName('akhiri').setDescription('Akhiri sekarang dan umumkan pemenang')
        .addStringOption((o) => o.setName('id').setDescription('ID pesan giveaway (kosong = yang berjalan di channel ini)').setMaxLength(25)))
      .addSubcommand((s) => s.setName('ulang').setDescription('Pilih pemenang baru untuk giveaway yang sudah selesai')
        .addStringOption((o) => o.setName('id').setDescription('ID pesan giveaway').setRequired(true).setMaxLength(25)))
      .addSubcommand((s) => s.setName('daftar').setDescription('Lihat giveaway yang sedang berjalan')),
    g(new SlashCommandBuilder().setName('ingatkan').setDescription('Pengingat pribadi'))
      .addSubcommand((s) => s.setName('buat').setDescription('Ingatkan aku nanti')
        .addStringOption((o) => o.setName('waktu').setDescription('Berapa lama lagi. Contoh: 30m, 2j, 1d, 1j30m').setRequired(true).setMaxLength(20))
        .addStringOption((o) => o.setName('pesan').setDescription('Diingatkan tentang apa').setRequired(true).setMaxLength(500))
        .addBooleanOption((o) => o.setName('dm').setDescription('Kirim lewat DM, bukan di channel ini')))
      .addSubcommand((s) => s.setName('daftar').setDescription('Lihat pengingatmu'))
      .addSubcommand((s) => s.setName('batal').setDescription('Batalkan satu pengingat')
        .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor di /ingatkan daftar').setRequired(true).setMinValue(1))),
    g(new SlashCommandBuilder().setName('afk').setDescription('Tandai dirimu sedang AFK'))
      .addStringOption((o) => o.setName('alasan').setDescription('Alasan (opsional)').setMaxLength(150)),
    g(new SlashCommandBuilder().setName('info').setDescription('Info member, server, avatar, atau bot'))
      .addSubcommand((s) => s.setName('user').setDescription('Info seorang member').addUserOption((o) => member(o)))
      .addSubcommand((s) => s.setName('server').setDescription('Info server ini'))
      .addSubcommand((s) => s.setName('avatar').setDescription('Lihat avatar besar').addUserOption((o) => member(o)))
      .addSubcommand((s) => s.setName('bot').setDescription('Info bot')),
    g(new SlashCommandBuilder().setName('umumkan').setDescription('Kirim pengumuman rapi ke sebuah channel (khusus pengelola)'))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel tujuan').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('mention').setDescription('Role yang di-mention (opsional)')),
  ].map((c) => c.toJSON());
}

const enabledCommands = () => (cfg().aktif ? commands() : []);

const owns = (i) => (i.isChatInputCommand?.() && COMMANDS.has(i.commandName))
  || Boolean((i.isMessageComponent?.() || i.isModalSubmit?.()) && /^k[pgu]:/.test(i.customId ?? ''));

const reply = (i, content) => i.reply({ content, flags: EPHEMERAL });
const say = (i, content) => (i.deferred || i.replied ? i.editReply({ content }) : reply(i, content));
const KHUSUS = 'Ini khusus yang punya izin Manage Server atau role pengelola bot.';

async function slash(i) {
  const manager = access.isManager(i);
  if (!cfg().aktif) {
    return reply(i, manager ? 'Fitur komunitas belum dinyalakan. Buka **/panel → Fitur lainnya** lalu nyalakan **Komunitas**.' : 'Fitur ini belum dinyalakan oleh pengelola server.');
  }
  switch (i.commandName) {
    case 'poll': return poll.buat(i);
    case 'afk':
      return cfg().afk ? afk.set(i) : reply(i, 'Fitur AFK dimatikan oleh pengelola server.');
    case 'info': return info[i.options.getSubcommand()](i);
    case 'umumkan': return umumkan.buka(i);
    case 'ingatkan': return ingatkan[i.options.getSubcommand()](i);
    case 'giveaway': {
      if (!manager) return reply(i, KHUSUS);
      return giveaway[i.options.getSubcommand()](i);
    }
    default: return null;
  }
}

async function handle(i) {
  try {
    if (i.isChatInputCommand()) return await slash(i);
    if (i.isModalSubmit()) return await umumkan.kirim(i);
    if (/^kp:/.test(i.customId)) return await poll.tombol(i);
    if (/^kg:/.test(i.customId)) return await giveaway.ikut(i);
    return null;
  } catch (err) {
    console.error(`[komunitas] ${err.stack ?? err.message}`);
    return say(i, `❌ ${err.message}`).catch(() => {});
  }
}

const onMessage = (message) => {
  const c = store.peekSettings().komunitas;
  return c.aktif && c.afk ? afk.onMessage(message) : undefined;
};

// ---------- penyapu: poll / giveaway yang waktunya habis dan pengingat ----------

let timer = null;
let lastPrune = 0;

async function sweep(client, now = Date.now()) {
  const d = data.data();
  for (const p of Object.values(d.polls)) {
    if (!p.selesai && p.berakhir && p.berakhir <= now) await poll.selesaikan(client, p).catch((err) => console.error(`[poll] ${err.message}`));
  }
  for (const g of Object.values(d.giveaways)) {
    if (!g.selesai && g.berakhir <= now) await giveaway.selesaikan(client, g).catch((err) => console.error(`[giveaway] ${err.message}`));
  }
  await ingatkan.kirimJatuhTempo(client, now).catch((err) => console.error(`[ingatkan] ${err.message}`));
  if (now - lastPrune > 6 * 3600e3) {
    lastPrune = now;
    data.prune(now);
  }
}

function warmup(client) {
  if (timer) return;
  const tick = () => sweep(client).catch((err) => console.error(`[komunitas] ${err.message}`));
  timer = setInterval(tick, 15e3);
  timer.unref?.();
  tick();
}

function shutdown() {
  clearInterval(timer);
  timer = null;
  data.flush();
}

function summary() {
  const d = data.data();
  const poll1 = Object.values(d.polls).filter((p) => !p.selesai).length;
  const gw = Object.values(d.giveaways).filter((g) => !g.selesai).length;
  return `${cfg().aktif ? 'aktif' : 'mati'} · ${poll1} poll, ${gw} giveaway, ${d.pengingat.length} pengingat berjalan`;
}

module.exports = {
  commands, enabledCommands, owns, handle, onMessage, warmup, shutdown, sweep, summary, flush: data.flush,
  onAdd: sambutan.onAdd, onRemove: sambutan.onRemove, sambutan,
};
