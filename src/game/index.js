// Game & level: /rank /top /koin /harian /beri /game, game (/slot /dadu /lempar /suit /xo /kuis /blackjack) dan /atur-game (pengelola).
// Level dan game mati sampai dinyalakan di /panel → Game & level. Command-nya baru muncul di Discord setelah dinyalakan.
const {
  SlashCommandBuilder, InteractionContextType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonStyle,
} = require('discord.js');
const store = require('../store');
const access = require('../access');
const safety = require('../safety');
const data = require('./data');
const lv = require('./level');
const soal = require('./soal');
const games = require('./games');
const permainan = require('./permainan');
const t = require('./tampilan');

const EPHEMERAL = MessageFlags.Ephemeral;
const KHUSUS = 'Ini khusus yang punya izin Manage Server atau role pengelola bot.';
const NOL = { allowedMentions: { parse: [] } };

const LEVEL_CMD = new Set(['rank', 'top']);
const GAME_CMD = new Set(['koin', 'harian', 'beri', 'game', 'slot', 'dadu', 'lempar', 'suit', 'xo', 'kuis', 'blackjack']);
const ADMIN_CMD = 'atur-game';
const ALL_CMD = new Set([...LEVEL_CMD, ...GAME_CMD, ADMIN_CMD]);

const cfgLevel = () => store.loadSettings().level;
const cfgGame = () => store.loadSettings().game;

// ---------- command ----------

