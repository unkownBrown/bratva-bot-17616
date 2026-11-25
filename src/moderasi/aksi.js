// Tindakan moderasi: peringatan (dikirim lewat DM), timeout, kick, ban, unban, purge, slowmode, lock.
// Semua tindakan dicatat sebagai kasus dan ditulis ke channel log moderasi.
const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const store = require('../store');
const panels = require('../panels');
const kasus = require('./kasus');
const tampil = require('./tampilan');
const { formatDurasi } = require('../waktu');

const { tagOf } = tampil;
const MAX_TIMEOUT = 28 * 86400e3;
const cfg = () => store.loadSettings().moderasi;

class ModError extends Error {}

function friendly(err) {
  if (err instanceof ModError) return err.message;
  switch (err?.code) {
    case 50013: return 'Bot belum punya izin untuk itu, atau role bot lebih rendah dari target. Cek dengan /mod cek.';
    case 50001: return 'Bot tidak bisa mengakses channel itu.';
    case 10007: case 10013: return 'Member tidak ditemukan.';
    case 10026: return 'Dia tidak sedang di-ban.';
    case 50034: return 'Pesan yang lebih lama dari 14 hari tidak bisa dihapus massal.';
    default: return err?.message ?? String(err);
  }
}

const getMember = async (guild, id) => guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
const auditReason = (reason, mod) => `${reason || 'Tanpa alasan'} (oleh ${tagOf(mod)})`.slice(0, 500);

// DM ke member. Hasil: 'terkirim' | 'gagal' (DM ditutup / diblokir) | 'tidak' (bot tidak bisa di-DM).
async function kirimDm(user, embed) {
  if (user.bot) return 'tidak';
  try {
    await user.send({ embeds: [embed] });
    return 'terkirim';
  } catch {
    return 'gagal';
  }
}

async function tulisLog(guild, embed) {
  const ch = panels.moduleChannel(guild, 'moderasi');
  if (!ch) return false;
  try {
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.error(`[moderasi] gagal menulis log di ${guild.name}: ${err.message}`);
    return false;
  }
}
const catat = (guild, c) => tulisLog(guild, tampil.logEmbed(c));

// Pemeriksaan sebelum menindak: bukan diri sendiri / bot / pemilik server, role moderator lebih tinggi, dan bot sanggup melakukannya.
// modMember = null artinya yang menindak adalah bot sendiri (eskalasi / auto-moderasi).
function guardTarget(guild, { modMember, user, member, need = null }) {
  if (modMember && user.id === modMember.id) throw new ModError('Kamu tidak bisa melakukan ini ke dirimu sendiri.');
  if (user.id === guild.client.user.id) throw new ModError('Aku tidak bisa melakukan ini ke diriku sendiri.');
  if (user.id === guild.ownerId) throw new ModError('Pemilik server tidak bisa dikenai tindakan ini.');
  if (!member) return;
  if (modMember && modMember.id !== guild.ownerId && modMember.roles.highest.position <= member.roles.highest.position) {
    throw new ModError('Role dia sama atau lebih tinggi dari rolemu, jadi kamu tidak bisa menindaknya.');
  }
  if (need && member[need] === false) {
    throw new ModError('Bot tidak bisa menindak dia: role dia lebih tinggi dari role bot, atau bot belum punya izinnya. Naikkan role bot di Server Settings → Roles (cek dengan /mod cek).');
  }
}

// ---------- peringatan ----------

async function warn(guild, { mod, modMember = null, user, reason, bukti = null, diam = false, type = 'warn', auto = null }) {
  const member = await getMember(guild, user.id);
  guardTarget(guild, { modMember, user, member });
  if (!member) throw new ModError('Dia tidak ada di server ini, jadi tidak bisa diberi peringatan. Pakai /mod catatan kalau cuma mau mencatat.');
  const conf = cfg();

  const c = kasus.add(guild.id, {
    type, userId: user.id, userTag: tagOf(user), modId: mod.id, modTag: tagOf(mod), reason, bukti, auto,
  });
  const count = kasus.activeWarns(guild.id, user.id, conf.kedaluwarsaHari).length;
  const esk = conf.eskalasi;
  const selanjutnya = type === 'warn' && esk.aktif ? [...esk.aturan].sort((a, b) => a.jumlah - b.jumlah).find((r) => r.jumlah > count) : null;

  let dm = 'tidak';
  if (conf.dm && !diam) {
    dm = await kirimDm(user, tampil.dmEmbed(c, { guild, ke: count, selanjutnya, moderator: conf.tampilkanModerator && !auto ? tagOf(mod) : null }));
  }
  kasus.update(guild.id, c.id, { dm });

  let eskalasi = null;
  if (type === 'warn' && esk.aktif) {
    const rule = esk.aturan.find((r) => r.jumlah === count);
    if (rule) eskalasi = await jalankanEskalasi(guild, { user, rule, count, dari: c });
  }
  if (eskalasi) kasus.update(guild.id, c.id, { eskalasi: eskalasi.teks });
  await catat(guild, c);
  return { case: c, count, dm, eskalasi };
}

