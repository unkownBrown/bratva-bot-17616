require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const http = require('node:http');
const { exec } = require('node:child_process');
const { Client, GatewayIntentBits, Events, Options } = require('discord.js');

const store = require('./src/store');
const runtime = require('./src/runtime');
const members = require('./src/members');
const activity = require('./src/activity');
const msglog = require('./src/msglog');
const logs = require('./src/logs');
const interactions = require('./src/interactions');
const backup = require('./src/backup');
const status = require('./src/status');
const musik = require('./src/musik');
const moderasi = require('./src/moderasi');
const komunitas = require('./src/komunitas');
const bursa = require('./src/bursa');
const game = require('./src/game');
const layar = require('./src/layar');
const db = require('./src/db');
const { setupGuild, startSchedules, syncSoon } = require('./src/guild');

// Mode embedded: bot dijalankan di dalam proses lain (server Netlify, lihat NETLIFY.md) lewat start() dan stop(),
// jadi bot tidak boleh memanggil process.exit sendiri atau membuka port sendiri.
const EMBEDDED = Boolean(process.env.BRV_EMBEDDED);

function makeClient({ members: withMembers, content, presence }) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildInvites];
  if (withMembers) intents.push(GatewayIntentBits.GuildMembers);
  if (content) intents.push(GatewayIntentBits.MessageContent);
  if (presence) intents.push(GatewayIntentBits.GuildPresences); // daftar anggota online / lagi main di dashboard web
  return new Client({
    intents,
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0, ThreadManager: 0, ReactionManager: 0 }),
  });
}

function wire(client) {
  client.once(Events.ClientReady, async (c) => {
    console.log(`Login sebagai ${c.user.tag}`);
    if (c.guilds.cache.size === 0) {
      const url = `https://discord.com/oauth2/authorize?client_id=${c.user.id}&permissions=8&scope=bot+applications.commands`;
      console.log('\nBot belum ada di server mana pun. Buka link ini buat invite:\n' + url + '\n');
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      if (!EMBEDDED) exec(cmd, () => {});
    }
    for (const guild of c.guilds.cache.values()) await setupGuild(guild);
    startSchedules(c);
    musik.warmup(); // pasang / perbarui yt-dlp di latar belakang kalau fitur Musik menyala
    komunitas.warmup(c); // penyapu poll, giveaway, dan pengingat yang waktunya habis
    bursa.warmup(c); // rekap mingguan bursa harga (kalau menyala)
    game.warmup(c); // XP voice, tantangan XO dan blackjack yang ditinggal
    await status.refresh(c).catch((err) => console.error(`Status bot: ${err.message}`));
    console.log('Bot siap.');
  });

  const safe = (fn) => (...args) => Promise.resolve(fn(...args)).catch((err) => console.error(err.message));
  client.on(Events.GuildCreate, (guild) => setupGuild(guild));
  client.on(Events.InteractionCreate, (i) => interactions.handle(i).catch((err) => console.error(err)));
  client.on(Events.MessageCreate, (m) => activity.onMessage(m));
  client.on(Events.MessageCreate, safe((m) => moderasi.onMessage(m, { konten: runtime.features.content })));
  client.on(Events.MessageCreate, safe((m) => komunitas.onMessage(m)));
  client.on(Events.MessageCreate, safe((m) => game.onMessage(m))); // XP dari chat (kalau Level menyala)
  client.on(Events.VoiceStateUpdate, (a, b) => {
    activity.onVoice(a, b);
    msglog.onVoice(a, b);
    musik.onVoiceState(a, b);
    try {
      layar.onVoice(a, b); // log share screen (kalau menyala)
    } catch (err) {
      console.error(`Log share screen: ${err.message}`);
    }
  });
  client.on(Events.ChannelCreate, (ch) => ch.guild && syncSoon(ch.guild));
  client.on(Events.ChannelUpdate, (a, b) => b.guild && a.name !== b.name && syncSoon(b.guild));

  if (runtime.features.members) {
    client.on(Events.GuildMemberAdd, safe((m) => logs.onAdd(m)));
    client.on(Events.GuildMemberAdd, safe((m) => komunitas.onAdd(m)));
    client.on(Events.GuildMemberRemove, safe((m) => logs.onRemove(m)));
    client.on(Events.GuildMemberRemove, safe((m) => komunitas.onRemove(m)));
    client.on(Events.GuildMemberUpdate, safe((a, b) => logs.onUpdate(a, b)));
  }
}

// Intent istimewa (Members, Message Content) harus dinyalakan di Developer Portal. Kalau belum,
// bot mencoba tanpa intent itu supaya tetap online (take role dan panel tetap jalan), dan memberi tahu fitur mana yang mati.
const ATTEMPTS = [
  ...(process.env.BRV_PRESENCE === '0' ? [] : [{ members: true, content: true, presence: true }]), // isi BRV_PRESENCE=0 kalau tidak mau Presence Intent
  { members: true, content: true }, { members: true, content: false },
  { members: false, content: true }, { members: false, content: false },
];
let client;
let prepared = false;
let closing = false;

