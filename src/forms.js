const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
} = require('discord.js');
const store = require('./store');
const runtime = require('./runtime');

const MAX_FIELDS = 5;
const DEFAULT_FIELDS = [{ label: 'Nama IC', long: false }, { label: 'Alasan', long: true }];
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const configOf = (guildId, key, state = store.loadState()) => state.forms[guildId]?.[key] ?? null;

function setConfig(guildId, key, patch) {
  const state = store.loadState();
  const all = (state.forms[guildId] ??= {});
  all[key] = { label: 'Ajukan', fields: DEFAULT_FIELDS, reviewChannelId: null, roleId: null, ...all[key], ...patch };
  store.saveState(state);
  return all[key];
}

function removeConfig(guildId, key) {
  const state = store.loadState();
  if (state.forms[guildId]) delete state.forms[guildId][key];
  store.saveState(state);
}

// Satu baris = satu isian. Awali dengan ">" kalau jawabannya panjang. Maksimal 5 isian.
function parseFields(text) {
  return String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX_FIELDS)
    .map((line) => (line.startsWith('>') ? { label: line.slice(1).trim().slice(0, 45), long: true } : { label: line.slice(0, 45), long: false }))
    .filter((f) => f.label);
}
const fieldsText = (fields) => fields.map((f) => `${f.long ? '> ' : ''}${f.label}`).join('\n');

// Tombol formulir yang ditempel di bawah pesan panel. Muncul kalau channel peninjau sudah dipilih.
function rows(guild, key, state) {
  const cfg = configOf(guild.id, key, state);
  if (!cfg?.reviewChannelId || !cfg.fields?.length || !guild.channels.cache.has(cfg.reviewChannelId)) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fm:open:${key}`).setLabel(String(cfg.label || 'Ajukan').slice(0, 80)).setStyle(ButtonStyle.Primary),
  )];
}

function signature(guild, key, state) {
  const cfg = configOf(guild.id, key, state);
  return cfg ? JSON.stringify([cfg.label, cfg.fields, Boolean(cfg.reviewChannelId)]) : '';
}

function openModal(key, cfg) {
  const modal = new ModalBuilder().setCustomId(`fm:submit:${key}`).setTitle(String(cfg.label || 'Ajukan').slice(0, 45));
  cfg.fields.slice(0, MAX_FIELDS).forEach((f, i) => {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`f${i}`).setLabel(f.label.slice(0, 45)).setRequired(true).setMaxLength(1000)
        .setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short),
    ));
  });
  return modal;
}

// Kartu pengajuan yang masuk ke channel peninjau.
function reviewEmbed(key, user, cfg, answers, accent) {
  const embed = new EmbedBuilder().setColor(accent).setTitle(`PENGAJUAN · ${key}`)
    .setAuthor({ name: user.tag ?? user.username, iconURL: user.displayAvatarURL?.() ?? undefined })
    .setDescription(`${user}`).setFooter({ text: `ID ${user.id}` });
  cfg.fields.slice(0, MAX_FIELDS).forEach((f, i) => embed.addFields({ name: f.label, value: clip(answers[i] || '-', 1000) }));
  embed.addFields({ name: 'Waktu', value: runtime.wib(), inline: true }, { name: 'Status', value: 'Menunggu', inline: true });
  return embed;
}

function reviewButtons(key, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fm:ok:${key}:${userId}`).setLabel('Terima').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`fm:no:${key}:${userId}`).setLabel('Tolak').setStyle(ButtonStyle.Danger),
  );
}

// Ganti status di kartu yang sudah ada (Menunggu -> Diterima / Ditolak) dan matikan tombolnya.
function decided(sourceEmbed, { status, by, reason, color }) {
  const embed = EmbedBuilder.from(sourceEmbed).setColor(color);
  const fields = (embed.data.fields ?? []).filter((f) => f.name !== 'Status');
  fields.push({ name: 'Status', value: status, inline: true }, { name: 'Diputuskan', value: `<@${by}> · ${runtime.wib()}`, inline: true });
  if (reason) fields.push({ name: 'Alasan', value: clip(reason, 1000) });
  return embed.setFields(fields);
}

module.exports = {
  MAX_FIELDS, DEFAULT_FIELDS, configOf, setConfig, removeConfig, parseFields, fieldsText, rows, signature,
  openModal, reviewEmbed, reviewButtons, decided,
};