async function jalankanEskalasi(guild, { user, rule, count, dari }) {
  const bot = guild.client.user;
  const reason = `Eskalasi otomatis: ${count} peringatan (kasus #${dari.id})`;
  try {
    let res;
    if (rule.aksi === 'timeout') res = await timeout(guild, { mod: bot, user, ms: Math.min((rule.menit ?? 60) * 60e3, MAX_TIMEOUT), reason });
    else if (rule.aksi === 'kick') res = await kick(guild, { mod: bot, user, reason });
    else if (rule.aksi === 'ban') res = await ban(guild, { mod: bot, user, reason });
    else return null;
    return { ok: true, aksi: rule.aksi, case: res.case, teks: `${rule.aksi} berhasil (kasus #${res.case.id})` };
  } catch (err) {
    return { ok: false, aksi: rule.aksi, teks: `${rule.aksi} gagal: ${friendly(err)}` };
  }
}

// Pesan DM bebas dari moderator (tidak dihitung sebagai peringatan).
async function kirimPesan(guild, { mod, user, pesan, anonim = false }) {
  if (user.bot) throw new ModError('Bot tidak bisa menerima DM.');
  const c = kasus.add(guild.id, { type: 'dm', userId: user.id, userTag: tagOf(user), modId: mod.id, modTag: tagOf(mod), reason: pesan });
  const dm = await kirimDm(user, tampil.dmEmbed(c, { guild, moderator: !anonim && cfg().tampilkanModerator ? tagOf(mod) : null }));
  kasus.update(guild.id, c.id, { dm });
  await catat(guild, c);
  return { case: c, dm };
}

function catatan(guild, { mod, user, isi }) {
  const c = kasus.add(guild.id, { type: 'catatan', userId: user.id, userTag: tagOf(user), modId: mod.id, modTag: tagOf(mod), reason: isi });
  return { case: c };
}

// ---------- timeout / kick / ban ----------

async function timeout(guild, { mod, modMember = null, user, ms, reason }) {
  if (!ms || ms < 5000) throw new ModError('Durasi minimal 5 detik. Contoh: 10m, 2j, 1d.');
  if (ms > MAX_TIMEOUT) throw new ModError('Timeout maksimal 28 hari (28d).');
  const member = await getMember(guild, user.id);
  guardTarget(guild, { modMember, user, member, need: 'moderatable' });
  if (!member) throw new ModError('Dia tidak ada di server ini.');
  await member.timeout(ms, auditReason(reason, mod));

  const c = kasus.add(guild.id, {
    type: 'timeout', userId: user.id, userTag: tagOf(user), modId: mod.id, modTag: tagOf(mod), reason, durasi: ms, until: Date.now() + ms,
  });
  let dm = 'tidak';
  if (cfg().dm) dm = await kirimDm(user, tampil.dmEmbed(c, { guild, moderator: cfg().tampilkanModerator && mod.id !== guild.client.user.id ? tagOf(mod) : null }));
  kasus.update(guild.id, c.id, { dm });
  await catat(guild, c);
  return { case: c, dm };
}

async function untimeout(guild, { mod, user, reason }) {
  const member = await getMember(guild, user.id);
  if (!member) throw new ModError('Dia tidak ada di server ini.');
  if (!(member.communicationDisabledUntilTimestamp > Date.now())) throw new ModError('Dia tidak sedang di-timeout.');
  await member.timeout(null, auditReason(reason, mod));
  const c = kasus.add(guild.id, { type: 'untimeout', userId: user.id, userTag: tagOf(user), modId: mod.id, modTag: tagOf(mod), reason });
  await catat(guild, c);
  return { case: c };
}

// Kick dan ban: DM dikirim SEBELUM tindakan, karena setelah dia keluar bot tidak punya server bersama lagi untuk mengirim DM.
async function kick(guild, { mod, modMember = null, user, reason }) {
  const member = await getMember(guild, user.id);
  guardTarget(guild, { modMember, user, member, need: 'kickable' });
  if (!member) throw new ModError('Dia tidak ada di server ini.');
  const c = kasus.add(guild.id, { type: 'kick', userId: user.id, userTag: tagOf(user), modId: mod.id, modTag: tagOf(mod), reason });
  const dm = cfg().dm ? await kirimDm(user, tampil.dmEmbed(c, { guild, moderator: cfg().tampilkanModerator && mod.id !== guild.client.user.id ? tagOf(mod) : null })) : 'tidak';
  try {
    await member.kick(auditReason(reason, mod));
  } catch (err) {
    kasus.discard(guild.id, c.id);
    throw err;
  }
  kasus.update(guild.id, c.id, { dm });
  await catat(guild, c);
  return { case: c, dm };
}

