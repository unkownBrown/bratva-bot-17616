// Auto-moderasi: hapus pesan yang melanggar, kirim DM ke pelakunya, dan (kalau menyala) tambah peringatan.
// Aturan: undangan server lain, link, kata terlarang, mention massal, flood / spam berulang, huruf kapital.
// Pengelola, moderator (punya izin Manage Messages / Timeout), role & channel yang diabaikan tidak pernah kena.
const { PermissionFlagsBits: P } = require('discord.js');
const store = require('../store');
const aksi = require('./aksi');

const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|discord\.me)\/[\w-]+/i;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const LEET = { 4: 'a', 3: 'e', 1: 'i', 0: 'o', 5: 's', 7: 't', '@': 'a', $: 's' };

// ---------- pemeriksa murni (gampang dites) ----------

const bersih = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/(.)\1{2,}/g, '$1');
const kataSaja = (t) => t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Dua versi teks: apa adanya dan versi "leet" (4nj1ng -> anjing). Kata cocok kalau berdiri sendiri (bukan potongan kata lain).
function normalisasi(text) {
  const t = bersih(text);
  const leet = kataSaja(t.replace(/[431057@$]/g, (c) => LEET[c]));
  return [kataSaja(t), leet];
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function cocokKata(text, daftar) {
  if (!daftar.length) return null;
  const versi = normalisasi(text);
  for (const kata of daftar) {
    const k = kataSaja(bersih(kata));
    if (!k) continue;
    const re = new RegExp(`(?:^| )${escRe(k)}(?: |$)`);
    if (versi.some((v) => re.test(v))) return kata;
  }
  return null;
}

const domainBersih = (d) => String(d).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

function hostsIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(URL_RE)) {
    const raw = /^https?:/i.test(m[0]) ? m[0] : `http://${m[0]}`;
    try {
      out.push(new URL(raw).hostname.toLowerCase().replace(/^www\./, ''));
    } catch { /* bukan link sungguhan */ }
  }
  return out;
}
const diizinkan = (host, daftar) => daftar.map(domainBersih).some((d) => d && (host === d || host.endsWith(`.${d}`)));

function persenKapital(text) {
  const huruf = String(text ?? '').replace(/[^\p{L}]/gu, '');
  if (!huruf.length) return { panjang: 0, persen: 0 };
  const besar = [...huruf].filter((c) => c !== c.toLowerCase()).length;
  return { panjang: huruf.length, persen: Math.round((besar / huruf.length) * 100) };
}

// ---------- pelacak flood (di memori) ----------

const jejak = new Map(); // "guild:user" -> { pesan: [{ t, id, ch }], sama: [{ t, key }], tindak: 0 }

function catatFlood(message, conf) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const j = jejak.get(key) ?? { pesan: [], sama: [], tindak: 0 };
  jejak.set(key, j);
  j.pesan.push({ t: now, id: message.id, ch: message.channelId });
  j.pesan = j.pesan.filter((p) => now - p.t <= conf.floodDetik * 1000);
  const isi = kataSaja(bersih(message.content ?? ''));
  if (isi.length >= 4) j.sama.push({ t: now, key: isi });
  j.sama = j.sama.filter((p) => now - p.t <= 30e3);
  if (jejak.size > 2000) {
    for (const [k, v] of jejak) if (!v.pesan.length || now - v.pesan.at(-1).t > 60e3) jejak.delete(k);
  }
  return j;
}

function periksaFlood(j, message, conf) {
  if (j.pesan.length >= conf.floodPesan) return { aturan: 'flood', alasan: 'kamu mengirim pesan terlalu cepat', hapus: j.pesan.map((p) => ({ id: p.id, ch: p.ch })) };
  const key = kataSaja(bersih(message.content ?? ''));
  if (key.length >= 4 && j.sama.filter((p) => p.key === key).length >= 3) {
    const dup = j.pesan.length ? j.pesan : [{ id: message.id, ch: message.channelId }];
    return { aturan: 'flood', alasan: 'jangan mengirim pesan yang sama berulang-ulang', hapus: dup.map((p) => ({ id: p.id, ch: p.ch })) };
  }
  return null;
}

// ---------- keputusan ----------

function dikecualikan(message, conf) {
  const m = message.member;
  if (!m) return true;
  if (message.author.id === message.guild.ownerId) return true;
  const perm = m.permissions;
  if (perm?.has(P.Administrator) || perm?.has(P.ManageMessages) || perm?.has(P.ModerateMembers)) return true;
  const ch = message.channel;
  if (conf.abaikanChannel.includes(message.channelId) || (ch?.parentId && conf.abaikanChannel.includes(ch.parentId))) return true;
  return conf.abaikanRole.some((r) => m.roles.cache.has(r));
}

