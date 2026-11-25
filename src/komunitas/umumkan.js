// /umumkan: kirim pengumuman rapi (embed) ke channel pilihan lewat kotak isian. Khusus pengelola.
const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const panels = require('../panels');
const store = require('../store');
const access = require('../access');

const EPHEMERAL = MessageFlags.Ephemeral;
const input = (id, label, style, { required = false, max, placeholder } = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required);
  if (max) t.setMaxLength(max);
  if (placeholder) t.setPlaceholder(placeholder.slice(0, 100));
  return new ActionRowBuilder().addComponents(t);
};

async function buka(i) {
  if (!access.isManager(i)) return i.reply({ content: 'Ini khusus yang punya izin Manage Server atau role pengelola bot.', flags: EPHEMERAL });
  const channel = i.options.getChannel('channel', true);
  const role = i.options.getRole('mention');
  return i.showModal(new ModalBuilder().setCustomId(`ku:p:${channel.id}:${role?.id ?? 0}`).setTitle('Pengumuman').addComponents(
    input('judul', 'Judul (opsional)', TextInputStyle.Short, { max: 256 }),
    input('isi', 'Isi pengumuman', TextInputStyle.Paragraph, { required: true, max: 3500, placeholder: 'Boleh pakai {server}' }),
    input('warna', 'Warna (hex, opsional)', TextInputStyle.Short, { max: 7, placeholder: '#8c1c1c' }),
    input('gambar', 'Gambar (link, opsional)', TextInputStyle.Short, { max: 400 }),
  ));
}

async function kirim(i) {
  if (!access.isManager(i)) return i.reply({ content: 'Ini khusus yang punya izin Manage Server atau role pengelola bot.', flags: EPHEMERAL });
  const [, , channelId, roleId] = i.customId.split(':');
  const channel = i.guild.channels.cache.get(channelId);
  if (!channel?.send) return i.reply({ content: 'Channel tujuan tidak ketemu.', flags: EPHEMERAL });
  const gambar = i.fields.getTextInputValue('gambar')?.trim();
  if (gambar && !panels.isUrl(gambar)) return i.reply({ content: 'Gambar harus berupa link http(s).', flags: EPHEMERAL });

  const judul = i.fields.getTextInputValue('judul')?.trim();
  const embed = new EmbedBuilder().setColor(panels.asColor(i.fields.getTextInputValue('warna') || store.loadContent().meta.warna))
    .setDescription(i.fields.getTextInputValue('isi').replaceAll('{server}', i.guild.name).slice(0, 4000)).setTimestamp();
  if (judul) embed.setTitle(judul);
  if (gambar) embed.setImage(gambar);
  const role = roleId && roleId !== '0' ? roleId : null;
  try {
    await channel.send({ content: role ? `<@&${role}>` : undefined, embeds: [embed], allowedMentions: role ? { roles: [role] } : { parse: [] } });
  } catch (err) {
    return i.reply({ content: `Gagal kirim ke <#${channelId}>: ${[50001, 50013].includes(err.code) ? 'bot belum punya izin View Channel / Send Messages / Embed Links di sana.' : err.message}`, flags: EPHEMERAL });
  }
  return i.reply({ content: `Pengumuman terkirim ke <#${channelId}>.`, flags: EPHEMERAL });
}

module.exports = { buka, kirim };
