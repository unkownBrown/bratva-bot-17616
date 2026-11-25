const store = require('./store');
const panels = require('./panels');
const backup = require('./backup');
const logs = require('./logs');
const boards = require('./boards');
const activity = require('./activity');
const msglog = require('./msglog');
const layar = require('./layar');
const dashboard = require('./dashboard');
const status = require('./status');
const runtime = require('./runtime');
const { commandJSON } = require('./interactions');

async function step(guild, label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[${guild.name}] ${label}: ${err.message}`);
    return null;
  }
}

const running = new Set();

// Yang dilakukan bot waktu menyala atau baru masuk server: pasang /panel dan mulai mencatat data.
// Bot TIDAK membuat role atau channel, dan TIDAK memposting apa pun sendiri. Semua fitur yang
// memposting (panel, log, roster, aktivitas, backup) baru jalan setelah kamu menyalakannya di Pengaturan.
async function setupGuild(guild) {
  if (running.has(guild.id)) return;
  running.add(guild.id);
  try {
    await runSetup(guild);
  } finally {
    running.delete(guild.id);
  }
}

async function runSetup(guild) {
  await step(guild, 'pasang command', () => guild.commands.set(commandJSON()));

  // Data kosong (hosting baru) dan belum pernah dipakai: ambil cadangan terakhir kalau ada.
  const state = store.loadState();
  const used = state.seen[guild.id] || ['panels', 'access', 'roleMenus', 'arahan'].some((k) => Object.keys(state[k]).length);
  if (!used) await step(guild, 'pulihkan cadangan', () => backup.restoreIfFresh(guild));
  // Di Netlify disk bot hilang tiap pergantian server, jadi cadangan wajib menyala begitu channel cadangannya dikenal.
  if (process.env.BRV_EMBEDDED && panels.moduleChannel(guild, 'backup')) {
    const pengaturan = store.loadSettings();
    if (!pengaturan.backup.aktif) {
      pengaturan.backup.aktif = true;
      store.saveSettings(pengaturan);
    }
  }

  await step(guild, 'warm', () => panels.warm(guild));
  if (runtime.features.members) {
    await step(guild, 'catat anggota', () => logs.catchUp(guild));
    activity.seedVoice(guild);
  }
  msglog.seedVoice(guild);
  layar.seed(guild);

  const settings = store.loadSettings();
  if (settings.logs.aktif && settings.logs.invite) await step(guild, 'snapshot invite', () => logs.snapshotInvites(guild));
  if (settings.otomatis.panel) await step(guild, 'pasang panel', () => panels.syncGuild(guild));
  await step(guild, 'roster & aktivitas', () => boards.refreshAll(guild));
  await step(guild, 'panel kontrol', () => dashboard.refreshDashboard(guild));

  const fresh = store.loadState();
  fresh.seen[guild.id] = true;
  store.saveState(fresh);
  console.log(`[${guild.name}] siap (mode manual). Ketik /panel di server buat membuka menu.`);
}

// Tugas berkala. Semuanya cek dulu apakah fiturnya kamu nyalakan.
function startSchedules(client) {
  const every = (ms, fn) => setInterval(() => {
    for (const guild of client.guilds.cache.values()) fn(guild).catch((err) => console.error(err.message));
  }, ms).unref();

  every(10 * 60e3, (guild) => boards.refreshActivity(guild));
  // Status bot (jumlah online) diperbarui berkala, selama fiturnya menyala.
  const statusMinutes = Math.max(2, store.loadSettings().status.menit || 5);
  setInterval(() => status.refresh(client).catch((err) => console.error(`Status bot: ${err.message}`)), statusMinutes * 60e3).unref();
  // Di Netlify disk bot hilang tiap bot dinyalakan ulang (paling lama 8 jam), jadi cadangan dibuat tiap 30 menit.
  const jedaBackup = process.env.BRV_EMBEDDED ? 1800e3 : (store.loadSettings().backup.jam || 6) * 3600e3;
  every(jedaBackup, async (guild) => {
    if (store.loadSettings().backup.aktif && panels.moduleChannel(guild, 'backup')) await backup.run(guild);
  });
}

// Hanya kalau "Panel otomatis" kamu nyalakan: channel baru / di-rename dan perubahan content.json langsung diterapkan.
function syncSoon(guild) {
  if (!store.loadSettings().otomatis.panel) return;
  runtime.debounce(`sync:${guild.id}`, 5000, async () => {
    await panels.syncGuild(guild);
    await dashboard.refreshDashboard(guild);
    await boards.refreshAll(guild);
  });
}

module.exports = { setupGuild, startSchedules, syncSoon };
