// /ingatkan: pengingat pribadi. Dikirim di channel tempat dibuat (atau lewat DM) saat waktunya tiba.
const { MessageFlags } = require('discord.js');
const data = require('./data');
const { parseDurasi, formatDurasi } = require('../waktu');

const EPHEMERAL = MessageFlags.Ephemeral;
const MAKS_PER_USER = 25;
const MAKS_MS = 365 * 86400e3;

async function buat(i) {
  const ms = parseDurasi(i.options.getString('waktu', true));
  if (!ms || ms < 10e3 || ms > MAKS_MS) return i.reply({ content: 'Waktunya tidak dimengerti. Contoh: `30m` (30 menit), `2j` (2 jam), `1d` (1 hari), `1j30m`. Minimal 10 detik, maksimal 365 hari.', flags: EPHEMERAL });
  const d = data.data();
  if (d.pengingat.filter((p) => p.userId === i.user.id).length >= MAKS_PER_USER) {
    return i.reply({ content: `Kamu sudah punya ${MAKS_PER_USER} pengingat. Hapus beberapa dengan \`/ingatkan batal\`.`, flags: EPHEMERAL });
  }
  const p = {
    id: d.nextPengingat++, userId: i.user.id, guildId: i.guildId, channelId: i.channelId,
    teks: i.options.getString('pesan', true).trim().slice(0, 500), at: Date.now() + ms, dm: Boolean(i.options.getBoolean('dm')),
  };
  d.pengingat.push(p);
  data.save();
  return i.reply({ content: `⏰ Oke, aku ingatkan ${p.dm ? 'lewat DM ' : ''}dalam ${formatDurasi(ms)} (<t:${Math.floor(p.at / 1000)}:f>): ${p.teks}\nNomor pengingat: **${p.id}**`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

function daftar(i) {
  const milik = data.data().pengingat.filter((p) => p.userId === i.user.id).sort((a, b) => a.at - b.at);
  const teks = milik.length
    ? milik.map((p) => `**#${p.id}** · <t:${Math.floor(p.at / 1000)}:R>${p.dm ? ' · DM' : ''}\n${p.teks}`).join('\n\n')
    : 'Kamu belum punya pengingat. Buat dengan `/ingatkan buat`.';
  return i.reply({ content: teks.slice(0, 1900), flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

function batal(i) {
  const id = i.options.getInteger('nomor', true);
  const d = data.data();
  const idx = d.pengingat.findIndex((p) => p.id === id && p.userId === i.user.id);
  if (idx < 0) return i.reply({ content: 'Pengingat itu tidak ada (atau bukan milikmu).', flags: EPHEMERAL });
  d.pengingat.splice(idx, 1);
  data.save();
  return i.reply({ content: `Pengingat #${id} dibatalkan.`, flags: EPHEMERAL });
}

// Dipanggil penyapu: kirim semua pengingat yang sudah waktunya.
async function kirimJatuhTempo(client, now = Date.now()) {
  const d = data.data();
  const due = d.pengingat.filter((p) => p.at <= now);
  if (!due.length) return 0;
  d.pengingat = d.pengingat.filter((p) => p.at > now);
  data.save();
  for (const p of due) {
    const isi = `⏰ **Pengingat:** ${p.teks}`;
    let sent = false;
    if (!p.dm) {
      const ch = client.channels.cache.get(p.channelId) ?? await client.channels.fetch(p.channelId).catch(() => null);
      sent = Boolean(await ch?.send?.({ content: `<@${p.userId}> ${isi}`, allowedMentions: { users: [p.userId] } }).catch(() => null));
    }
    if (!sent) await client.users.fetch(p.userId).then((u) => u.send(isi)).catch(() => {});
  }
  return due.length;
}

module.exports = { buat, daftar, batal, kirimJatuhTempo };