function commands({ level = true, game = true } = {}) {
  const g = (b) => b.setContexts(InteractionContextType.Guild);
  const taruhan = (o, wajib = true) => o.setName('taruhan').setDescription(wajib ? 'Taruhan (koin)' : 'Taruhan koin (kosong = main-main)')
    .setRequired(wajib).setMinValue(wajib ? 1 : 0).setMaxValue(1_000_000_000);
  const out = [];

  if (level) {
    out.push(
      g(new SlashCommandBuilder().setName('rank').setDescription('Lihat level dan XP-mu'))
        .addUserOption((o) => o.setName('member').setDescription('Member lain (kosong = kamu sendiri)')),
      g(new SlashCommandBuilder().setName('top').setDescription('Papan peringkat server'))
        .addStringOption((o) => o.setName('jenis').setDescription('Diurutkan berdasarkan (bawaan: level)')
          .addChoices(...[{ name: 'Level', value: 'level' }, ...(game ? [{ name: 'Koin', value: 'koin' }] : [])])),
    );
  } else if (game) {
    out.push(g(new SlashCommandBuilder().setName('top').setDescription('Papan peringkat koin server'))
      .addStringOption((o) => o.setName('jenis').setDescription('Diurutkan berdasarkan').addChoices({ name: 'Koin', value: 'koin' })));
  }

  if (game) {
    out.push(
      g(new SlashCommandBuilder().setName('koin').setDescription('Lihat saldo koinmu'))
        .addUserOption((o) => o.setName('member').setDescription('Member lain (kosong = kamu sendiri)')),
      g(new SlashCommandBuilder().setName('harian').setDescription('Ambil hadiah koin harian (makin sering makin besar)')),
      g(new SlashCommandBuilder().setName('beri').setDescription('Kirim koin ke member lain'))
        .addUserOption((o) => o.setName('member').setDescription('Penerima').setRequired(true))
        .addIntegerOption((o) => o.setName('jumlah').setDescription('Jumlah koin').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
      g(new SlashCommandBuilder().setName('game').setDescription('Daftar game dan cara mainnya')),
      g(new SlashCommandBuilder().setName('slot').setDescription('Putar mesin slot'))
        .addIntegerOption((o) => taruhan(o)),
      g(new SlashCommandBuilder().setName('dadu').setDescription('Tebak jumlah dua dadu'))
        .addStringOption((o) => o.setName('pilihan').setDescription('Tebakanmu').setRequired(true)
          .addChoices({ name: 'Kecil (2-6) 2x', value: 'kecil' }, { name: 'Tujuh 5x', value: 'tujuh' }, { name: 'Besar (8-12) 2x', value: 'besar' }))
        .addIntegerOption((o) => taruhan(o)),
      g(new SlashCommandBuilder().setName('lempar').setDescription('Lempar koin: kepala atau ekor'))
        .addStringOption((o) => o.setName('pilihan').setDescription('Tebakanmu').setRequired(true)
          .addChoices({ name: 'Kepala', value: 'kepala' }, { name: 'Ekor', value: 'ekor' }))
        .addIntegerOption((o) => taruhan(o, false)),
      g(new SlashCommandBuilder().setName('suit').setDescription('Batu gunting kertas lawan bot'))
        .addStringOption((o) => o.setName('pilihan').setDescription('Pilihanmu').setRequired(true)
          .addChoices({ name: 'Batu', value: 'batu' }, { name: 'Gunting', value: 'gunting' }, { name: 'Kertas', value: 'kertas' }))
        .addIntegerOption((o) => taruhan(o, false)),
      g(new SlashCommandBuilder().setName('xo').setDescription('Tantang member lain main XO'))
        .addUserOption((o) => o.setName('lawan').setDescription('Lawanmu').setRequired(true))
        .addIntegerOption((o) => taruhan(o, false)),
      g(new SlashCommandBuilder().setName('kuis').setDescription('Mulai kuis, yang tercepat menjawab benar dapat koin'))
        .addStringOption((o) => o.setName('kategori').setDescription('Kategori soal (bawaan: campuran)')
          .addChoices(...Object.entries(soal.KATEGORI).map(([value, name]) => ({ name, value })))),
      g(new SlashCommandBuilder().setName('blackjack').setDescription('Main blackjack lawan bandar'))
        .addIntegerOption((o) => taruhan(o)),
    );
  }

  if (level || game) {
    out.push(
      g(new SlashCommandBuilder().setName(ADMIN_CMD).setDescription('Atur level, koin, hadiah, dan soal kuis (khusus pengelola)'))
        .addSubcommand((s) => s.setName('koin').setDescription('Tambah atau kurangi koin member (angka minus = kurangi)')
          .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('jumlah').setDescription('Jumlah koin').setRequired(true).setMinValue(-1_000_000_000).setMaxValue(1_000_000_000)))
        .addSubcommand((s) => s.setName('xp').setDescription('Tambah atau kurangi XP member (angka minus = kurangi)')
          .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('jumlah').setDescription('Jumlah XP').setRequired(true).setMinValue(-10_000_000).setMaxValue(10_000_000)))
        .addSubcommand((s) => s.setName('level').setDescription('Atur level member langsung ke level tertentu')
          .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('level').setDescription('Level tujuan').setRequired(true).setMinValue(0).setMaxValue(lv.MAKS_LEVEL)))
        .addSubcommand((s) => s.setName('reset').setDescription('Hapus semua data level dan koin seorang member')
          .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
        .addSubcommand((s) => s.setName('hadiah').setDescription('Beri role otomatis saat member mencapai level tertentu')
          .addIntegerOption((o) => o.setName('level').setDescription('Level yang dibutuhkan').setRequired(true).setMinValue(1).setMaxValue(lv.MAKS_LEVEL))
          .addRoleOption((o) => o.setName('role').setDescription('Role hadiah').setRequired(true)))
        .addSubcommand((s) => s.setName('hapus-hadiah').setDescription('Hapus hadiah role di sebuah level')
          .addIntegerOption((o) => o.setName('level').setDescription('Level hadiah yang dihapus').setRequired(true).setMinValue(1).setMaxValue(lv.MAKS_LEVEL)))
        .addSubcommand((s) => s.setName('daftar-hadiah').setDescription('Lihat semua hadiah role per level'))
        .addSubcommand((s) => s.setName('sinkron').setDescription('Bagikan role hadiah ke member yang levelnya sudah cukup'))
        .addSubcommand((s) => s.setName('soal-tambah').setDescription('Tambah soal kuis buatan sendiri'))
        .addSubcommand((s) => s.setName('soal-daftar').setDescription('Lihat soal kuis buatan server'))
        .addSubcommand((s) => s.setName('soal-hapus').setDescription('Hapus satu soal kuis buatan server')
          .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor soal (lihat di /atur-game soal-daftar)').setRequired(true).setMinValue(1))),
    );
  }
  return out.map((c) => c.toJSON());
}

