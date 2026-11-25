// Tampilan moderasi: pesan DM ke member, baris log di channel moderasi, dan riwayat.
const { EmbedBuilder } = require('discord.js');
const runtime = require('../runtime');
const { formatDurasi } = require('../waktu');

const { ts, wib } = runtime;

const JENIS = {
  warn: { nama: 'Peringatan', warna: 0xf1c40f, dm: 'Peringatan dari {server}' },
  timeout: { nama: 'Timeout', warna: 0xe67e22, dm: 'Kamu di-timeout di {server}' },
  untimeout: { nama: 'Timeout dicabut', warna: 0x2ecc71, dm: null },
  kick: { nama: 'Kick', warna: 0xe74c3c, dm: 'Kamu dikeluarkan dari {server}' },
  ban: { nama: 'Ban', warna: 0x992d22, dm: 'Kamu diblokir dari {server}' },
  unban: { nama: 'Unban', warna: 0x2ecc71, dm: null },
  dm: { nama: 'Pesan DM', warna: 0x3498db, dm: 'Pesan dari pengurus {server}' },
  catatan: { nama: 'Catatan', warna: 0x95a5a6, dm: null },
  auto: { nama: 'Auto-moderasi', warna: 0xe67e22, dm: 'Pesanmu dihapus di {server}' },
};
const nama = (type) => JENIS[type]?.nama ?? type;

const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const tagOf = (u) => u?.tag ?? u?.username ?? 'tidak dikenal';

// Pesan yang dibaca member lewat DM.
//   kasus: data kasus, guild: server, ke: peringatan ke-berapa (hanya warn), selanjutnya: aturan eskalasi berikutnya (opsional),
//   moderator: tampilkan siapa yang memberi (null = disembunyikan)
function dmEmbed(c, { guild, ke, selanjutnya, moderator }) {
  const jenis = JENIS[c.type] ?? JENIS.warn;
  const embed = new EmbedBuilder().setColor(jenis.warna).setTitle(clip((jenis.dm ?? '{server}').replace('{server}', guild.name), 256))
    .setDescription(clip(c.reason || 'Tidak ada alasan yang dicantumkan.', 4000))
    .setFooter({ text: c.type === 'dm' ? guild.name : `${guild.name} · Kasus #${c.id}`, iconURL: guild.iconURL?.() ?? undefined })
    .setTimestamp(c.at);
  const icon = guild.iconURL?.();
  if (icon) embed.setThumbnail(icon);
  if (c.type === 'warn' && ke) embed.addFields({ name: 'Peringatan aktif', value: `${ke}`, inline: true });
  if (c.type === 'timeout' && c.durasi) {
    embed.addFields({ name: 'Lama', value: formatDurasi(c.durasi), inline: true }, { name: 'Berakhir', value: ts(c.until, 'R'), inline: true });
  }
  if (c.bukti) embed.addFields({ name: 'Bukti', value: clip(c.bukti, 300) });
  if (moderator) embed.addFields({ name: 'Dari', value: moderator, inline: true });
  if (selanjutnya) {
    const aksi = { timeout: `di-timeout ${formatDurasi((selanjutnya.menit ?? 60) * 60e3)}`, kick: 'dikeluarkan dari server', ban: 'diblokir dari server' }[selanjutnya.aksi];
    embed.addFields({ name: 'Perhatian', value: `Di peringatan ke-${selanjutnya.jumlah} kamu akan ${aksi}.` });
  }
  if (['warn', 'timeout', 'kick', 'ban', 'auto'].includes(c.type)) {
    embed.addFields({ name: '​', value: 'Kalau menurutmu ini keliru, hubungi pengurus server.' });
  }
  return embed;
}

const DM_TEKS = { terkirim: 'DM terkirim', gagal: 'DM gagal (DM dia tertutup)', tidak: 'DM tidak dikirim' };

