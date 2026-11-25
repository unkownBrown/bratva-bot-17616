// Log share screen: catat siapa mulai dan selesai share screen (Go Live) di voice, kirim ke channel video-recorder.
// Yang dicatat hanya siapa, di voice mana, kapan, dan berapa lama. Bot Discord tidak bisa menerima gambar atau suara dari share screen
// (Discord tidak membuka itu untuk bot, dan sejak Maret 2026 panggilan video juga terenkripsi ujung ke ujung), jadi tidak ada rekaman videonya.
const { EmbedBuilder } = require('discord.js');
const store = require('./store');
const panels = require('./panels');
const runtime = require('./runtime');

const COLORS = { mulai: 0xd9363e, selesai: 0x6b7280 };

// guildId:userId -> { start, channelId, umum, kira, timer }
// umum = pesan "mulai" sudah terkirim (share screen yang selesai sebelum jeda tunda tidak dikirim sama sekali, supaya klik-lepas tidak jadi spam).
const sesi = new Map();

const cfg = () => store.peekSettings().layar;
const keyOf = (guild, user) => `${guild.id}:${user.id}`;

function header(color, title, user, ms) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp(ms);
  if (user) embed.setAuthor({ name: user.tag ?? user.username, iconURL: user.displayAvatarURL?.() ?? undefined });
  return embed;
}

let warned = new Set();
async function kirim(guild, embed) {
  const channel = panels.moduleChannel(guild, 'layar');
  if (!channel) {
    if (!warned.has(guild.id)) console.warn(`[${guild.name}] Log share screen menyala tapi channel video-recorder tidak ketemu. Hubungkan lewat Pengaturan.`);
    warned.add(guild.id);
    return;
  }
  warned.delete(guild.id);
  try {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error(`[${guild.name}] Gagal kirim log share screen: ${err.message}`);
  }
}

function umumkanMulai(guild, user, s) {
  s.umum = true;
  const embed = header(COLORS.mulai, 'SHARE SCREEN MULAI', user, s.start)
    .setDescription(`${user} share screen di <#${s.channelId}>`)
    .addFields({ name: 'Mulai', value: runtime.wib(s.start), inline: true })
    .setFooter({ text: `ID ${user.id}` });
  return kirim(guild, embed);
}

function mulai(guild, user, channelId, { kira = false, announce = true } = {}) {
  const key = keyOf(guild, user);
  const s = { start: Date.now(), channelId, umum: !announce, kira, timer: null };
  sesi.set(key, s);
  if (!announce) return;
  const tunda = Math.max(0, Number(cfg().tundaDetik) || 0);
  if (!tunda) {
    umumkanMulai(guild, user, s);
    return;
  }
  s.timer = setTimeout(() => {
    s.timer = null;
    if (sesi.get(key) === s) umumkanMulai(guild, user, s);
  }, tunda * 1000);
  s.timer.unref?.();
}

function selesai(guild, user) {
  const key = keyOf(guild, user);
  const s = sesi.get(key);
  if (!s) return Promise.resolve();
  clearTimeout(s.timer);
  sesi.delete(key);
  if (!s.umum) return Promise.resolve();
  const now = Date.now();
  const embed = header(COLORS.selesai, 'SHARE SCREEN SELESAI', user, now)
    .setDescription(`${user} selesai share screen di <#${s.channelId}>`)
    .addFields(
      { name: s.kira ? 'Lama (dihitung sejak bot menyala)' : 'Lama', value: runtime.duration(now - s.start), inline: true },
      { name: 'Waktu', value: runtime.wib(now), inline: true },
    )
    .setFooter({ text: `ID ${user.id}` });
  return kirim(guild, embed);
}

// Dipanggil dari Events.VoiceStateUpdate. Yang diperhatikan hanya status share screen (state.streaming) dan keluar dari voice.
function onVoice(oldState, newState) {
  const guild = newState.guild ?? oldState.guild;
  const user = (newState.member ?? oldState.member)?.user;
  if (!guild || !user) return;
  const c = cfg();
  if (!c.aktif || (user.bot && c.abaikanBot)) {
    // Fitur dimatikan di tengah share screen: lupakan sesinya supaya tidak ada pesan "selesai" yatim.
    const s = sesi.get(keyOf(guild, user));
    if (s) {
      clearTimeout(s.timer);
      sesi.delete(keyOf(guild, user));
    }
    return;
  }
  const channelId = newState.channelId;
  const sharing = Boolean(channelId && newState.streaming);
  const s = sesi.get(keyOf(guild, user));
  if (sharing && !s) mulai(guild, user, channelId);
  else if (sharing && s) s.channelId = channelId; // pindah voice sambil tetap share
  else if (!sharing && s) selesai(guild, user);
}

// Bot baru menyala: yang sedang share screen dicatat tanpa pengumuman "mulai" baru (pengumumannya sudah terkirim sebelum bot restart).
function seed(guild) {
  const c = cfg();
  if (!c.aktif) return;
  for (const state of guild.voiceStates?.cache?.values() ?? []) {
    const user = state.member?.user;
    if (!user || (user.bot && c.abaikanBot) || !state.channelId || !state.streaming) continue;
    if (!sesi.has(keyOf(guild, user))) mulai(guild, user, state.channelId, { kira: true, announce: false });
  }
}

function reset() {
  for (const s of sesi.values()) clearTimeout(s.timer);
  sesi.clear();
  warned = new Set();
}

module.exports = { onVoice, seed, shutdown: reset, reset, aktif: () => sesi.size };
