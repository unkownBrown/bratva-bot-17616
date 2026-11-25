// Fitur musik: command /play /skip /stop /queue /musik, tombol kartu, dan pemeriksaan mesin.
// Mati sampai dinyalakan di /panel → Pengaturan → Musik. Command-nya baru muncul di Discord setelah dinyalakan.
const {
  SlashCommandBuilder, InteractionContextType, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits: P,
} = require('discord.js');
const store = require('../store');
const access = require('../access');
const alat = require('./alat');
const mesin = require('./mesin');
const sumber = require('./sumber');
const spotify = require('./spotify');
const lirik = require('./lirik');
const tampilan = require('./tampilan');
const pemutar = require('./pemutar');

const { MusikError } = sumber;
const EPHEMERAL = MessageFlags.Ephemeral;
const COMMANDS = new Set(['play', 'skip', 'stop', 'queue', 'musik']);
const cfg = () => store.loadSettings().musik;

// ---------- definisi command ----------

function commands() {
  const guildOnly = (b) => b.setContexts(InteractionContextType.Guild);
  return [
    guildOnly(new SlashCommandBuilder().setName('play').setDescription('Putar lagu dari YouTube / Spotify (judul atau link)'))
      .addStringOption((o) => o.setName('lagu').setDescription('Judul lagu, link YouTube, link Spotify (lagu / album / playlist), atau link situs lain').setRequired(true).setMaxLength(300))
      .addBooleanOption((o) => o.setName('berikutnya').setDescription('Taruh paling depan, diputar setelah lagu ini')),
    guildOnly(new SlashCommandBuilder().setName('skip').setDescription('Lewati lagu yang sedang diputar')),
    guildOnly(new SlashCommandBuilder().setName('stop').setDescription('Hentikan musik, kosongkan antrian, dan keluar dari voice')),
    guildOnly(new SlashCommandBuilder().setName('queue').setDescription('Lihat antrian lagu')),
    guildOnly(new SlashCommandBuilder().setName('musik').setDescription('Kontrol musik lainnya'))
      .addSubcommand((s) => s.setName('jeda').setDescription('Jeda lagu'))
      .addSubcommand((s) => s.setName('lanjut').setDescription('Lanjutkan lagu yang dijeda'))
      .addSubcommand((s) => s.setName('sekarang').setDescription('Pindahkan kartu lagu (dengan lirik) ke channel ini'))
      .addSubcommand((s) => s.setName('loop').setDescription('Ulangi lagu atau antrian')
        .addStringOption((o) => o.setName('mode').setDescription('Mode ulang').setRequired(true)
          .addChoices({ name: 'mati', value: 'mati' }, { name: 'ulang lagu ini', value: 'lagu' }, { name: 'ulang seluruh antrian', value: 'antrian' })))
      .addSubcommand((s) => s.setName('acak').setDescription('Acak urutan antrian'))
      .addSubcommand((s) => s.setName('hapus').setDescription('Hapus satu lagu dari antrian')
        .addIntegerOption((o) => o.setName('nomor').setDescription('Nomor di /queue').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('volume').setDescription('Atur volume (lagu dimulai ulang dari menit yang sama)')
        .addIntegerOption((o) => o.setName('persen').setDescription('10 sampai 200, normal 100').setRequired(true).setMinValue(10).setMaxValue(200)))
      .addSubcommand((s) => s.setName('loncat').setDescription('Loncat ke menit tertentu')
        .addStringOption((o) => o.setName('waktu').setDescription('Contoh: 1:30, 90, atau 1m30s').setRequired(true).setMaxLength(12)))
      .addSubcommand((s) => s.setName('lirik').setDescription('Baca lirik lengkap lagu yang sedang diputar'))
      .addSubcommand((s) => s.setName('cari').setDescription('Cari lagu di YouTube dan pilih hasilnya')
        .addStringOption((o) => o.setName('kata').setDescription('Judul atau kata kunci').setRequired(true).setMaxLength(200)))
      .addSubcommand((s) => s.setName('masuk').setDescription('Panggil bot ke voice channel kamu'))
      .addSubcommand((s) => s.setName('cek').setDescription('Cek kesehatan mesin musik (khusus pengelola)')),
  ].map((c) => c.toJSON());
}

// Dipakai interactions.commandJSON(): command musik hanya didaftarkan kalau fiturnya menyala.
const enabledCommands = () => (cfg().aktif ? commands() : []);

const owns = (i) => (i.isChatInputCommand() && COMMANDS.has(i.commandName)) || ((i.isMessageComponent() || i.isModalSubmit()) && /^mu:/.test(i.customId));

// ---------- balasan ----------

const reply = (i, content, extra = {}) => i.reply({ content, flags: EPHEMERAL, ...extra });
const say = (i, content) => (i.deferred || i.replied ? i.editReply({ content, components: [], embeds: [] }) : reply(i, content));
const errText = (err) => (err instanceof MusikError ? err.message : sumber.friendly(err));

// Syarat dasar: fitur menyala dan paket voice terpasang.
async function gate(i) {
  if (!cfg().aktif) {
    await reply(i, access.isManager(i)
      ? 'Musik belum dinyalakan. Buka **/panel → Pengaturan** lalu nyalakan **Musik**.'
      : 'Fitur musik belum dinyalakan oleh pengelola server.');
    return false;
  }
  const problem = pemutar.voiceProblem();
  if (problem) {
    await reply(i, problem);
    return false;
  }
  return true;
}

// Syarat kontrol (jeda, lewati, stop...): ada sesi, dan kamu ada di voice channel yang sama dengan bot (pengelola bebas).
async function control(i) {
  if (!(await gate(i))) return null;
  const session = pemutar.get(i.guildId);
  if (!session) {
    if (i.isMessageComponent()) await i.update({ components: [] }).catch(() => {});
    else await reply(i, 'Tidak ada musik yang sedang diputar. Ketik `/play` dulu.');
    return null;
  }
  if (!access.isManager(i) && i.member?.voice?.channelId !== session.voiceChannelId) {
    await reply(i, `Kamu harus ada di voice channel yang sama dengan bot (<#${session.voiceChannelId}>).`);
    return null;
  }
  return session;
}

// ---------- /play ----------

async function play(i) {
  if (!(await gate(i))) return;
  const vc = i.member?.voice?.channel;
  if (!vc) return reply(i, 'Masuk dulu ke voice channel, baru ketik `/play`.');
  await i.deferReply();

  const by = { id: i.user.id, name: i.user.username };
  const [joined, found] = await Promise.allSettled([
    pemutar.ensure(i.guild, vc, i.channel),
    sumber.resolve(i.options.getString('lagu', true), by),
  ]);
  if (found.status === 'rejected') {
    if (joined.status === 'fulfilled' && !joined.value.queue.current && !joined.value.queue.size) await joined.value.leave('');
    return say(i, `❌ ${errText(found.reason)}`);
  }
  if (joined.status === 'rejected') return say(i, `❌ ${errText(joined.reason)}`);

  const session = joined.value;
  const idle = !session.queue.current;
  const next = Boolean(i.options.getBoolean('berikutnya'));
  const before = session.queue.size;
  const n = session.add(found.value.tracks, { next });
  if (!n) return say(i, `❌ Antrian penuh (maksimal ${cfg().maksAntrian} lagu).`);

  const notes = [...found.value.notes];
  if (n < found.value.tracks.length) notes.push(`Hanya ${n} lagu yang muat di antrian.`);
  const me = i.guild.members.me;
  if (!i.channel?.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
    notes.push('Bot tidak bisa menulis di channel ini, jadi kartu lirik tidak tampil. Beri izin Send Messages dan Embed Links.');
  }

  let text;
  if (found.value.kind === 'playlist') {
    text = `✅ **${n}** lagu dari **${lirik.esc(tampilan.clip(found.value.title, 80))}** (${found.value.from}) masuk antrian.`;
  } else {
    const t = found.value.tracks[0];
    const where = idle ? 'Memutar sekarang' : next ? 'Diputar berikutnya' : `Masuk antrian #${before + 1}`;
    text = `✅ ${where}: **${lirik.esc(tampilan.clip(t.title, 90))}**${t.durationMs ? ` (${tampilan.fmt(t.durationMs)})` : ''}`;
  }
  return i.editReply({ content: [text, ...notes].join('\n'), allowedMentions: { parse: [] } });
}

// ---------- perintah lain ----------

function parseTime(text) {
  const s = String(text).trim().toLowerCase();
  let m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) return m[3] !== undefined ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 : (+m[1] * 60 + +m[2]) * 1000;
  m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(s);
  if (m && (m[1] || m[2] || m[3])) return (((+m[1] || 0) * 60 + (+m[2] || 0)) * 60 + (+m[3] || 0)) * 1000;
  return null;
}

