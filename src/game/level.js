// Level: XP dari chat dan voice, naik level, hadiah role, pengumuman.
// Rumus XP per level: 5n² + 50n + 100 (level 1 butuh 100 XP, level 10 butuh 1.100, level 50 butuh 15.100 XP dari level sebelumnya).
const crypto = require('node:crypto');
const store = require('../store');
const safety = require('../safety');
const panels = require('../panels');
const data = require('./data');

const MAKS_LEVEL = 200;
const MAKS_HADIAH = 20;
const butuh = (n) => 5 * n * n + 50 * n + 100; // XP untuk naik dari level n ke n + 1

// Total XP yang dibutuhkan untuk sampai di awal level tertentu.
function xpAwal(level) {
  let t = 0;
  for (let i = 0; i < Math.min(level, MAKS_LEVEL); i++) t += butuh(i);
  return t;
}

function info(xp) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 0;
  let sisa = total;
  while (level < MAKS_LEVEL && sisa >= butuh(level)) {
    sisa -= butuh(level);
    level += 1;
  }
  const maks = level >= MAKS_LEVEL;
  return { level, xpLevel: sisa, butuh: butuh(level), total, maks };
}

const acak = (min, maks) => (maks <= min ? min : crypto.randomInt(min, maks + 1));
const cfg = () => store.peekSettings().level;

// ---------- hadiah role ----------

const hadiahUntuk = (c, level) => (c.hadiah ?? []).filter((h) => h.level <= level).sort((a, b) => a.level - b.level);

// Beri semua role hadiah yang sudah dicapai dan belum dimiliki. Mengembalikan daftar role yang berhasil diberikan.
async function sinkronRole(guild, member, level) {
  const diberi = [];
  if (!member?.roles) return diberi;
  for (const h of hadiahUntuk(cfg(), level)) {
    const role = guild.roles.cache.get(h.role);
    if (!role || !safety.isSafeRole(guild, role)) continue;
    if (member.roles.cache?.has?.(role.id)) continue;
    try {
      await member.roles.add(role, `Hadiah level ${h.level}`);
      diberi.push(role);
    } catch (err) {
      console.error(`[level] gagal memberi role ${role.name}: ${err.message}`);
    }
  }
  return diberi;
}

// ---------- tambah XP ----------

function teksNaik({ userId, ke, role, koin }) {
  const baris = [`🎉 <@${userId}> naik ke **level ${ke}**!`];
  if (role.length) baris.push(`🎁 Role baru: ${role.map((r) => `<@&${r.id}>`).join(' ')}`);
  if (koin > 0) baris.push(`🪙 Bonus ${koin.toLocaleString('id-ID')} koin`);
  return baris.join('\n');
}

async function umumkan(guild, teks, userId, fallback) {
  if (!cfg().umumkan) return;
  const ch = panels.moduleChannel(guild, 'level') ?? fallback;
  if (!ch?.send) return;
  await ch.send({ content: teks, allowedMentions: { users: [userId], roles: [] } }).catch(() => {});
}

// Tambah (atau kurangi, kalau n negatif) XP. Naik level: bonus koin, role hadiah, dan pengumuman.
// opsi.diam = true untuk perubahan dari pengelola (tidak ada bonus dan pengumuman, role tetap disesuaikan).
async function tambahXp(guild, user, n, { member = null, channel = null, diam = false } = {}) {
  const subjek = member ?? user;
  const p = data.pemain(guild.id, subjek);
  const dulu = info(p.xp).level;
  p.xp = Math.max(0, Math.floor(p.xp + Math.trunc(n)));
  const kini = info(p.xp).level;
  data.save();
  const hasil = { dulu, kini, naik: kini > dulu, role: [], koin: 0 };
  if (kini > dulu) {
    const m = member ?? await guild.members.fetch(user.id).catch(() => null);
    hasil.role = await sinkronRole(guild, m, kini);
    if (!diam) {
      const bonus = store.peekSettings().game;
      if (bonus.aktif && bonus.koinNaikLevel > 0) {
        hasil.koin = bonus.koinNaikLevel * Math.min(kini - dulu, 10);
        data.tambahKoin(guild.id, subjek, hasil.koin);
      }
      await umumkan(guild, teksNaik({ userId: subjek.id, ke: kini, role: hasil.role, koin: hasil.koin }), subjek.id, channel);
    }
  }
  return hasil;
}

// ---------- XP dari chat ----------

const jeda = new Map(); // "guild:user" -> waktu XP chat terakhir

function onMessage(m) {
  if (!m.guild || !m.author || m.author.bot || m.webhookId || m.system) return null;
  const c = cfg();
  if (!c.aktif) return null;
  const abaikan = c.abaikanChannel ?? [];
  if (abaikan.includes(m.channelId) || (m.channel?.parentId && abaikan.includes(m.channel.parentId))) return null;
  const member = m.member ?? m.author;
  const p = data.pemain(m.guild.id, member);
  p.pesan += 1;
  const key = `${m.guild.id}:${m.author.id}`;
  const now = Date.now();
  if (now - (jeda.get(key) ?? 0) < (c.jedaDetik ?? 60) * 1000) {
    data.save();
    return null;
  }
  jeda.set(key, now);
  return tambahXp(m.guild, m.author, acak(c.xpMin, c.xpMaks), { member: m.member ?? null, channel: m.channel });
}

// ---------- XP dari voice (dihitung tiap menit oleh penyapu) ----------

// Dapat XP: di voice, tidak di channel AFK, tidak menutup suara (deafen), dan ada minimal 2 orang (bukan bot) di channel itu.
async function sweepVoice(client) {
  for (const guild of client.guilds.cache.values()) {
    const c = store.peekSettings().level;
    if (!c.aktif || !c.voice || !(c.xpVoice > 0)) continue;
    for (const vs of guild.voiceStates.cache.values()) {
      const member = vs.member;
      if (!member || member.user?.bot || !vs.channelId || vs.channelId === guild.afkChannelId) continue;
      if (vs.selfDeaf || vs.serverDeaf) continue;
      const orang = [...(vs.channel?.members?.values() ?? [])].filter((x) => !x.user?.bot).length;
      if (orang < 2) continue;
      await tambahXp(guild, member.user, c.xpVoice, { member }).catch((err) => console.error(`[level] voice: ${err.message}`));
    }
  }
}

function bersihkan(now = Date.now()) {
  if (jeda.size < 2000) return;
  for (const [k, t] of jeda) if (now - t > 10 * 60e3) jeda.delete(k);
}

module.exports = {
  MAKS_LEVEL, MAKS_HADIAH, butuh, xpAwal, info, hadiahUntuk, sinkronRole, tambahXp, onMessage, sweepVoice, bersihkan, teksNaik,
  reset: () => jeda.clear(),
};