// Kembalikan { aturan, alasan, hapus? } untuk pelanggaran pertama yang ketemu, atau null.
function periksa(message, conf, { konten = true } = {}) {
  const teks = message.content ?? '';
  const flood = conf.flood ? periksaFlood(catatFlood(message, conf), message, conf) : null;
  if (konten && teks) {
    if (conf.invite && INVITE.test(teks)) return { aturan: 'invite', alasan: 'link undangan server lain tidak diizinkan di sini' };
    if (conf.link) {
      const host = hostsIn(teks).find((h) => !diizinkan(h, conf.linkIzin));
      if (host) return { aturan: 'link', alasan: `link dari ${host} tidak diizinkan di sini` };
    }
    if (conf.kata && cocokKata(teks, conf.kataDaftar)) return { aturan: 'kata', alasan: 'pesanmu mengandung kata yang tidak diperbolehkan' };
  }
  if (conf.mention) {
    const n = (message.mentions?.users?.size ?? 0) + (message.mentions?.roles?.size ?? 0);
    if (n > conf.mentionMaks) return { aturan: 'mention', alasan: `terlalu banyak mention (maksimal ${conf.mentionMaks})` };
  }
  if (konten && conf.kapital && teks) {
    const { panjang, persen } = persenKapital(teks);
    if (panjang >= conf.kapitalMin && persen >= conf.kapitalPersen) return { aturan: 'kapital', alasan: 'jangan terlalu banyak huruf kapital' };
  }
  return flood;
}

// ---------- tindakan ----------

const cooldown = new Map(); // "guild:user" -> waktu tindakan terakhir (supaya satu semburan pesan cuma kena sekali)

async function hapusPesan(message, hapus) {
  const perChannel = new Map();
  for (const h of hapus ?? []) if (h.id !== message.id) perChannel.set(h.ch, [...(perChannel.get(h.ch) ?? []), h.id]);
  for (const [chId, ids] of perChannel) {
    const ch = message.guild.channels.cache.get(chId) ?? message.channel;
    try {
      if (ids.length > 1 && ch.bulkDelete) await ch.bulkDelete(ids, true);
      else await ch.messages.delete(ids[0]);
    } catch { /* sudah terhapus atau bot tidak punya izin */ }
  }
  await message.delete().catch(() => {});
}

async function tindak(message, hasil, conf) {
  const { guild, author } = message;
  await hapusPesan(message, hasil.hapus);

  const key = `${guild.id}:${author.id}`;
  const j = jejak.get(key);
  if (hasil.aturan === 'flood' && j) { j.pesan = []; j.sama = []; }
  const now = Date.now();
  if (now - (cooldown.get(key) ?? 0) < 10e3) return 'cooldown';
  cooldown.set(key, now);
  if (cooldown.size > 2000) for (const [k, t] of cooldown) if (now - t > 60e3) cooldown.delete(k);

  if (conf.balasChannel) {
    message.channel.send({ content: `${author}, ${hasil.alasan}.`, allowedMentions: { users: [author.id] } })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 7000).unref?.()).catch(() => {});
  }
  const bot = guild.client.user;
  try {
    await aksi.warn(guild, {
      mod: bot, user: author, reason: `Pesan dihapus otomatis: ${hasil.alasan}.`, type: conf.peringatan ? 'warn' : 'auto', auto: hasil.aturan,
    });
  } catch (err) {
    console.error(`[automod] gagal mencatat kasus: ${err.message}`);
  }
  if (hasil.aturan === 'flood' && conf.floodTimeoutMenit > 0) {
    await aksi.timeout(guild, { mod: bot, user: author, ms: conf.floodTimeoutMenit * 60e3, reason: `Auto-moderasi: ${hasil.alasan}` })
      .catch((err) => console.error(`[automod] gagal timeout: ${err.message}`));
  }
  return 'ditindak';
}

async function onMessage(message, { konten = true } = {}) {
  if (!message.guild || !message.author || message.author.bot || message.webhookId || message.system) return null;
  const conf = store.peekSettings().automod;
  if (!conf.aktif || dikecualikan(message, conf)) return null;
  const hasil = periksa(message, conf, { konten });
  if (!hasil) return null;
  return tindak(message, hasil, conf);
}

const reset = () => { jejak.clear(); cooldown.clear(); };

module.exports = { onMessage, periksa, cocokKata, normalisasi, hostsIn, diizinkan, domainBersih, persenKapital, dikecualikan, reset };