async function lyricsFull(i) {
  const session = await control(i);
  if (!session) return;
  const t = session.queue.current;
  if (!t) return reply(i, 'Belum ada lagu yang diputar.');
  await i.deferReply({ flags: EPHEMERAL });
  let data = session.lyric?.data;
  if (!data) {
    try {
      data = await lirik.find(pemutar.lyricInfo(t));
    } catch (err) {
      return i.editReply(`Lirik tidak bisa diambil sekarang: ${err.message}`);
    }
  }
  if (!data) return i.editReply('Lirik lagu ini tidak ditemukan di LRCLIB.');
  return i.editReply({ embeds: [tampilan.lyricsEmbed(t, data)] });
}

async function search(i) {
  if (!(await gate(i))) return;
  if (!i.member?.voice?.channel) return reply(i, 'Masuk dulu ke voice channel, baru cari lagu.');
  await i.deferReply({ flags: EPHEMERAL });
  const found = await sumber.candidates(i.options.getString('kata', true));
  if (!found.length) return i.editReply('Tidak ada hasil.');
  const menu = new StringSelectMenuBuilder().setCustomId(`mu:pick:${i.user.id}`).setPlaceholder('Pilih lagu...').addOptions(
    found.slice(0, 8).map((c) => ({
      label: tampilan.clip(c.title || c.id, 100), value: c.id,
      description: tampilan.clip(`${c.channel}${c.durationMs ? ` · ${tampilan.fmt(c.durationMs)}` : c.live ? ' · LIVE' : ''}`, 100),
    })),
  );
  return i.editReply({ content: `Hasil untuk **${lirik.esc(tampilan.clip(i.options.getString('kata'), 80))}**:`, components: [new ActionRowBuilder().addComponents(menu)] });
}