// Pekerjaan sekali jalan per proses: penangkap error, pemantau content.json, dan endpoint kecil buat hosting yang butuh port terbuka.
function prepareProcess() {
  if (prepared) return;
  prepared = true;
  process.on('unhandledRejection', (err) => console.error('Unhandled:', err?.message ?? err));
  // Endpoint kecil buat hosting yang butuh port terbuka atau layanan uptime monitor. Di Netlify port dipegang server Netlify, jadi dilewati.
  if (process.env.PORT && !EMBEDDED) {
    http.createServer((_, res) => res.end('ok')).listen(Number(process.env.PORT), () => console.log(`Health check di port ${process.env.PORT}`));
  }
  // Watcher: edit content.json langsung (mis. lewat file manager hosting) diterapkan kalau "Panel otomatis" menyala.
  fs.watchFile(store.FILES.content, { interval: 5000, persistent: false }, () => {
    for (const guild of client?.guilds.cache.values() ?? []) syncSoon(guild);
  });
}

// Nyalakan bot. Selesai (resolve) kalau sudah login. Gagal = melempar error; yang memutuskan berhenti atau tidak adalah pemanggilnya.
// onRestart: hanya mode embedded, dipanggil setelah data tersimpan kalau bot diminta restart.
async function start({ onRestart } = {}) {
  if (!process.env.DISCORD_TOKEN) {
    const err = new Error('DISCORD_TOKEN belum diisi. Jalankan install.bat, atau isi lewat file .env / environment variable di hosting.');
    err.code = 'NO_TOKEN';
    throw err;
  }
  closing = false;
  store.ensureData();
  prepareProcess();
  runtime.hooks.restart = EMBEDDED
    ? async () => { await stop('Restart'); onRestart?.(); }
    : () => stopWith(42, 'Restart');
  let last;
  for (const attempt of ATTEMPTS) {
    runtime.features.members = attempt.members;
    runtime.features.content = attempt.content;
    runtime.features.presence = Boolean(attempt.presence);
    client = makeClient(attempt);
    wire(client);
    try {
      await client.login(process.env.DISCORD_TOKEN);
      if (!attempt.members) console.warn('\nServer Members Intent belum dinyalakan: log join/leave, roster, dan aktivitas mati.');
      if (!attempt.content) console.warn('Message Content Intent belum dinyalakan: aturan auto-moderasi yang membaca isi pesan (undangan, link, kata, kapital) mati.');
      if (!attempt.presence && process.env.BRV_PRESENCE !== '0') console.warn('Presence Intent belum dinyalakan: daftar anggota online dan lagi main di dashboard web mati (daftar voice tetap jalan).');
      if (!attempt.members || !attempt.content) console.warn('Nyalakan di Developer Portal (tab Bot, bagian Privileged Gateway Intents) lalu restart bot.\n');
      return;
    } catch (err) {
      if (err.code !== 'DisallowedIntents' && !/disallowed intents/i.test(err.message)) throw err;
      last = err;
      await client.destroy();
    }
  }
  throw last;
}

// Simpan semua data yang masih di memori. Mengembalikan false kalau sudah pernah dipanggil.
async function saveAll(label) {
  if (closing) return false;
  closing = true;
  console.log(`${label}: menyimpan data sebelum berhenti...`);
  try {
    await musik.shutdown().catch(() => {});
    komunitas.shutdown();
    bursa.shutdown();
    game.shutdown();
    layar.shutdown();
    db.flushAll();
    if (client) activity.closeAllVoice(client);
    members.flush();
    if (client) await Promise.race([msglog.flushAll(client), runtime.sleep(4000)]);
    const guild = client?.guilds.cache.first();
    if (guild && store.loadSettings().backup.aktif && require('./src/panels').moduleChannel(guild, 'backup')) {
      await Promise.race([backup.run(guild), runtime.sleep(6000)]);
    }
  } catch (err) {
    console.error(err.message);
  }
  return true;
}

// Simpan lalu berhenti dengan kode tertentu.
// Kode 42 = restart yang disengaja (update): start.bat, systemd, dan hosting menyalakan bot lagi.
async function stopWith(code, label) {
  if (!(await saveAll(label))) return;
  process.exit(code);
}

// Mode embedded: simpan data lalu putuskan koneksi Discord, tanpa mematikan proses.
async function stop(label = 'Berhenti') {
  await saveAll(label);
  await client?.destroy();
}

const ready = () => Boolean(client?.isReady?.());

const getClient = () => client;

module.exports = { start, stop, ready, getClient };

// Dijalankan langsung (node index.js, start.bat, systemd, Docker): bot mengurus sinyal dan kode keluarnya sendiri.
if (require.main === module) {
  process.on('SIGTERM', () => stopWith(0, 'SIGTERM'));
  process.on('SIGINT', () => stopWith(0, 'SIGINT'));
  start().catch((err) => {
    console.error(err.code === 'NO_TOKEN' ? err.message : `Gagal login: ${err.message}`);
    process.exit(1);
  });
}
