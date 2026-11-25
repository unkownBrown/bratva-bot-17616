const members = require('./members');

// Pesan dihitung tanpa membaca isinya (cukup tahu siapa yang kirim). Voice dihitung dari lama di channel suara.
const voiceStart = new Map(); // "guildId:userId" -> waktu masuk voice

function onMessage(message) {
  if (!message.guildId || message.author?.bot || message.webhookId) return;
  members.addActivity(message.guildId, message.author, { msgs: 1 });
}

function endVoice(guildId, user) {
  const key = `${guildId}:${user.id}`;
  const start = voiceStart.get(key);
  if (!start) return;
  voiceStart.delete(key);
  const min = Math.floor((Date.now() - start) / 60000);
  if (min > 0) members.addActivity(guildId, user, { voice: min });
}

function onVoice(oldState, newState) {
  const user = (newState.member ?? oldState.member)?.user;
  if (!user || user.bot) return;
  const guildId = newState.guild.id;
  if (!oldState.channelId && newState.channelId) voiceStart.set(`${guildId}:${user.id}`, Date.now());
  else if (oldState.channelId && !newState.channelId) endVoice(guildId, user);
}

// Yang sudah di voice waktu bot menyala mulai dihitung dari sekarang.
function seedVoice(guild) {
  for (const state of guild.voiceStates?.cache?.values() ?? []) {
    if (state.channelId && state.member && !state.member.user.bot) voiceStart.set(`${guild.id}:${state.id}`, Date.now());
  }
}

// Dipanggil saat bot dimatikan: sesi voice yang sedang jalan ikut dicatat.
function closeAllVoice(client) {
  for (const key of [...voiceStart.keys()]) {
    const [guildId, userId] = key.split(':');
    const user = client.users.cache.get(userId);
    if (user) endVoice(guildId, user);
  }
}

module.exports = { onMessage, onVoice, seedVoice, closeAllVoice };