async function pick(i) {
  const [, , userId] = i.customId.split(':');
  if (i.user.id !== userId) return reply(i, 'Pilihan ini untuk yang mencari.');
  if (!(await gate(i))) return;
  const vc = i.member?.voice?.channel;
  if (!vc) return i.update({ content: 'Kamu sudah tidak ada di voice channel.', components: [] });
  await i.deferUpdate();
  try {
    const by = { id: i.user.id, name: i.user.username };
    const [session, track] = await Promise.all([pemutar.ensure(i.guild, vc, i.channel), sumber.fromCandidate(i.values[0], by)]);
    const idle = !session.queue.current;
    session.add([track]);
    return i.editReply({ content: `✅ ${idle ? 'Memutar sekarang' : `Masuk antrian #${session.queue.size}`}: **${lirik.esc(tampilan.clip(track.title, 90))}**`, components: [] });
  } catch (err) {
    return i.editReply({ content: `❌ ${errText(err)}`, components: [] });
  }
}

async function join(i) {
  if (!(await gate(i))) return;
  const vc = i.member?.voice?.channel;
  if (!vc) return reply(i, 'Masuk dulu ke voice channel.');
  await i.deferReply({ flags: EPHEMERAL });
  try {
    await pemutar.ensure(i.guild, vc, i.channel);
    return i.editReply(`Bot masuk ke ${vc}. Ketik \`/play\` buat memutar lagu.`);
  } catch (err) {
    return i.editReply(`❌ ${errText(err)}`);
  }
}

// ---------- pemeriksaan mesin ----------

const OK = '✅';
const BAD = '❌';
const WARN = '⚠️';

async function diagnose() {
  const rows = [];
  const major = Number(process.versions.node.split('.')[0]);
  rows.push(`${major >= 20 ? OK : WARN} Node ${process.versions.node}${major >= 20 ? '' : ' (YouTube butuh Node 20 ke atas buat yt-dlp, disarankan 22)'}`);

  rows.push(pemutar.voice() ? `${OK} paket voice (@discordjs/voice)` : `${BAD} ${pemutar.voiceProblem()}`);
  const report = pemutar.dependencyReport();
  if (pemutar.voice()) {
    const enc = /Encryption Libraries[\s\S]*?(?=\n\n|$)/.exec(report)?.[0]?.replace(/\n/g, ' · ');
    const dave = /davey/i.test(report) ? `${OK} DAVE (enkripsi voice Discord) terpasang` : `${WARN} paket @snazzah/davey tidak terlihat: voice bisa gagal tersambung (jalankan npm install)`;
    rows.push(dave);
    if (enc) rows.push(`ℹ️ ${tampilan.clip(enc, 200)}`);
  }

  const ff = alat.ffmpeg();
  rows.push(ff ? `${alat.info.ffmpeg.libopus ? OK : WARN} ffmpeg ${alat.info.ffmpeg.version}${alat.info.ffmpeg.libopus ? '' : ' tanpa libopus (kualitas suara turun)'}` : `${BAD} ${alat.info.ffmpeg.error}`);

  try {
    await alat.ensureYtdlp();
    const y = alat.info.ytdlp;
    rows.push(`${OK} yt-dlp ${y.version}${y.channel ? ` (${y.channel})` : ''}${y.note ? ` · ${y.note}` : ''}`);
    rows.push(`ℹ️ JS runtime: ${alat.info.flags.jsRuntimes ? 'Node (otomatis)' : 'tidak terdeteksi'} · cookies: ${alat.cookiesFile() ? 'ada' : 'tidak ada'}`);
  } catch (err) {
    rows.push(`${BAD} yt-dlp: ${err.message}`);
  }

  let sample = null;
  try {
    const found = await sumber.candidates('Rick Astley Never Gonna Give You Up');
    rows.push(`${found.length ? OK : BAD} pencarian YouTube (${found.length} hasil)`);
    if (found[0]) {
      sample = await sumber.fromCandidate(found[0].id, { name: 'cek' });
      rows.push(`${OK} alamat audio YouTube berhasil diambil`);
    }
  } catch (err) {
    rows.push(`${BAD} YouTube: ${sumber.friendly(err)}`);
  }
  if (sample) {
    const p = await mesin.probe(sample);
    rows.push(p.ok ? `${OK} ffmpeg bisa membaca stream YouTube` : `${BAD} ffmpeg gagal membaca stream: ${tampilan.clip(p.tail, 160)}`);
  }

  try {
    const data = await lirik.find({ key: 'cek', title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationMs: 213000, clean: true });
    rows.push(data?.synced ? `${OK} lirik berwaktu (LRCLIB)` : data ? `${WARN} LRCLIB menjawab tapi lirik tanpa waktu` : `${WARN} LRCLIB menjawab tapi lagu uji tidak ketemu`);
  } catch (err) {
    rows.push(`${BAD} LRCLIB: ${err.message}`);
  }

  try {
    const meta = await spotify.resolve('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b');
    rows.push(`${OK} Spotify (${spotify.hasApi() ? 'API resmi' : 'halaman embed'}): ${tampilan.clip(`${meta.tracks[0].artist} - ${meta.tracks[0].title}`, 80)}`);
  } catch (err) {
    rows.push(`${BAD} Spotify: ${err.message}`);
  }

  rows.push(`ℹ️ Sesi aktif: ${pemutar.activeCount()}`);
  return rows;
}

async function check(i) {
  if (!access.isManager(i)) return reply(i, 'Ini khusus yang punya izin Manage Server atau role pengelola bot.');
  if (!cfg().aktif) return reply(i, 'Musik belum dinyalakan. Buka **/panel → Pengaturan** lalu nyalakan **Musik**.');
  await i.deferReply({ flags: EPHEMERAL });
  const rows = await diagnose();
  const bad = rows.some((r) => r.startsWith(BAD));
  const embed = new EmbedBuilder().setColor(bad ? 0xc0392b : 0x2e8b57).setTitle('Cek mesin musik').setDescription(rows.join('\n'))
    .setFooter({ text: bad ? 'Ada yang gagal. Lihat README bagian Musik.' : 'Semua siap.' });
  return i.editReply({ embeds: [embed] });
}

// ---------- pintu masuk ----------

async function slash(i) {
  switch (i.commandName) {
    case 'play': return play(i);
    case 'queue': {
      if (!(await gate(i))) return undefined;
      const s = pemutar.get(i.guildId);
      return s ? i.reply({ embeds: [tampilan.queueEmbed(s)], flags: EPHEMERAL }) : reply(i, 'Antrian kosong. Ketik `/play` buat mulai.');
    }
    case 'skip': {
      const s = await control(i);
      if (!s) return undefined;
      const title = s.queue.current?.title ?? 'lagu';
      s.skip();
      return i.reply({ content: `⏭️ Dilewati: **${lirik.esc(tampilan.clip(title, 80))}**`, allowedMentions: { parse: [] } });
    }
    case 'stop': {
      const s = await control(i);
      if (!s) return undefined;
      await i.reply({ content: '⏹️ Musik dihentikan, bot keluar dari voice.' });
      return s.leave(`⏹ Musik dihentikan oleh <@${i.user.id}>.`);
    }
    default:
  }

  // /musik <sub>
  const sub = i.options.getSubcommand();
  if (sub === 'cek') return check(i);
  if (sub === 'cari') return search(i);
  if (sub === 'masuk') return join(i);
  if (sub === 'lirik') return lyricsFull(i);

  const s = await control(i);
  if (!s) return undefined;
  switch (sub) {
    case 'jeda': return reply(i, s.pause() ? '⏸️ Dijeda.' : 'Lagu sedang tidak diputar.');
    case 'lanjut': return reply(i, s.resume() ? '▶️ Dilanjutkan.' : 'Lagu tidak sedang dijeda.');
    case 'sekarang':
      s.textChannel = i.channel;
      s.moveCard = true;
      s.requestRender({ now: true });
      return reply(i, 'Kartu lagu dipindahkan ke channel ini.');
    case 'loop': {
      s.queue.setLoop(i.options.getString('mode', true));
      s.requestRender({ now: true });
      return reply(i, `🔁 Loop: **${s.queue.loop}**`);
    }
    case 'acak':
      s.queue.shuffle();
      s.requestRender();
      return reply(i, '🔀 Antrian diacak.');
    case 'hapus': {
      const removed = s.queue.remove(i.options.getInteger('nomor', true));
      s.requestRender();
      return reply(i, removed ? `🗑️ Dihapus: **${lirik.esc(tampilan.clip(removed.title, 80))}**` : 'Nomor itu tidak ada di antrian.');
    }
    case 'volume': {
      const v = s.setVolume(i.options.getInteger('persen', true));
      return reply(i, `🔊 Volume ${v}%${s.queue.current ? ' (lagu dimulai ulang dari menit yang sama)' : ''}`);
    }
    case 'loncat': {
      const ms = parseTime(i.options.getString('waktu', true));
      if (ms === null) return reply(i, 'Format waktu tidak dikenali. Contoh: `1:30`, `90`, atau `1m30s`.');
      return reply(i, s.seek(ms) ? `⏩ Loncat ke ${tampilan.fmt(ms)}.` : 'Lagu ini tidak bisa di-loncat (siaran langsung).');
    }
    default: return undefined;
  }
}

async function button(i) {
  const [, action] = i.customId.split(':');
  if (action === 'pick') return pick(i);
  if (action === 'volsubmit') {
    const s = await control(i);
    if (!s) return undefined;
    const n = parseInt(i.fields.getTextInputValue('persen'), 10);
    if (!Number.isFinite(n) || n < 10 || n > 200) return reply(i, 'Volume harus angka 10 sampai 200.');
    return reply(i, `🔊 Volume ${s.setVolume(n)}%${s.queue.current ? ' (lagu dimulai ulang dari menit yang sama)' : ''}`);
  }
  if (action === 'queue') {
    if (!(await gate(i))) return undefined;
    const s = pemutar.get(i.guildId);
    return s ? i.reply({ embeds: [tampilan.queueEmbed(s)], flags: EPHEMERAL }) : i.update({ components: [] });
  }

  const s = await control(i);
  if (!s) return undefined;
  if (action === 'vol') {
    return i.showModal(new ModalBuilder().setCustomId('mu:volsubmit').setTitle('Volume').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('persen').setLabel('Volume (10 sampai 200, normal 100)')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(s.volume))),
    ));
  }
  await i.deferUpdate();
  switch (action) {
    case 'pause': s.togglePause(); break;
    case 'skip': s.skip(); break;
    case 'stop': await s.leave(`⏹ Musik dihentikan oleh <@${i.user.id}>.`); break;
    case 'loop': s.queue.cycleLoop(); s.requestRender({ now: true }); break;
    case 'shuffle': s.queue.shuffle(); s.requestRender({ now: true }); break;
    case 'lirik': s.toggleLyrics(); break;
    case 'offm': s.shiftLyrics(-500); break;
    case 'offp': s.shiftLyrics(500); break;
    default:
  }
  return undefined;
}

