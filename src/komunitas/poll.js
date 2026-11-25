// /poll: pemungutan suara dengan tombol. Satu orang satu suara (boleh ganti), bisa berakhir otomatis.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const data = require('./data');
const access = require('../access');
const { parseDurasi } = require('../waktu');

const EPHEMERAL = MessageFlags.Ephemeral;
const HURUF = ['A', 'B', 'C', 'D', 'E'];
const MIN_MS = 60e3;
const MAX_MS = 14 * 86400e3;

const hitung = (p) => p.opsi.map((_, i) => Object.values(p.suara).filter((v) => v === i).length);

function bar(persen) {
  const penuh = Math.round(persen / 10);
  return `${'█'.repeat(penuh)}${'░'.repeat(10 - penuh)}`;
}

function tampilan(p) {
  const counts = hitung(p);
  const total = counts.reduce((a, b) => a + b, 0);
  const tertinggi = Math.max(...counts);
  const lines = p.opsi.map((o, i) => {
    const persen = total ? Math.round((counts[i] / total) * 100) : 0;
    const juara = p.selesai && total && counts[i] === tertinggi ? ' 🏆' : '';
    return `**${HURUF[i]}. ${o}**${juara}\n${bar(persen)} ${persen}% · ${counts[i]} suara`;
  });
  const status = p.selesai ? 'Poll selesai.' : p.berakhir ? `Berakhir <t:${Math.floor(p.berakhir / 1000)}:R>.` : 'Poll terbuka sampai ditutup.';
  const embed = new EmbedBuilder().setColor(p.selesai ? 0x95a5a6 : 0x3498db).setTitle(`📊 ${p.tanya}`.slice(0, 256))
    .setDescription(`${lines.join('\n\n')}\n\n${status}`)
    .setFooter({ text: `${total} suara · dibuat oleh ${p.byName}` });
  const tombol = p.opsi.map((_, i) => new ButtonBuilder().setCustomId(`kp:v:${i}`).setLabel(`${HURUF[i]} (${counts[i]})`)
    .setStyle(ButtonStyle.Primary).setDisabled(Boolean(p.selesai)));
  const rows = [new ActionRowBuilder().addComponents(...tombol)];
  if (!p.selesai) rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('kp:x').setLabel('Tutup poll').setStyle(ButtonStyle.Danger)));
  return { embeds: [embed], components: rows };
}

async function buat(i) {
  const opsi = ['opsi1', 'opsi2', 'opsi3', 'opsi4', 'opsi5'].map((k) => i.options.getString(k)?.trim()).filter(Boolean);
  if (opsi.length < 2) return i.reply({ content: 'Isi minimal dua pilihan.', flags: EPHEMERAL });
  let berakhir = null;
  const durasi = i.options.getString('durasi');
  if (durasi) {
    const ms = parseDurasi(durasi);
    if (!ms || ms < MIN_MS || ms > MAX_MS) return i.reply({ content: 'Durasi poll 1 menit sampai 14 hari. Contoh: `30m`, `2j`, `1d`.', flags: EPHEMERAL });
    berakhir = Date.now() + ms;
  }
  const d = data.data();
  const aktif = Object.values(d.polls).filter((p) => !p.selesai && p.guildId === i.guildId);
  if (aktif.length >= 20) return i.reply({ content: 'Sudah ada 20 poll yang masih terbuka di server ini. Tutup beberapa dulu.', flags: EPHEMERAL });
  if (aktif.filter((p) => p.by === i.user.id).length >= 3) return i.reply({ content: 'Kamu sudah punya 3 poll yang masih terbuka. Tutup salah satu dulu.', flags: EPHEMERAL });

  const p = {
    guildId: i.guildId, channelId: i.channelId, by: i.user.id, byName: i.user.username, tanya: i.options.getString('pertanyaan', true).trim(),
    opsi, suara: {}, berakhir, selesai: null,
  };
  await i.reply({ ...tampilan(p), allowedMentions: { parse: [] } });
  const msg = await i.fetchReply();
  p.id = msg.id;
  d.polls[msg.id] = p;
  data.save();
}

async function tombol(i) {
  const [, aksi, idx] = i.customId.split(':');
  const p = data.data().polls[i.message.id];
  if (!p) return i.reply({ content: 'Poll ini sudah tidak tercatat di bot.', flags: EPHEMERAL });
  if (aksi === 'x') {
    const boleh = i.user.id === p.by || access.isManager(i) || i.memberPermissions?.has?.(PermissionFlagsBits.ManageMessages);
    if (!boleh) return i.reply({ content: 'Hanya pembuat poll atau pengelola yang bisa menutupnya.', flags: EPHEMERAL });
    p.selesai = Date.now();
    data.save();
    return i.update(tampilan(p));
  }
  if (p.selesai) return i.reply({ content: 'Poll ini sudah ditutup.', flags: EPHEMERAL });
  const n = Number(idx);
  if (!(n >= 0 && n < p.opsi.length)) return null;
  if (p.suara[i.user.id] === n) delete p.suara[i.user.id];
  else p.suara[i.user.id] = n;
  data.save();
  return i.update(tampilan(p));
}

// Dipanggil penyapu: tutup poll yang waktunya habis dan perbarui pesannya.
async function selesaikan(client, p) {
  p.selesai = Date.now();
  data.save();
  const ch = client.channels.cache.get(p.channelId) ?? await client.channels.fetch(p.channelId).catch(() => null);
  const msg = await ch?.messages?.fetch(p.id).catch(() => null);
  await msg?.edit(tampilan(p)).catch(() => {});
}

module.exports = { buat, tombol, selesaikan, tampilan, hitung };
