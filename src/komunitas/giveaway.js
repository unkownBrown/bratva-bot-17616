// /giveaway: undian dengan tombol "Ikut". Pemenang dipilih acak (crypto) dari yang masih ada di server dan memenuhi syarat role.
const crypto = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const data = require('./data');
const runtime = require('../runtime');
const { parseDurasi } = require('../waktu');

const EPHEMERAL = MessageFlags.Ephemeral;
const MIN_MS = 60e3;
const MAX_MS = 30 * 86400e3;

function acak(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function tampilan(g) {
  const embed = new EmbedBuilder().setColor(g.selesai ? 0x95a5a6 : 0xf1c40f).setTitle(`🎉 ${g.hadiah}`.slice(0, 256));
  const baris = [];
  if (g.selesai) {
    baris.push(g.menang.length ? `**Pemenang:** ${g.menang.map((id) => `<@${id}>`).join(', ')}` : '**Tidak ada pemenang** (tidak ada peserta yang memenuhi syarat).');
  } else {
    baris.push(`Tekan tombol **Ikut** di bawah. Berakhir <t:${Math.floor(g.berakhir / 1000)}:R>.`, `Jumlah pemenang: **${g.pemenang}**`);
  }
  if (g.role) baris.push(`Syarat: punya role <@&${g.role}>`);
  baris.push(`Diadakan oleh <@${g.by}>`);
  embed.setDescription(baris.join('\n')).setFooter({ text: `${g.peserta.length} peserta` });
  const tombol = new ButtonBuilder().setCustomId('kg:j').setLabel(g.selesai ? 'Selesai' : `Ikut (${g.peserta.length})`).setStyle(ButtonStyle.Success)
    .setDisabled(Boolean(g.selesai));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(tombol)], allowedMentions: { parse: [] } };
}

async function mulai(i) {
  const ms = parseDurasi(i.options.getString('durasi', true));
  if (!ms || ms < MIN_MS || ms > MAX_MS) return i.reply({ content: 'Durasi 1 menit sampai 30 hari. Contoh: `30m`, `2j`, `1d`.', flags: EPHEMERAL });
  const d = data.data();
  if (Object.values(d.giveaways).filter((g) => !g.selesai && g.guildId === i.guildId).length >= 10) {
    return i.reply({ content: 'Sudah ada 10 giveaway yang masih berjalan di server ini.', flags: EPHEMERAL });
  }
  const g = {
    guildId: i.guildId, channelId: i.channelId, by: i.user.id, hadiah: i.options.getString('hadiah', true).trim(),
    berakhir: Date.now() + ms, pemenang: i.options.getInteger('pemenang') ?? 1, role: i.options.getRole('role')?.id ?? null,
    peserta: [], menang: [], selesai: null,
  };
  await i.reply(tampilan(g));
  const msg = await i.fetchReply();
  g.id = msg.id;
  d.giveaways[msg.id] = g;
  data.save();
}