function enabledCommands() {
  const s = store.loadSettings();
  const level = Boolean(s.level.aktif);
  const game = Boolean(s.game.aktif);
  return level || game ? commands({ level, game }) : [];
}

const owns = (i) => ((i.isChatInputCommand?.() || i.isAutocomplete?.()) && ALL_CMD.has(i.commandName))
  || Boolean((i.isMessageComponent?.() || i.isModalSubmit?.()) && /^gm:/.test(i.customId ?? ''));

// ---------- pembantu ----------

const reply = (i, content, extra = {}) => i.reply({ content, flags: EPHEMERAL, ...NOL, ...extra });
const who = (i) => (i.member?.id ? i.member : i.user);
const namaDari = (user, member) => member?.displayName ?? user.globalName ?? user.username;
const hariWib = (ms) => Math.floor((ms + 7 * 3600e3) / 86400e3);
const mulaiHariWib = (hari) => hari * 86400e3 - 7 * 3600e3;
const hitungMundur = (ms) => {
  const menit = Math.max(1, Math.ceil(ms / 60e3));
  return menit >= 60 ? `${Math.floor(menit / 60)} jam ${menit % 60} menit` : `${menit} menit`;
};

// ---------- /rank /top ----------

function slashRank(i) {
  const user = i.options.getUser('member') ?? i.user;
  if (user.bot) return reply(i, 'Bot tidak punya level.');
  const member = user.id === i.user.id ? i.member : (i.options.getMember?.('member') ?? null);
  const p = data.lihat(i.guildId, user.id);
  const jumlah = data.urutan(i.guildId, 'xp').length;
  const koin = cfgGame().aktif ? (p?.koin ?? data.KOIN_AWAL) : null;
  return i.reply({
    embeds: [t.rankEmbed({
      id: user.id, nama: namaDari(user, member), p, posisi: data.peringkat(i.guildId, user.id, 'xp'), jumlah, koin,
      avatar: user.displayAvatarURL?.({ size: 128 }) ?? null,
    })],
    ...NOL,
  });
}

function slashTop(i) {
  let jenis = i.options.getString('jenis') ?? (cfgLevel().aktif ? 'level' : 'koin');
  if (jenis === 'koin' && !cfgGame().aktif) jenis = 'level';
  if (jenis === 'level' && !cfgLevel().aktif) jenis = 'koin';
  const kunci = jenis === 'koin' ? 'koin' : 'xp';
  const urut = data.urutan(i.guildId, kunci);
  const embed = t.topEmbed({ judul: `Top 10 ${jenis}`, daftar: urut.slice(0, 10), jenis });
  const posisi = data.peringkat(i.guildId, i.user.id, kunci);
  if (posisi) embed.setFooter({ text: `Kamu di peringkat #${posisi} dari ${urut.length}` });
  return i.reply({ embeds: [embed], ...NOL });
}

// ---------- koin ----------