async function ban(guild, { mod, modMember = null, user, reason, hariPesan = 0 }) {
  const member = await getMember(guild, user.id);
  guardTarget(guild, { modMember, user, member, need: 'bannable' });
  const c = kasus.add(guild.id, { type: 'ban', userId: user.id, userTag: tagOf(user), modId: mod.id, modTag: tagOf(mod), reason, hariPesan });
  const dm = cfg().dm && member
    ? await kirimDm(user, tampil.dmEmbed(c, { guild, moderator: cfg().tampilkanModerator && mod.id !== guild.client.user.id ? tagOf(mod) : null }))
    : 'tidak';
  try {
    await guild.members.ban(user.id, { reason: auditReason(reason, mod), deleteMessageSeconds: Math.max(0, Math.min(7, hariPesan)) * 86400 });
  } catch (err) {
    kasus.discard(guild.id, c.id);
    throw err;
  }
  kasus.update(guild.id, c.id, { dm });
  await catat(guild, c);
  return { case: c, dm };
}

async function unban(guild, { mod, userId, reason }) {
  if (!/^\d{15,22}$/.test(userId)) throw new ModError('ID user tidak valid. Salin ID-nya (klik kanan nama > Copy User ID, mode developer harus menyala).');
  const user = await guild.client.users.fetch(userId).catch(() => null);
  await guild.bans.remove(userId, auditReason(reason, mod));
  const c = kasus.add(guild.id, { type: 'unban', userId, userTag: user ? tagOf(user) : userId, modId: mod.id, modTag: tagOf(mod), reason });
  await catat(guild, c);
  return { case: c };
}

// ---------- peringatan dihapus ----------

async function hapusPeringatan(guild, { mod, id, alasan }) {
  const r = kasus.removeWarn(guild.id, id, mod, alasan);
  if (r.error === 'notfound') throw new ModError(`Kasus #${id} tidak ada.`);
  if (r.error === 'type') throw new ModError('Hanya kasus peringatan yang bisa dihapus.');
  if (r.error === 'done') throw new ModError(`Peringatan #${id} sudah dihapus sebelumnya.`);
  await tulisLog(guild, new EmbedBuilder().setColor(0x2ecc71).setTitle(`Peringatan #${id} dihapus`)
    .setDescription(`Member: <@${r.case.userId}>\nOleh: <@${mod.id}>${alasan ? `\nAlasan: ${tampil.clip(alasan, 300)}` : ''}`).setTimestamp());
  return r;
}

// ---------- channel ----------

async function purge(guild, { mod, channel, jumlah, user = null }) {
  if (typeof channel.bulkDelete !== 'function') throw new ModError('Channel ini tidak bisa dibersihkan.');
  let deleted;
  if (user) {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const ids = [...fetched.filter((m) => m.author.id === user.id).values()].slice(0, jumlah);
    deleted = ids.length ? await channel.bulkDelete(ids, true) : { size: 0 };
  } else {
    deleted = await channel.bulkDelete(jumlah, true);
  }
  await tulisLog(guild, new EmbedBuilder().setColor(0x3498db).setTitle('Pesan dibersihkan')
    .setDescription(`${deleted.size} pesan dihapus di <#${channel.id}>${user ? ` (milik <@${user.id}>)` : ''}\nOleh: <@${mod.id}>`).setTimestamp());
  return deleted.size;
}

async function slowmode(guild, { mod, channel, detik }) {
  if (typeof channel.setRateLimitPerUser !== 'function') throw new ModError('Channel ini tidak mendukung slowmode.');
  await channel.setRateLimitPerUser(detik, `Slowmode oleh ${tagOf(mod)}`);
  await tulisLog(guild, new EmbedBuilder().setColor(0x3498db).setTitle('Slowmode diubah')
    .setDescription(`<#${channel.id}>: ${detik ? formatDurasi(detik * 1000) : 'dimatikan'}\nOleh: <@${mod.id}>`).setTimestamp());
}

const keadaanIzin = (channel, guild) => {
  const o = channel.permissionOverwrites?.cache?.get(guild.id);
  if (o?.allow?.has(P.SendMessages)) return true;
  if (o?.deny?.has(P.SendMessages)) return false;
  return null;
};

