const { ChannelType, EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const store = require('./store');
const panels = require('./panels');

const SEE = [
  ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum,
].filter((t) => t !== undefined);
const VOICE = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

const sees = (channel, target) => channel.permissionsFor(target)?.has(P.ViewChannel) ?? false;
const acts = (channel, target) => channel.permissionsFor(target)?.has(VOICE.includes(channel.type) ? P.Connect : P.SendMessages) ?? false;
const sorted = (list) => [...list].sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) || a.rawPosition - b.rawPosition);

// ---------- lihat permission ----------

// Channel yang dibuka oleh role ini: role bisa melihatnya tapi @everyone tidak.
function opensFor(guild, role) {
  if (role.permissions.has(P.Administrator)) return { admin: true, channels: [] };
  const everyone = guild.roles.everyone;
  const channels = [...guild.channels.cache.values()].filter((c) => SEE.includes(c.type) && sees(c, role) && !sees(c, everyone));
  return { admin: false, channels: sorted(channels) };
}

// Daftar channel dikelompokkan per kategori, dalam bentuk teks.
function groupText(channels, limit = 3800) {
  const groups = new Map();
  for (const c of channels) {
    const name = c.parent?.name ?? 'Tanpa kategori';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(`<#${c.id}>`);
  }
  const text = [...groups].map(([name, list]) => `**${name}**\n${list.join(' ')}`).join('\n\n');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// Siapa yang bisa melihat dan menulis di channel ini.
function rolesFor(guild, channel) {
  const everyone = guild.roles.everyone;
  const view = [];
  const act = [];
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id || role.managed || role.permissions.has(P.Administrator)) continue;
    if (sees(channel, role)) view.push(role);
    if (acts(channel, role)) act.push(role);
  }
  return { everyoneSees: sees(channel, everyone), everyoneActs: acts(channel, everyone), view, act, voice: VOICE.includes(channel.type) };
}

// ---------- arahan: dapat role X = diarahkan ke channel Y ----------

const configOf = (guildId, roleId, state = store.loadState()) => state.arahan[guildId]?.[roleId] ?? null;

function setConfig(guildId, roleId, patch) {
  const state = store.loadState();
  const all = (state.arahan[guildId] ??= {});
  all[roleId] = { aktif: true, channelIds: [], note: '', ...all[roleId], ...patch };
  store.saveState(state);
  return all[roleId];
}

function removeConfig(guildId, roleId) {
  const state = store.loadState();
  if (state.arahan[guildId]) delete state.arahan[guildId][roleId];
  store.saveState(state);
}

// Tujuan arahan: channel pilihan admin, atau kalau kosong otomatis channel yang dibuka role itu.
function targets(guild, roleId, cfg) {
  const picked = (cfg.channelIds ?? []).map((id) => guild.channels.cache.get(id)).filter(Boolean);
  if (picked.length) return picked;
  const role = guild.roles.cache.get(roleId);
  return role ? opensFor(guild, role).channels : [];
}

function directionEmbed(guild, roleIds) {
  const state = store.loadState();
  const fields = [];
  for (const roleId of roleIds) {
    const cfg = configOf(guild.id, roleId, state);
    const role = guild.roles.cache.get(roleId);
    if (!cfg?.aktif || !role) continue;
    const chs = targets(guild, roleId, cfg);
    const lines = [];
    if (cfg.note) lines.push(cfg.note);
    if (chs.length) lines.push(`Sekarang kamu bisa ke: ${chs.slice(0, 15).map((c) => `<#${c.id}>`).join(' ')}`);
    if (lines.length) fields.push({ name: role.name.slice(0, 256), value: lines.join('\n').slice(0, 1024) });
  }
  if (!fields.length) return null;
  return new EmbedBuilder().setColor(panels.asColor(store.loadContent().meta.warna)).setTitle('AKSES BARU')
    .setDescription('Ini yang terbuka buat kamu:').addFields(fields);
}

// Role yang baru saja diambil lewat tombol: arahannya sudah ikut di balasan tombol, jangan dikirim dua kali lewat DM.
const recent = new Map();
const suppress = (guildId, userId, roleId) => recent.set(`${guildId}:${userId}:${roleId}`, Date.now());
const suppressed = (guildId, userId, roleId) => Date.now() - (recent.get(`${guildId}:${userId}:${roleId}`) ?? 0) < 30000;

// Role ditambahkan oleh staff: arahan dikirim lewat DM. Kalau DM tertutup, dicatat di channel log (kalau log menyala).
async function onRolesAdded(member, addedIds) {
  const { guild } = member;
  const ids = addedIds.filter((id) => !suppressed(guild.id, member.id, id));
  const embed = directionEmbed(guild, ids);
  if (!embed) return;
  try {
    await member.send({ embeds: [embed] });
  } catch {
    const settings = store.loadSettings();
    const channel = settings.logs.aktif ? panels.moduleChannel(guild, 'logs') : null;
    await channel?.send({ content: `Arahan role tidak terkirim ke <@${member.id}> (DM tertutup).`, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

module.exports = {
  opensFor, groupText, rolesFor, configOf, setConfig, removeConfig, targets, directionEmbed, suppress, onRolesAdded,
};