function slashKoin(i) {
  const user = i.options.getUser('member') ?? i.user;
  if (user.bot) return reply(i, 'Bot tidak punya dompet.');
  const diriSendiri = user.id === i.user.id;
  const member = diriSendiri ? i.member : (i.options.getMember?.('member') ?? null);
  const p = diriSendiri ? data.pemain(i.guildId, who(i)) : (data.lihat(i.guildId, user.id) ?? { koin: data.KOIN_AWAL, main: 0, menang: 0 });
  const jumlah = data.urutan(i.guildId, 'koin').length;
  const extra = {};
  if (diriSendiri) {
    const sudah = Boolean(p.harian && hariWib(p.harian.at) === hariWib(Date.now()));
    extra.harianSiap = !sudah;
    extra.streak = p.harian?.streak ?? 0;
  }
  return i.reply({ embeds: [t.koinEmbed({ nama: namaDari(user, member), p, posisi: data.peringkat(i.guildId, user.id, 'koin'), jumlah, ...extra })], ...NOL });
}

// Hadiah dasar + tambahan seperempat dasar per hari beruntun (sampai 6 hari tambahan). Beruntun putus kalau ada hari yang terlewat.
function hadiahHarian(dasar, streak) {
  return dasar + Math.floor(dasar / 4) * Math.min(streak - 1, 6);
}

function slashHarian(i, now = Date.now()) {
  const c = cfgGame();
  const p = data.pemain(i.guildId, who(i));
  const hari = hariWib(now);
  if (p.harian && hariWib(p.harian.at) === hari) {
    return reply(i, `Hadiah harianmu hari ini sudah diambil. Bisa diambil lagi ${hitungMundur(mulaiHariWib(hari + 1) - now)} lagi (pukul 00.00 WIB).`);
  }
  const streak = p.harian && hariWib(p.harian.at) === hari - 1 ? p.harian.streak + 1 : 1;
  const hadiah = hadiahHarian(c.harian, streak);
  p.harian = { at: now, streak };
  const saldo = data.tambahKoin(i.guildId, who(i), hadiah);
  return i.reply({ embeds: [t.harianEmbed({ nama: namaDari(i.user, i.member), hadiah, streak, saldo })], ...NOL });
}

function slashBeri(i) {
  const target = i.options.getUser('member', true);
  const n = i.options.getInteger('jumlah', true);
  if (target.bot) return reply(i, 'Bot tidak bisa menerima koin.');
  if (target.id === i.user.id) return reply(i, 'Tidak bisa memberi koin ke diri sendiri.');
  if (!(n >= 1)) return reply(i, 'Jumlahnya minimal 1 koin.');
  if (!data.kurangiKoin(i.guildId, who(i), n)) {
    return reply(i, `Koinmu cuma ${t.koinTeks(data.koin(i.guildId, who(i)))}, tidak cukup untuk memberi ${t.koinTeks(n)}.`);
  }
  data.tambahKoin(i.guildId, target, n);
  return i.reply({ content: `🪙 <@${i.user.id}> memberi <@${target.id}> **${t.koinTeks(n)}**`, allowedMentions: { users: [target.id] } });
}

const slashInfo = (i) => i.reply({
  embeds: [t.infoGameEmbed({ ...cfgGame(), pakaiKoin: cfgGame().aktif })], flags: EPHEMERAL,
});

// ---------- /atur-game (pengelola) ----------

const input = (id, label, placeholder, { style = TextInputStyle.Short, max = 100, value = '', wajib = true } = {}) => new ActionRowBuilder().addComponents(
  (() => {
    const b = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(wajib).setMaxLength(max)
      .setPlaceholder(placeholder.slice(0, 100));
    if (value) b.setValue(String(value).slice(0, max));
    return b;
  })(),
);

const soalModal = () => new ModalBuilder().setCustomId('gm:soal').setTitle('Tambah soal kuis').addComponents(
  input('tanya', 'Pertanyaan', 'Siapa nama ketua geng yang paling disegani?', { style: TextInputStyle.Paragraph, max: 300 }),
  input('benar', 'Jawaban benar', 'Jawaban yang benar', { max: 70 }),
  input('salah1', 'Jawaban salah 1', 'Pengecoh pertama', { max: 70 }),
  input('salah2', 'Jawaban salah 2', 'Pengecoh kedua', { max: 70 }),
  input('salah3', 'Jawaban salah 3', 'Pengecoh ketiga', { max: 70 }),
);

