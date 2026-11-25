// /afk: tandai dirimu sedang pergi. Kalau ada yang me-mention, bot memberi tahu. Begitu kamu menulis lagi, status AFK hilang.
const { MessageFlags } = require('discord.js');
const data = require('./data');
const { formatDurasi } = require('../waktu');

const EPHEMERAL = MessageFlags.Ephemeral;
const cooldown = new Map(); // "channel:user" -> waktu terakhir bot memberi tahu

function set(i) {
  const d = data.data();
  const alasan = (i.options.getString('alasan') ?? 'sedang pergi').trim().slice(0, 150);
  (d.afk[i.guildId] ??= {})[i.user.id] = { alasan, at: Date.now() };
  data.save();
  return i.reply({ content: `💤 Kamu sekarang AFK: ${alasan}. Status hilang sendiri begitu kamu menulis lagi.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

const hapusNanti = (promise, ms) => promise.then((m) => setTimeout(() => m.delete().catch(() => {}), ms).unref?.()).catch(() => {});

async function onMessage(message) {
  if (!message.guild || !message.author || message.author.bot) return;
  const guildAfk = data.data().afk[message.guild.id];
  if (!guildAfk || !Object.keys(guildAfk).length) return;

  const own = guildAfk[message.author.id];
  if (own) {
    delete guildAfk[message.author.id];
    data.save();
    hapusNanti(message.channel.send({ content: `Selamat datang kembali, ${message.author}! Kamu AFK selama ${formatDurasi(Date.now() - own.at)}.`, allowedMentions: { users: [message.author.id] } }), 10e3);
  }

  const now = Date.now();
  const kena = [];
  for (const u of message.mentions?.users?.values?.() ?? []) {
    const a = guildAfk[u.id];
    if (!a || u.id === message.author.id) continue;
    const key = `${message.channelId}:${u.id}`;
    if (now - (cooldown.get(key) ?? 0) < 20e3) continue;
    cooldown.set(key, now);
    kena.push(`**${u.displayName ?? u.username}** sedang AFK: ${a.alasan} (${formatDurasi(now - a.at)} lalu)`);
    if (kena.length >= 3) break;
  }
  if (cooldown.size > 1000) for (const [k, t] of cooldown) if (now - t > 60e3) cooldown.delete(k);
  if (kena.length) hapusNanti(message.channel.send({ content: kena.join('\n'), allowedMentions: { parse: [] } }), 15e3);
}

module.exports = { set, onMessage };
