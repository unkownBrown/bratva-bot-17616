// Sambutan member baru (di channel dan / atau DM), pesan perpisahan, dan role otomatis (hanya role yang aman dibagi).
const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const store = require('../store');
const panels = require('../panels');
const safety = require('../safety');

const cfg = () => store.loadSettings().sambutan;
const accent = () => panels.asColor(store.loadContent().meta.warna);

// {user} mention, {nama} nama, {server} nama server, {jumlah} jumlah member
function expand(text, member) {
  const guild = member.guild;
  const nama = member.displayName ?? member.user?.username ?? 'Seseorang';
  return String(text).replaceAll('{user}', `<@${member.id}>`).replaceAll('{nama}', nama)
    .replaceAll('{server}', guild.name).replaceAll('{jumlah}', String(guild.memberCount));
}

async function onAdd(member) {
  const c = cfg();
  if (!c.aktif || member.user?.bot) return;
  const { guild } = member;

  const roles = c.roleOtomatis.filter((id) => safety.isSafeRole(guild, guild.roles.cache.get(id)));
  if (roles.length) await member.roles.add(roles, 'Role otomatis untuk member baru').catch((err) => console.error(`[sambutan] role otomatis: ${err.message}`));

  const ch = panels.moduleChannel(guild, 'sambutan');
  if (ch?.send) {
    await ch.send({
      embeds: [new EmbedBuilder().setColor(accent()).setDescription(expand(c.pesan, member).slice(0, 4000))
        .setThumbnail(member.displayAvatarURL({ size: 128 })).setTimestamp()],
      allowedMentions: { parse: [] },
    }).catch((err) => console.error(`[sambutan] gagal kirim: ${err.message}`));
  }
  if (c.dm) {
    await member.send({ embeds: [new EmbedBuilder().setColor(accent()).setDescription(expand(c.pesanDm, member).slice(0, 4000)).setFooter({ text: guild.name })] }).catch(() => {});
  }
}

async function onRemove(member) {
  const c = cfg();
  if (!c.aktif || !c.keluar || member.user?.bot) return;
  const ch = panels.moduleChannel(member.guild, 'sambutan');
  if (!ch?.send) return;
  await ch.send({
    embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription(expand(c.pesanKeluar, member).slice(0, 4000)).setTimestamp()],
    allowedMentions: { parse: [] },
  }).catch((err) => console.error(`[sambutan] gagal kirim: ${err.message}`));
}

// ---------- pengaturan dari /panel → Fitur lainnya ----------

// Label kotak isian dibatasi Discord maksimal 45 huruf.
const field = (id, label, style, value, max, placeholder) => {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(true).setMaxLength(max);
  if (value) input.setValue(String(value).slice(0, max));
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  return new ActionRowBuilder().addComponents(input);
};

function settingsModal() {
  const c = cfg();
  return new ModalBuilder().setCustomId('set:welcomesubmit').setTitle('Atur sambutan').addComponents(
    field('pesan', 'Pesan sambutan di channel', TextInputStyle.Paragraph, c.pesan, 1000, 'Boleh pakai {user} {nama} {server} {jumlah}'),
    field('keluar', 'Pesan saat member keluar', TextInputStyle.Short, c.pesanKeluar, 300, 'Boleh pakai {nama} {server} {jumlah}'),
    field('dm', 'Pesan sambutan lewat DM', TextInputStyle.Paragraph, c.pesanDm, 1000, 'Boleh pakai {nama} {server} {jumlah}'),
  );
}

function saveSettings(i) {
  const settings = store.loadSettings();
  settings.sambutan.pesan = i.fields.getTextInputValue('pesan').trim();
  settings.sambutan.pesanKeluar = i.fields.getTextInputValue('keluar').trim();
  settings.sambutan.pesanDm = i.fields.getTextInputValue('dm').trim();
  store.saveSettings(settings);
  return { ok: true };
}

module.exports = { onAdd, onRemove, expand, settingsModal, saveSettings };