function submitSoal(i) {
  const baca = (k) => i.fields.getTextInputValue(k).trim();
  const j = [baca('benar'), baca('salah1'), baca('salah2'), baca('salah3')];
  const tanya = baca('tanya');
  if (!tanya || j.some((x) => !x)) return reply(i, 'Pertanyaan dan keempat jawaban harus diisi.');
  if (new Set(j.map((x) => x.toLowerCase())).size < 4) return reply(i, 'Keempat jawaban harus berbeda.');
  if (!data.tambahSoal(i.guildId, { t: tanya, j })) return reply(i, `Soal buatan server sudah penuh (maksimal ${data.MAKS_SOAL}). Hapus yang lama dengan \`/atur-game soal-hapus\`.`);
  return reply(i, `Soal ditambahkan (total ${data.guild(i.guildId).soal.length}). Mainkan dengan \`/kuis kategori:Soal server\`.`);
}

const wajibLevel = 'Sistem level belum dinyalakan. Buka **/panel → Game & level** lalu nyalakan **Level**.';
const wajibGame = 'Game belum dinyalakan. Buka **/panel → Game & level** lalu nyalakan **Game**.';

async function admin(i) {
  const sub = i.options.getSubcommand();
  const level = cfgLevel();
  const game = cfgGame();
  const gid = i.guildId;

  if (['koin', 'soal-tambah', 'soal-daftar', 'soal-hapus'].includes(sub) && !game.aktif) return reply(i, wajibGame);
  if (['xp', 'level', 'hadiah', 'hapus-hadiah', 'daftar-hadiah', 'sinkron'].includes(sub) && !level.aktif) return reply(i, wajibLevel);

  switch (sub) {
    case 'koin': {
      const user = i.options.getUser('member', true);
      if (user.bot) return reply(i, 'Bot tidak punya dompet.');
      const n = i.options.getInteger('jumlah', true);
      const saldo = data.tambahKoin(gid, user, n);
      return reply(i, `Saldo ${user.username} sekarang ${t.koinTeks(saldo)} (${n >= 0 ? '+' : ''}${t.angka(n)}).`);
    }
    case 'xp':
    case 'level': {
      const user = i.options.getUser('member', true);
      if (user.bot) return reply(i, 'Bot tidak punya level.');
      const member = i.options.getMember?.('member') ?? null;
      const p = data.pemain(gid, member ?? user);
      const selisih = sub === 'xp' ? i.options.getInteger('jumlah', true) : lv.xpAwal(i.options.getInteger('level', true)) - p.xp;
      await i.deferReply({ flags: EPHEMERAL });
      const r = await lv.tambahXp(i.guild, user, selisih, { member, diam: true });
      const x = lv.info(p.xp);
      const role = r.role.length ? ` Role hadiah diberikan: ${r.role.map((x2) => x2.name).join(', ')}.` : '';
      return i.editReply({ content: `${user.username} sekarang level **${x.level}** (${t.angka(x.total)} XP).${role}`, ...NOL });
    }
    case 'reset': {
      const user = i.options.getUser('member', true);
      return reply(i, `Hapus **semua** XP, koin, dan statistik ${user.username}? Ini tidak bisa dibatalkan.`, {
        components: [t.baris(t.tombol(`gm:rs:${user.id}`, 'Ya, hapus', ButtonStyle.Danger), t.tombol('gm:rn', 'Batal'))],
      });
    }
    case 'hadiah': {
      const nilai = i.options.getInteger('level', true);
      const role = i.options.getRole('role', true);
      const nyata = i.guild.roles.cache.get(role.id) ?? role;
      if (!safety.isSafeRole(i.guild, nyata)) {
        return reply(i, 'Role itu tidak boleh dijadikan hadiah otomatis: role bot, role di atas role bot, atau role dengan izin berbahaya (admin, kelola server / role / channel, kick, ban, timeout, hapus pesan).');
      }
      const settings = store.loadSettings();
      const daftar = (settings.level.hadiah ?? []).filter((h) => h.level !== nilai);
      if (daftar.length >= lv.MAKS_HADIAH) return reply(i, `Hadiah role sudah penuh (maksimal ${lv.MAKS_HADIAH}).`);
      daftar.push({ level: nilai, role: role.id });
      settings.level.hadiah = daftar.sort((a, b) => a.level - b.level);
      store.saveSettings(settings);
      return reply(i, `Member yang mencapai **level ${nilai}** akan mendapat role **${nyata.name}**. Untuk member yang levelnya sudah lewat, jalankan \`/atur-game sinkron\`.`);
    }
    case 'hapus-hadiah': {
      const nilai = i.options.getInteger('level', true);
      const settings = store.loadSettings();
      const ada = (settings.level.hadiah ?? []).some((h) => h.level === nilai);
      if (!ada) return reply(i, `Tidak ada hadiah di level ${nilai}.`);
      settings.level.hadiah = settings.level.hadiah.filter((h) => h.level !== nilai);
      store.saveSettings(settings);
      return reply(i, `Hadiah level ${nilai} dihapus. Role yang sudah dibagikan tetap dimiliki member.`);
    }
    case 'daftar-hadiah': {
      const daftar = level.hadiah ?? [];
      if (!daftar.length) return reply(i, 'Belum ada hadiah role. Tambah dengan `/atur-game hadiah`.');
      return reply(i, daftar.map((h) => `Level **${h.level}** → <@&${h.role}>${i.guild.roles.cache.has(h.role) ? '' : ' (role sudah dihapus)'}`).join('\n'));
    }
    case 'sinkron': return sinkron(i);
    case 'soal-tambah': return i.showModal(soalModal());
    case 'soal-daftar': {
      const s = data.guild(gid).soal;
      if (!s.length) return reply(i, 'Belum ada soal buatan server. Tambah dengan `/atur-game soal-tambah`.');
      return reply(i, s.map((x, n) => `**${n + 1}.** ${t.clip(x.t, 120)} → ${t.clip(x.j[0], 40)}`).join('\n').slice(0, 1900));
    }
    case 'soal-hapus': {
      const hapus = data.hapusSoal(gid, i.options.getInteger('nomor', true));
      return reply(i, hapus ? `Soal dihapus: ${t.clip(hapus.t, 150)}` : 'Nomor soal tidak ada. Lihat daftarnya dengan `/atur-game soal-daftar`.');
    }
    default: return null;
  }
}

