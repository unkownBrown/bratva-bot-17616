const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const store = require('./store');
const panels = require('./panels');
const members = require('./members');
const db = require('./db');

const NAME = 'brv-backup.json.gz';

function snapshot() {
  members.flush();
  db.flushAll();
  return zlib.gzipSync(JSON.stringify({
    v: 1,
    at: Date.now(),
    content: store.read(store.FILES.content, null),
    settings: store.read(store.FILES.settings, null),
    state: store.read(store.FILES.state, null),
    members: store.read(store.FILES.members, {}),
    moderasi: store.read(store.FILES.moderasi, {}),
    komunitas: store.read(store.FILES.komunitas, {}),
    bursa: store.read(store.FILES.bursa, {}),
    game: store.read(store.FILES.game, {}),
  }));
}

const backupChannel = (guild) => panels.moduleChannel(guild, 'backup');

// Pemulihan yang gagal di disk kosong (Discord error, koneksi putus) menahan cadangan baru: data kosong tidak boleh jadi cadangan terbaru,
// karena yang terbaru itulah yang dipakai pemulihan berikutnya. Server yang bisa direset (Netlify) paling rawan kena ini.
const ditahan = new Set();

// Cadangan disimpan sebagai satu pesan di channel backup pilihanmu (diedit terus, bukan numpuk).
// Dengan begitu data tetap aman walau hosting reset atau bot dipindah ke tempat lain.
async function run(guild) {
  const channel = backupChannel(guild);
  if (!channel) throw new Error('Channel backup belum dipilih. Pilih channel privat lewat Pengaturan, bagian Hubungkan channel modul.');
  if (ditahan.has(guild.id)) {
    try {
      await restoreIfFresh(guild); // coba pulihkan lagi dulu; berhasil (atau memang belum ada cadangan) berarti cadangan boleh jalan
    } catch (err) {
      throw new Error(`Cadangan ditahan: data belum berhasil dipulihkan dari cadangan terakhir (${err.message}). Dicoba lagi otomatis. Cadangan lama tidak ditimpa data kosong.`);
    }
  }
  const state = store.loadState();
  const oldId = state.access[guild.id]?.backupMessageId;
  const files = [new AttachmentBuilder(snapshot(), { name: NAME })];
  const assetFiles = panels.listAssets().map((f) => new AttachmentBuilder(fs.readFileSync(path.join(store.DIR, 'assets', f)), { name: `asset-${f}` }));
  const content = `Cadangan otomatis · <t:${Math.floor(Date.now() / 1000)}:F>`;

  const attempt = async (list) => {
    const payload = { content, files: list };
    let msg = oldId ? await channel.messages.fetch(oldId).then((m) => m.edit({ ...payload, attachments: [] })).catch(() => null) : null;
    msg ??= await channel.send(payload);
    return msg;
  };

  let msg;
  let withAssets = true;
  try {
    msg = await attempt([...files, ...assetFiles]);
  } catch (err) {
    if (err.code !== 40005 || !assetFiles.length) throw err;
    withAssets = false; // gambar bikin lampiran kebesaran: simpan datanya saja
    msg = await attempt(files);
  }
  const fresh = store.loadState();
  fresh.access[guild.id] = { ...(fresh.access[guild.id] ?? {}), backupMessageId: msg.id, backupAt: Date.now() };
  store.saveState(fresh);
  return { withAssets };
}

const download = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());

// Kalau bot baru dipindah (data kosong), ambil cadangan terakhir dari channel panel-backup.
async function restoreIfFresh(guild) {
  try {
    const ok = await pulihkan(guild);
    ditahan.delete(guild.id);
    return ok;
  } catch (err) {
    ditahan.add(guild.id);
    throw err;
  }
}

async function pulihkan(guild) {
  const channel = panels.moduleChannel(guild, 'backup');
  if (!channel) return false;
  const recent = await channel.messages.fetch({ limit: 20 });
  const msg = recent.find((m) => m.author.id === guild.client.user.id && m.attachments.some((a) => a.name === NAME));
  if (!msg) return false;

  const data = JSON.parse(zlib.gunzipSync(await download(msg.attachments.find((a) => a.name === NAME).url)).toString());
  if (data.content) store.write(store.FILES.content, data.content);
  if (data.settings) store.write(store.FILES.settings, data.settings);
  if (data.state) store.write(store.FILES.state, data.state);
  if (data.members) store.write(store.FILES.members, data.members);
  if (data.moderasi) store.write(store.FILES.moderasi, data.moderasi);
  if (data.komunitas) store.write(store.FILES.komunitas, data.komunitas);
  if (data.bursa) store.write(store.FILES.bursa, data.bursa);
  if (data.game) store.write(store.FILES.game, data.game);
  for (const a of msg.attachments.values()) {
    if (a.name.startsWith('asset-')) store.write(path.join(store.DIR, 'assets', a.name.slice(6)), await download(a.url));
  }
  members.reload();
  db.reloadAll();
  console.log(`Data dipulihkan dari cadangan di ${guild.name}`);
  return true;
}

module.exports = { run, restoreIfFresh, snapshot, ditahan: (guild) => ditahan.has(guild.id) };