async function lock(guild, { mod, channel, alasan }) {
  if (!channel.permissionOverwrites) throw new ModError('Channel ini tidak bisa dikunci.');
  if (kasus.lockOf(guild.id, channel.id) === undefined) kasus.setLock(guild.id, channel.id, keadaanIzin(channel, guild));
  await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: auditReason(alasan, mod) });
  await tulisLog(guild, new EmbedBuilder().setColor(0xe67e22).setTitle('Channel dikunci')
    .setDescription(`<#${channel.id}>${alasan ? `\nAlasan: ${tampil.clip(alasan, 300)}` : ''}\nOleh: <@${mod.id}>`).setTimestamp());
}

async function unlock(guild, { mod, channel }) {
  if (!channel.permissionOverwrites) throw new ModError('Channel ini tidak bisa dibuka.');
  const prev = kasus.lockOf(guild.id, channel.id);
  await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: prev ?? null }, { reason: `Dibuka oleh ${tagOf(mod)}` });
  kasus.setLock(guild.id, channel.id, undefined);
  await tulisLog(guild, new EmbedBuilder().setColor(0x2ecc71).setTitle('Channel dibuka')
    .setDescription(`<#${channel.id}>\nOleh: <@${mod.id}>`).setTimestamp());
}

// ---------- cek izin bot ----------

const IZIN = [
  [P.ModerateMembers, 'Timeout member'], [P.KickMembers, 'Kick'], [P.BanMembers, 'Ban / unban'],
  [P.ManageMessages, 'Hapus pesan (purge, auto-moderasi)'], [P.ManageChannels, 'Slowmode & kunci channel'],
  [P.ManageRoles, 'Role otomatis untuk member baru'],
];

function izinBot(guild) {
  const me = guild.members.me;
  const lines = IZIN.map(([flag, label]) => `${me?.permissions.has(flag) ? '✅' : '❌'} ${label}`);
  const log = panels.moduleChannel(guild, 'moderasi');
  lines.push(`${log ? '✅' : '❌'} Channel log moderasi: ${log ?? 'belum ketemu (buat channel logs-moderasi atau hubungkan lewat Pengaturan)'}`);
  lines.push('', `Role tertinggi bot: ${me?.roles.highest ?? '-'} (posisi ${me?.roles.highest.position ?? '?'}). Bot hanya bisa menindak member yang role tertingginya **di bawah** role ini. Naikkan role bot di Server Settings → Roles kalau perlu.`);
  return lines.join('\n');
}

// ---------- aturan eskalasi (teks <-> data) ----------

// "3=timeout 60m, 5=kick, 7=ban" -> [{ jumlah: 3, aksi: 'timeout', menit: 60 }, ...]
function parseEskalasi(text) {
  const { parseDurasi } = require('../waktu');
  const out = [];
  for (const part of String(text ?? '').split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{1,2})\s*[=:>-]\s*(timeout|kick|ban)(?:\s+(.+))?$/i);
    if (!m) return { error: `Tidak mengerti: "${part}". Tulis seperti: 3=timeout 60m, 5=kick, 7=ban` };
    const rule = { jumlah: Number(m[1]), aksi: m[2].toLowerCase() };
    if (rule.jumlah < 1) return { error: 'Jumlah peringatan minimal 1.' };
    if (rule.aksi === 'timeout') {
      const ms = m[3] ? parseDurasi(m[3]) : 60 * 60e3;
      if (!ms || ms < 60e3 || ms > MAX_TIMEOUT) return { error: `Durasi timeout "${m[3]}" tidak valid (1 menit sampai 28 hari, contoh 60m / 2j / 1d).` };
      rule.menit = Math.round(ms / 60e3);
    }
    if (out.some((r) => r.jumlah === rule.jumlah)) return { error: `Jumlah ${rule.jumlah} ditulis dua kali.` };
    out.push(rule);
  }
  return { aturan: out.sort((a, b) => a.jumlah - b.jumlah).slice(0, 8) };
}

function formatEskalasi(aturan) {
  return aturan.map((r) => `${r.jumlah}=${r.aksi}${r.aksi === 'timeout' ? ` ${r.menit ?? 60}m` : ''}`).join(', ');
}

module.exports = {
  ModError, friendly, kirimDm, tulisLog, catat, getMember, guardTarget,
  warn, kirimPesan, catatan, timeout, untimeout, kick, ban, unban, hapusPeringatan,
  purge, slowmode, lock, unlock, izinBot, parseEskalasi, formatEskalasi, MAX_TIMEOUT,
};