// Baris log di channel moderasi.
function logEmbed(c) {
  const embed = new EmbedBuilder().setColor(JENIS[c.type]?.warna ?? 0x95a5a6).setTitle(`Kasus #${c.id} · ${nama(c.type)}`)
    .addFields(
      { name: 'Member', value: `<@${c.userId}> (${c.userTag ?? c.userId})`, inline: true },
      { name: 'Oleh', value: c.auto ? `Otomatis (${c.auto})` : `<@${c.modId}>`, inline: true },
    )
    .setFooter({ text: `ID ${c.userId}` }).setTimestamp(c.at);
  if (c.reason) embed.addFields({ name: c.type === 'dm' ? 'Pesan' : 'Alasan', value: clip(c.reason, 1000) });
  if (c.durasi) embed.addFields({ name: 'Lama', value: `${formatDurasi(c.durasi)} (sampai ${ts(c.until, 'f')})`, inline: true });
  if (c.bukti) embed.addFields({ name: 'Bukti', value: clip(c.bukti, 300), inline: true });
  if (c.dm) embed.addFields({ name: 'DM', value: DM_TEKS[c.dm] ?? c.dm, inline: true });
  if (c.eskalasi) embed.addFields({ name: 'Eskalasi', value: clip(c.eskalasi, 300) });
  return embed;
}

function baris(c) {
  const alasan = c.reason ? clip(c.reason.replace(/\s+/g, ' '), 70) : '-';
  const text = `**#${c.id}** · ${nama(c.type)} · ${ts(c.at, 'd')}${c.auto ? ` · otomatis` : ''}\n${alasan}`;
  return c.removed ? `~~${text.replace(/\n/g, ' ')}~~ _(dihapus)_` : text;
}

// Riwayat satu member: peringatan aktif + 10 kasus terakhir.
function riwayatEmbed(guild, user, kasus, aktif) {
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`Riwayat ${tagOf(user)}`)
    .setThumbnail(user.displayAvatarURL?.() ?? null).setFooter({ text: `ID ${user.id}` });
  if (!kasus.length) return embed.setDescription(`${user}\nBelum ada catatan moderasi. 🎉`);
  const count = (t) => kasus.filter((c) => c.type === t && !c.removed).length;
  embed.setDescription([
    `${user}`,
    `**${aktif}** peringatan aktif · ${count('warn')} peringatan · ${count('timeout')} timeout · ${count('kick')} kick · ${count('ban')} ban`,
    '',
    kasus.slice(0, 10).map(baris).join('\n'),
  ].join('\n').slice(0, 4000));
  if (kasus.length > 10) embed.setFooter({ text: `ID ${user.id} · menampilkan 10 dari ${kasus.length} kasus` });
  return embed;
}

function kasusEmbed(c) {
  const embed = logEmbed(c);
  embed.addFields({ name: 'Waktu', value: wib(c.at), inline: true });
  if (c.removed) {
    embed.addFields({ name: 'Dihapus', value: `oleh <@${c.removed.by}> · ${ts(c.removed.at, 'f')}${c.removed.why ? `\n${clip(c.removed.why, 300)}` : ''}` });
  }
  return embed;
}

// Daftar kasus terbaru (tombol "Kasus moderasi" di panel).
function daftarEmbed(guild, kasus, ringkas) {
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('Kasus moderasi');
  const types = Object.entries(ringkas.byType).map(([t, n]) => `${n} ${nama(t).toLowerCase()}`).join(' · ');
  const head = ringkas.total ? `7 hari terakhir: **${ringkas.total}** kasus${types ? ` (${types})` : ''}` : 'Belum ada kasus dalam 7 hari terakhir.';
  const lines = kasus.map((c) => `**#${c.id}** · ${nama(c.type)} · <@${c.userId}> · ${ts(c.at, 'R')}`);
  return embed.setDescription([head, '', ...lines].join('\n').slice(0, 4000)).setFooter({ text: 'Detail: /mod kasus nomor · /mod riwayat member' });
}

module.exports = { JENIS, nama, dmEmbed, logEmbed, riwayatEmbed, kasusEmbed, daftarEmbed, tagOf, DM_TEKS, clip };