const MAKS_SINKRON = 300;

async function sinkron(i) {
  const daftar = lv.hadiahUntuk({ hadiah: cfgLevel().hadiah }, lv.MAKS_LEVEL);
  if (!daftar.length) return reply(i, 'Belum ada hadiah role. Tambah dengan `/atur-game hadiah`.');
  const terendah = daftar[0].level;
  const pemain = data.urutan(i.guildId, 'xp').filter((p) => lv.info(p.xp).level >= terendah);
  await i.deferReply({ flags: EPHEMERAL });
  let dicek = 0;
  let diberi = 0;
  for (const p of pemain.slice(0, MAKS_SINKRON)) {
    const m = i.guild.members.cache.get(p.id) ?? await i.guild.members.fetch(p.id).catch(() => null);
    if (!m) continue;
    dicek += 1;
    diberi += (await lv.sinkronRole(i.guild, m, lv.info(p.xp).level)).length;
  }
  const sisa = pemain.length > MAKS_SINKRON ? ` Baru ${MAKS_SINKRON} member pertama yang diperiksa, jalankan lagi untuk sisanya.` : '';
  return i.editReply({ content: `Selesai. ${dicek} member diperiksa, ${diberi} role dibagikan.${sisa}`, ...NOL });
}

// ---------- angka-angka di panel ----------