async function ikut(i) {
  const g = data.data().giveaways[i.message.id];
  if (!g) return i.reply({ content: 'Giveaway ini sudah tidak tercatat di bot.', flags: EPHEMERAL });
  if (g.selesai) return i.reply({ content: 'Giveaway ini sudah selesai.', flags: EPHEMERAL });
  if (g.role && !i.member?.roles?.cache?.has(g.role)) return i.reply({ content: `Kamu butuh role <@&${g.role}> untuk ikut.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
  const sudah = g.peserta.includes(i.user.id);
  g.peserta = sudah ? g.peserta.filter((x) => x !== i.user.id) : [...g.peserta, i.user.id];
  data.save();
  await i.reply({ content: sudah ? 'Kamu keluar dari giveaway.' : 'Kamu sudah ikut. Semoga beruntung! 🍀', flags: EPHEMERAL });
  // Pesan diperbarui tertunda supaya giveaway ramai tidak kena rate limit.
  runtime.debounce(`gw:${g.id}`, 2500, () => i.message.edit(tampilan(g)));
  return null;
}

async function pilih(guild, g, jumlah, kecuali = []) {
  const layak = [];
  for (const id of g.peserta) {
    if (kecuali.includes(id)) continue;
    const m = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
    if (!m || m.user.bot) continue;
    if (g.role && !m.roles.cache.has(g.role)) continue;
    layak.push(id);
  }
  return acak(layak, jumlah);
}

async function umumkan(client, g, { ulang = false } = {}) {
  const ch = client.channels.cache.get(g.channelId) ?? await client.channels.fetch(g.channelId).catch(() => null);
  if (!ch) return;
  const msg = await ch.messages?.fetch(g.id).catch(() => null);
  await msg?.edit(tampilan(g)).catch(() => {});
  const teks = g.menang.length
    ? `🎉 ${ulang ? 'Pemenang baru' : 'Selamat'} ${g.menang.map((id) => `<@${id}>`).join(', ')}! Kamu memenangkan **${g.hadiah}**.`
    : `Giveaway **${g.hadiah}** selesai, tapi tidak ada peserta yang memenuhi syarat.`;
  await ch.send({ content: teks, allowedMentions: { users: g.menang }, reply: msg ? { messageReference: msg.id, failIfNotExists: false } : undefined }).catch(() => {});
  for (const id of g.menang) {
    client.users.fetch(id).then((u) => u.send(`🎉 Selamat! Kamu menang **${g.hadiah}** di **${ch.guild?.name ?? 'server'}**. Hubungi pengurus untuk hadiahmu.`)).catch(() => {});
  }
}

async function selesaikan(client, g) {
  const guild = client.guilds.cache.get(g.guildId);
  g.selesai = Date.now();
  g.menang = guild ? await pilih(guild, g, g.pemenang) : [];
  data.save();
  await umumkan(client, g);
}

function cari(i) {
  const id = i.options.getString('id')?.trim();
  const semua = Object.values(data.data().giveaways).filter((g) => g.guildId === i.guildId);
  if (id) return semua.find((g) => g.id === id) ?? null;
  return semua.filter((g) => !g.selesai && g.channelId === i.channelId).sort((a, b) => b.berakhir - a.berakhir)[0] ?? null;
}

async function akhiri(i) {
  const g = cari(i);
  if (!g) return i.reply({ content: 'Tidak ada giveaway yang masih berjalan di channel ini. Isi `id` (ID pesan giveaway) kalau di channel lain.', flags: EPHEMERAL });
  if (g.selesai) return i.reply({ content: 'Giveaway itu sudah selesai. Pakai `/giveaway ulang` untuk memilih pemenang baru.', flags: EPHEMERAL });
  await i.deferReply({ flags: EPHEMERAL });
  await selesaikan(i.client, g);
  return i.editReply('Giveaway diakhiri dan pemenang diumumkan.');
}

async function ulang(i) {
  const g = cari(i);
  if (!g?.selesai) return i.reply({ content: 'Giveaway yang sudah selesai tidak ketemu. Isi `id` (ID pesan giveaway).', flags: EPHEMERAL });
  await i.deferReply({ flags: EPHEMERAL });
  // Utamakan orang yang belum menang; kalau kurang, lengkapi dari pemenang lama supaya jumlahnya tetap sama.
  let baru = await pilih(i.guild, g, g.pemenang, g.menang);
  if (baru.length < g.pemenang) {
    const lama = await pilih(i.guild, g, g.pemenang, baru);
    baru = [...baru, ...lama].slice(0, g.pemenang);
  }
  g.menang = baru;
  data.save();
  await umumkan(i.client, g, { ulang: true });
  return i.editReply('Pemenang baru sudah dipilih dan diumumkan.');
}

function daftar(i) {
  const aktif = Object.values(data.data().giveaways).filter((g) => g.guildId === i.guildId && !g.selesai);
  const teks = aktif.length
    ? aktif.map((g) => `**${g.hadiah}** · <#${g.channelId}> · berakhir <t:${Math.floor(g.berakhir / 1000)}:R> · ${g.peserta.length} peserta\nID: \`${g.id}\``).join('\n\n')
    : 'Tidak ada giveaway yang sedang berjalan.';
  return i.reply({ content: teks.slice(0, 1900), flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

module.exports = { mulai, ikut, akhiri, ulang, daftar, selesaikan, tampilan, acak };
