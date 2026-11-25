// /info: info member, server, avatar, dan bot. Boleh dipakai semua member.
const { EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const panels = require('../panels');
const store = require('../store');
const pkg = require('../../package.json');
const { formatDurasi } = require('../waktu');

const EPHEMERAL = MessageFlags.Ephemeral;
const accent = () => panels.asColor(store.loadContent().meta.warna);
const ts = (ms, style = 'D') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const NO_PING = { parse: [] };

async function user(i) {
  const u = i.options.getUser('member') ?? i.user;
  const member = await i.guild.members.fetch(u.id).catch(() => null);
  const embed = new EmbedBuilder().setColor(member?.displayColor || accent()).setTitle(u.tag ?? u.username)
    .setThumbnail((member ?? u).displayAvatarURL({ size: 256 })).setFooter({ text: `ID ${u.id}` })
    .addFields({ name: 'Akun dibuat', value: ts(u.createdTimestamp), inline: true });
  if (member) {
    const roles = [...member.roles.cache.values()].filter((r) => r.id !== i.guild.id).sort((a, b) => b.position - a.position);
    embed.addFields(
      { name: 'Bergabung', value: member.joinedTimestamp ? ts(member.joinedTimestamp) : '-', inline: true },
      { name: 'Nama di server', value: member.displayName ?? '-', inline: true },
      { name: `Role (${roles.length})`, value: roles.slice(0, 15).map((r) => `<@&${r.id}>`).join(' ').slice(0, 1000) || '-' },
    );
    if (member.premiumSinceTimestamp) embed.addFields({ name: 'Boost sejak', value: ts(member.premiumSinceTimestamp), inline: true });
    if (member.communicationDisabledUntilTimestamp > Date.now()) embed.addFields({ name: 'Timeout sampai', value: ts(member.communicationDisabledUntilTimestamp, 'R'), inline: true });
  } else {
    embed.setDescription('Dia tidak ada di server ini.');
  }
  return i.reply({ embeds: [embed], allowedMentions: NO_PING });
}

function server(i) {
  const g = i.guild;
  const ch = [...g.channels.cache.values()];
  const teks = ch.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).length;
  const suara = ch.filter((c) => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type)).length;
  const embed = new EmbedBuilder().setColor(accent()).setTitle(g.name).setThumbnail(g.iconURL({ size: 256 }) ?? null)
    .addFields(
      { name: 'Pemilik', value: `<@${g.ownerId}>`, inline: true },
      { name: 'Dibuat', value: ts(g.createdTimestamp), inline: true },
      { name: 'Member', value: `${g.memberCount}`, inline: true },
      { name: 'Channel', value: `${teks} teks · ${suara} voice`, inline: true },
      { name: 'Role', value: `${g.roles.cache.size - 1}`, inline: true },
      { name: 'Boost', value: `Level ${g.premiumTier ?? 0} · ${g.premiumSubscriptionCount ?? 0} boost`, inline: true },
    ).setFooter({ text: `ID ${g.id}` });
  if (g.bannerURL?.()) embed.setImage(g.bannerURL({ size: 1024 }));
  return i.reply({ embeds: [embed], allowedMentions: NO_PING });
}

async function avatar(i) {
  const u = i.options.getUser('member') ?? i.user;
  const member = await i.guild.members.fetch(u.id).catch(() => null);
  const global = u.displayAvatarURL({ size: 1024 });
  const local = member?.displayAvatarURL({ size: 1024 });
  const embed = new EmbedBuilder().setColor(accent()).setTitle(`Avatar ${u.displayName ?? u.username}`).setImage(local ?? global);
  if (local && local !== global) embed.setDescription(`[Avatar akun](${global}) · [Avatar di server ini](${local})`);
  return i.reply({ embeds: [embed], allowedMentions: NO_PING });
}

function bot(i) {
  const c = i.client;
  const mb = (process.memoryUsage().rss / 1048576).toFixed(0);
  const embed = new EmbedBuilder().setColor(accent()).setTitle(`${c.user.username} v${pkg.version}`)
    .addFields(
      { name: 'Nyala sejak', value: formatDurasi(process.uptime() * 1000), inline: true },
      { name: 'Ping', value: c.ws?.ping >= 0 ? `${Math.round(c.ws.ping)} ms` : '-', inline: true },
      { name: 'Server', value: `${c.guilds.cache.size}`, inline: true },
      { name: 'Memori', value: `${mb} MB`, inline: true },
      { name: 'Node.js', value: process.version, inline: true },
    );
  return i.reply({ embeds: [embed], flags: EPHEMERAL });
}

module.exports = { user, server, avatar, bot };