function angkaModal(customId = 'set:gamesubmit') {
  const l = cfgLevel();
  const g = cfgGame();
  return new ModalBuilder().setCustomId(customId).setTitle('Atur angka game & level').addComponents(
    input('xp', 'XP per pesan (kecil-besar)', '15-25', { max: 12, value: `${l.xpMin}-${l.xpMaks}` }),
    input('jeda', 'Jeda antar XP chat (detik)', '60', { max: 5, value: l.jedaDetik }),
    input('xpvoice', 'XP voice per menit (0 = mati)', '5', { max: 3, value: l.xpVoice }),
    input('koin', 'Koin: harian / kuis / naik level', '200 / 50 / 50', { max: 40, value: `${g.harian} / ${g.kuis} / ${g.koinNaikLevel}` }),
    input('taruhan', 'Taruhan maksimal (koin)', '5000', { max: 10, value: g.taruhanMaks }),
  );
}

const bulat = (teks, min, maks) => {
  const s = String(teks).trim().replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= maks ? n : null;
};

// Baca isian modal. Mengembalikan { galat } atau { nilai } (belum disimpan).
function bacaAngka(baca) {
  const galat = [];
  const xp = String(baca('xp')).trim().match(/^(\d+)\s*(?:[-–—]|sampai|s\/d)?\s*(\d+)?$/i);
  let xpMin = xp ? Number(xp[1]) : NaN;
  let xpMaks = xp ? Number(xp[2] ?? xp[1]) : NaN;
  if (!(xpMin >= 1 && xpMaks >= xpMin && xpMaks <= 500)) {
    galat.push('XP per pesan: tulis seperti `15-25` (1 sampai 500).');
    xpMin = null;
    xpMaks = null;
  }
  const jeda = bulat(baca('jeda'), 5, 3600);
  if (jeda === null) galat.push('Jeda XP: 5 sampai 3600 detik.');
  const xpVoice = bulat(baca('xpvoice'), 0, 100);
  if (xpVoice === null) galat.push('XP voice: 0 sampai 100.');
  const koin = String(baca('koin')).split(/[/,;]|\s+/).filter(Boolean).map((x) => bulat(x, 0, 1_000_000));
  if (koin.length !== 3 || koin.includes(null)) galat.push('Koin: tulis tiga angka dipisah garis miring, mis. `200 / 50 / 50` (harian / kuis / naik level).');
  const taruhanMaks = bulat(baca('taruhan'), 1, 10_000_000);
  if (taruhanMaks === null) galat.push('Taruhan maksimal: 1 sampai 10.000.000.');
  if (galat.length) return { galat };
  return { nilai: { xpMin, xpMaks, jeda, xpVoice, harian: koin[0], kuis: koin[1], koinNaikLevel: koin[2], taruhanMaks } };
}

// Simpan isian modal ke pengaturan. Mengembalikan { galat } kalau ada yang salah (tidak ada yang disimpan).
function simpanAngka(i) {
  const r = bacaAngka((k) => i.fields.getTextInputValue(k));
  if (r.galat) return r;
  const s = store.loadSettings();
  const n = r.nilai;
  Object.assign(s.level, { xpMin: n.xpMin, xpMaks: n.xpMaks, jedaDetik: n.jeda, xpVoice: n.xpVoice });
  Object.assign(s.game, { harian: n.harian, kuis: n.kuis, koinNaikLevel: n.koinNaikLevel, taruhanMaks: n.taruhanMaks });
  store.saveSettings(s);
  return r;
}

// ---------- pintu masuk ----------