async function handle(i) {
  try {
    if (i.isChatInputCommand()) return await slash(i);
    return await button(i);
  } catch (err) {
    console.error(`[musik] ${err.stack ?? err.message}`);
    const text = `Gagal: ${errText(err)}`.slice(0, 1800);
    if (i.deferred || i.replied) await i.editReply({ content: text, components: [] }).catch(() => {});
    else await i.reply({ content: text, flags: EPHEMERAL }).catch(() => {});
    return undefined;
  }
}

// Dipanggil saat bot menyala dan saat fiturnya dinyalakan: pasang mesin dan jaga tetap terbaru.
function warmup() {
  if (cfg().aktif) alat.startAuto();
}

// Fitur dimatikan: semua sesi berhenti.
async function stopAll() {
  await pemutar.shutdown();
}

function summary() {
  const y = alat.info.ytdlp;
  const parts = [
    cfg().aktif ? 'aktif' : 'mati',
    pemutar.voice() ? 'voice siap' : 'paket voice belum terpasang',
    y.version ? `yt-dlp ${y.version}` : y.error ? 'yt-dlp bermasalah' : 'yt-dlp belum dipasang',
    `${pemutar.activeCount()} sesi`,
  ];
  return parts.join(' · ');
}

module.exports = {
  owns, handle, enabledCommands, commands, warmup, stopAll, summary,
  onVoiceState: pemutar.onVoiceState, shutdown: pemutar.shutdown, parseTime,
};
