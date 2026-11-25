// Log voice: hanya siapa masuk dan siapa keluar dari voice (keluar disertai lama di voice). Pindah channel, mute, dan pesan (kirim / edit / hapus) tidak dicatat.
const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const store = require('./store');
const panels = require('./panels');
const runtime = require('./runtime');

const { wib, duration } = runtime;
const COLORS = { join: 0x2e9e5b, leave: 0xb45309 };

const cfgOf = () => store.loadSettings().pesan;

// Versi lama menyimpan isi pesan di data/msgcache.json. Sekarang tidak dipakai lagi, jadi dibersihkan.
try {
  fs.rmSync(path.join(store.DIR, 'msgcache.json'), { force: true });
} catch { /* tidak apa-apa kalau gagal */ }

// ---------- antrean kirim ----------
// Log dikumpulkan lalu dikirim per 2 detik (maks 10 embed per pesan) supaya tidak kena batas kecepatan Discord.
const queues = new Map();

const embedLength = (e) => {
  const d = e.data;
  return (d.title?.length ?? 0) + (d.description?.length ?? 0) + (d.footer?.text?.length ?? 0) + (d.author?.name?.length ?? 0)
    + (d.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
};

function logChannel(guild) {
  const state = store.loadState();
  const settings = store.loadSettings();
  return panels.moduleChannel(guild, 'pesan', state, settings) || panels.moduleChannel(guild, 'logs', state, settings);
}

async function flushQueue(guild) {
  const q = queues.get(guild.id);
  if (!q) return;
  q.timer = null;
  const channel = logChannel(guild);
  if (!channel) {
    if (!q.warned) console.warn(`[${guild.name}] Log voice menyala tapi channel logs-pesan (atau logs-anggota) tidak ketemu. Hubungkan lewat Pengaturan.`);
    q.warned = true;
    q.list = [];
    return;
  }
  while (q.list.length) {
    const batch = [];
    let size = 0;
    while (q.list.length && batch.length < 10) {
      const len = embedLength(q.list[0]);
      if (batch.length && size + len > 5500) break;
      size += len;
      batch.push(q.list.shift());
    }
    try {
      await channel.send({ embeds: batch, allowedMentions: { parse: [] } });
    } catch (err) {
      console.error(`[${guild.name}] Gagal kirim log voice: ${err.message}`);
      q.list = [];
      return;
    }
  }
}

function enqueue(guild, embed) {
  let q = queues.get(guild.id);
  if (!q) {
    q = { list: [], timer: null, warned: false };
    queues.set(guild.id, q);
  }
  q.list.push(embed);
  if (q.list.length > 500) q.list.shift();
  if (!q.timer) {
    q.timer = setTimeout(() => flushQueue(guild).catch((e) => console.error(e.message)), 2000);
    q.timer.unref?.();
  }
}

async function flushAll(client) {
  for (const guild of client.guilds.cache.values()) {
    const q = queues.get(guild.id);
    if (q?.list.length) {
      clearTimeout(q.timer);
      await flushQueue(guild);
    }
  }
}

// ---------- voice ----------

const voiceAt = new Map();

function header(color, title, user, ms) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp(ms);
  if (user) embed.setAuthor({ name: user.tag ?? user.username, iconURL: user.displayAvatarURL?.() ?? undefined });
  return embed;
}

function onVoice(oldState, newState) {
  const cfg = cfgOf();
  if (!cfg.aktif) return;
  const member = newState.member ?? oldState.member;
  const user = member?.user;
  if (!user || (user.bot && cfg.abaikanBot)) return;
  const guild = newState.guild;
  const key = `${guild.id}:${user.id}`;
  const now = Date.now();
  const from = oldState.channelId;
  const to = newState.channelId;
  if (from === to) return; // mute, deafen, kamera: tidak dicatat
  if (from && to) return; // pindah antar channel voice: tidak dicatat

  let embed;
  if (!from && to) {
    voiceAt.set(key, now);
    embed = header(COLORS.join, 'VOICE MASUK', user, now).setDescription(`${user} masuk <#${to}>`);
  } else if (from && !to) {
    const start = voiceAt.get(key);
    voiceAt.delete(key);
    embed = header(COLORS.leave, 'VOICE KELUAR', user, now).setDescription(`${user} keluar dari <#${from}>`);
    if (start) embed.addFields({ name: 'Lama', value: duration(now - start), inline: true });
  } else {
    return;
  }
  embed.addFields({ name: 'Waktu', value: wib(now), inline: true }).setFooter({ text: `ID ${user.id}` });
  enqueue(guild, embed);
}

function seedVoice(guild) {
  for (const state of guild.voiceStates?.cache?.values() ?? []) {
    if (state.channelId && state.member) voiceAt.set(`${guild.id}:${state.id}`, Date.now());
  }
}

module.exports = { onVoice, seedVoice, flushAll };