async function slash(i) {
  const manager = access.isManager(i);
  const level = cfgLevel().aktif;
  const game = cfgGame().aktif;
  const nama = i.commandName;
  if (nama === ADMIN_CMD) {
    if (!manager) return reply(i, KHUSUS);
    if (!level && !game) return reply(i, `${wajibLevel}\n${wajibGame}`);
    return admin(i);
  }
  // /top memilih sendiri (level atau koin) sesuai yang menyala; selebihnya harus menyala dulu.
  const mati = nama === 'top' ? !level && !game : GAME_CMD.has(nama) ? !game : !level;
  if (mati) {
    const pesan = nama === 'top' ? `${wajibLevel}\n${wajibGame}` : GAME_CMD.has(nama) ? wajibGame : wajibLevel;
    return reply(i, manager ? pesan : 'Fitur ini belum dinyalakan oleh pengelola server.');
  }
  switch (nama) {
    case 'rank': return slashRank(i);
    case 'top': return slashTop(i);
    case 'koin': return slashKoin(i);
    case 'harian': return slashHarian(i);
    case 'beri': return slashBeri(i);
    case 'game': return slashInfo(i);
    case 'slot': return permainan.slot(i);
    case 'dadu': return permainan.dadu(i);
    case 'lempar': return permainan.lempar(i);
    case 'suit': return permainan.suit(i);
    case 'xo': return permainan.xo(i);
    case 'kuis': return permainan.kuis(i);
    case 'blackjack': return permainan.blackjack(i);
    default: return null;
  }
}

async function komponen(i) {
  const [, aksi, arg] = i.customId.split(':');
  if (aksi === 'soal') return access.isManager(i) ? submitSoal(i) : reply(i, KHUSUS);
  if (aksi === 'rs' || aksi === 'rn') {
    if (!access.isManager(i)) return reply(i, KHUSUS);
    if (aksi === 'rn') return i.update({ content: 'Dibatalkan.', components: [] });
    const ada = data.hapusPemain(i.guildId, arg);
    return i.update({ content: ada ? 'Data member itu dihapus.' : 'Member itu tidak punya data.', components: [] });
  }
  if (!cfgGame().aktif) return reply(i, 'Game sedang dimatikan oleh pengelola.');
  return permainan.komponen(i);
}

async function handle(i) {
  try {
    if (i.isChatInputCommand()) return await slash(i);
    return await komponen(i);
  } catch (err) {
    console.error(`[game] ${err.stack ?? err.message}`);
    const say = (c) => (i.deferred || i.replied ? i.editReply({ content: c }) : reply(i, c));
    return say(`❌ ${err.message}`).catch(() => {});
  }
}

// ---------- XP chat dan penyapu ----------

// Dipanggil untuk setiap pesan di server. Aman: tidak pernah melempar.
function onMessage(message) {
  try {
    return Promise.resolve(lv.onMessage(message)).catch((err) => console.error(`[level] ${err.message}`));
  } catch (err) {
    console.error(`[level] ${err.message}`);
    return Promise.resolve(null);
  }
}

let timer = null;

async function sweep(client, now = Date.now()) {
  await lv.sweepVoice(client).catch((err) => console.error(`[level] ${err.message}`));
  await permainan.sweep(client, now).catch((err) => console.error(`[game] ${err.message}`));
  lv.bersihkan(now);
}

function warmup(client) {
  if (timer) return;
  timer = setInterval(() => sweep(client).catch((err) => console.error(`[game] ${err.message}`)), 60e3);
  timer.unref?.();
}

function shutdown() {
  clearInterval(timer);
  timer = null;
  permainan.reset();
  data.flush();
}

// ---------- untuk panel ----------

function summary(guildId) {
  const l = cfgLevel();
  const g = cfgGame();
  if (!l.aktif && !g.aktif) return 'mati';
  const n = data.semua(guildId).length;
  return `${[l.aktif && 'level', g.aktif && 'game'].filter(Boolean).join(' + ')} aktif · ${n} pemain`;
}

module.exports = {
  commands, enabledCommands, owns, handle, onMessage, warmup, shutdown, sweep, summary, flush: data.flush,
  angkaModal, simpanAngka, bacaAngka, hadiahHarian, slashHarian, data, level: lv, permainan, games,
};
