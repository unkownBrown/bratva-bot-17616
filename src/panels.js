const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder,
} = require('discord.js');
const store = require('./store');
const rolemenu = require('./rolemenu');
const forms = require('./forms');

const ASSETS = path.join(store.DIR, 'assets');
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const NO_ACCESS = [50001, 50013];

// "📋ıl rules・gangs" -> "lrulesgangs". Dipakai buat cocokin nama channel yang penuh simbol.
const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

const slug = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

const asText = (v) => (Array.isArray(v) ? v.join('\n') : String(v ?? ''));
const isUrl = (v) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());
const asColor = (v, fallback) => {
  const hex = String(v ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return parseInt(hex, 16);
  const fb = String(fallback ?? '8c1c1c').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(fb) ? parseInt(fb, 16) : 0x8c1c1c;
};

// ---------- gambar ----------

// Hanya file gambar yang ada langsung di folder assets. Nama dengan path ("../.env") ditolak.
function assetPath(name) {
  if (typeof name !== 'string' || !name || path.basename(name) !== name || !IMAGE_EXT.test(name)) return null;
  const full = path.join(ASSETS, name);
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

const isImageRef = (v) => isUrl(v) || Boolean(assetPath(typeof v === 'string' ? v.trim() : v));

// Link biasa dipakai apa adanya. Nama file di assets diunggah sebagai lampiran (attachment://), jadi tidak kedaluwarsa.
function imageRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const value = ref.trim();
  if (isUrl(value)) return { url: value };
  const full = assetPath(value);
  if (!full) return null;
  const name = value.replace(/[^\w.-]/g, '_');
  return { url: `attachment://${name}`, file: new AttachmentBuilder(fs.readFileSync(full), { name }) };
}

function listAssets() {
  try {
    return fs.readdirSync(ASSETS).filter((f) => IMAGE_EXT.test(f));
  } catch {
    return [];
  }
}

function saveAsset(slot, ext, buffer) {
  removeAsset(slot);
  store.write(path.join(ASSETS, `${slot}${ext}`), buffer);
}

function removeAsset(slot) {
  for (const f of listAssets()) {
    if (new RegExp(`^${slot}\\.(png|jpe?g|gif|webp)$`, 'i').test(f)) fs.unlinkSync(path.join(ASSETS, f));
  }
}

const assetSig = () =>
  listAssets().sort().map((f) => {
    const s = fs.statSync(path.join(ASSETS, f));
    return `${f}:${s.size}:${Math.floor(s.mtimeMs)}`;
  }).join('|');

// Sidik jari isi panel. Kalau tidak berubah, panel tidak perlu diedit lagi.
const hashOf = (panel, meta, menuSig = '') =>
  crypto.createHash('sha1').update(JSON.stringify([panel, meta.warna, meta.footer, meta.logo, meta.banner, assetSig(), menuSig])).digest('hex');

// ---------- channel ----------

function byName(guild, key) {
  const want = norm(key);
  if (!want) return null;
  const hits = [...guild.channels.cache.values()].filter(
    (c) => TEXT_TYPES.includes(c.type) && norm(c.name).endsWith(want),
  );
  hits.sort((a, b) => norm(a.name).length - norm(b.name).length);
  return hits[0] ?? null;
}

function findChannel(guild, key, state) {
  const bound = state.panels[key]?.channelId;
  const ch = bound && guild.channels.cache.get(bound);
  return ch || byName(guild, key);
}

// Channel untuk modul (logs / roster / aktivitas / backup): hasil bind manual, kalau tidak ada dicari dari nama.
// Backup juga bisa ditunjuk lewat environment variable BACKUP_CHANNEL_ID (berguna di hosting yang file-nya suka ke-reset:
// setelah reset, bot tetap tahu harus mengambil cadangan dari channel mana).
function moduleChannel(guild, mod, state = store.loadState(), settings = store.loadSettings()) {
  const bound = state.modules[mod]?.channelId;
  const ch = bound && guild.channels.cache.get(bound);
  if (ch) return ch;
  if (mod === 'backup' && process.env.BACKUP_CHANNEL_ID) {
    const fromEnv = guild.channels.cache.get(process.env.BACKUP_CHANNEL_ID.trim());
    if (fromEnv) return fromEnv;
  }
  return byName(guild, settings[mod].channel);
}

// ---------- teks & embed ----------

// Teks di content.json boleh pakai:
//   {server}          -> nama server
//   {#rules-gangs}    -> mention channel (dicari otomatis dari nama)
//   {@Nama Role}      -> mention role
function expand(text, guild, state) {
  return text
    .replaceAll('{server}', guild.name)
    .replace(/\{#([a-z0-9-]+)\}/gi, (_, key) => {
      const ch = findChannel(guild, key.toLowerCase(), state);
      return ch ? `<#${ch.id}>` : `#${key}`;
    })
    .replace(/\{@([^}]+)\}/g, (_, name) => {
      const role = guild.roles.cache.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
      return role ? `<@&${role.id}>` : `@${name}`;
    });
}

function buildMessage(msg, meta, guild, state, isLast) {
  const ex = (v) => expand(asText(v), guild, state);
  const embed = new EmbedBuilder().setColor(asColor(msg.color, meta.warna));

  if (msg.title) embed.setTitle(ex(msg.title).slice(0, 256));
  if (msg.description) embed.setDescription(ex(msg.description).slice(0, 4096));

  const fields = (msg.fields ?? []).slice(0, 25).map((f) => ({
    name: ex(f.name).slice(0, 256) || '\u200b',
    value: ex(f.value).slice(0, 1024) || '\u200b',
    inline: Boolean(f.inline),
  }));
  if (fields.length) embed.addFields(fields);

  // image / thumbnail milik pesan menang. false = tanpa gambar. Kosong = pakai meta.banner / meta.logo (kalau ada).
  const pick = (own, fallback) => (own === false ? null : own || fallback || null);
  const files = new Map();
  let hasImage = false;
  const banner = imageRef(pick(msg.image, meta.banner));
  if (banner) {
    embed.setImage(banner.url);
    hasImage = true;
    if (banner.file) files.set(banner.file.name, banner.file);
  }
  const logo = imageRef(pick(msg.thumbnail, meta.logo));
  if (logo) {
    embed.setThumbnail(logo.url);
    if (logo.file) files.set(logo.file.name, logo.file);
  }

  const footer = msg.footer ?? (isLast ? meta.footer : '');
  if (footer) embed.setFooter({ text: ex(footer).slice(0, 2048) });

  if (!msg.title && !msg.description && !fields.length && !hasImage) embed.setDescription('\u200b');

  const buttons = (msg.buttons ?? [])
    .filter((b) => b && b.label && isUrl(b.url))
    .slice(0, 5)
    .map((b) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(String(b.label).slice(0, 80)).setURL(b.url.trim()));
  const components = buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];

  return { embeds: [embed], components, files: [...files.values()] };
}

// ---------- kirim / edit pesan ----------

// Edit pesan lama kalau masih ada, kirim baru kalau hilang. Pesan lama yang kelebihan dihapus.
async function upsert(channel, oldIds, payloads) {
  const ids = [];
  let sent = 0;
  let edited = 0;
  try {
    for (let i = 0; i < payloads.length; i++) {
      let message = null;
      if (oldIds[i]) {
        message = await channel.messages.fetch(oldIds[i]).then((m) => m.edit({ ...payloads[i], attachments: [] })).catch(() => null);
        if (message) edited++;
      }
      if (!message) {
        message = await channel.send(payloads[i]);
        sent++;
      }
      ids.push(message.id);
    }
  } catch (err) {
    err.partial = [...ids, ...oldIds.slice(ids.length)];
    throw err;
  }
  for (const id of oldIds.slice(payloads.length)) await channel.messages.delete(id).catch(() => {});
  return { ids, sent, edited };
}

// Kirim panel ke channelnya. Sudah pernah diposting = pesan lama di-edit (tidak dobel).
// skipUnchanged: lewati kalau isinya sama persis dengan yang sudah terposting.
async function publish(guild, key, { force = false, skipUnchanged = false } = {}) {
  const content = store.loadContent();
  const panel = content.panels[key];
  if (!panel) return { key, status: 'unknown' };
  if (panel.draft && !force) return { key, status: 'draft' };

  const state = store.loadState();
  const channel = findChannel(guild, key, state);
  if (!channel) return { key, status: 'missing' };

  const saved = state.panels[key];
  const sameChannel = saved?.channelId === channel.id;
  const oldIds = sameChannel ? saved.messageIds ?? [] : [];
  const hash = hashOf(panel, content.meta, `${rolemenu.signature(guild, key, state)}|${forms.signature(guild, key, state)}`);
  if (skipUnchanged && sameChannel && oldIds.length && saved.hash === hash) return { key, status: 'same', channel };

  const msgs = panel.messages ?? [];
  const payloads = msgs.map((m, i) => buildMessage(m, content.meta, guild, state, i === msgs.length - 1));
  // Role menu (take role): tombol dipasang di bawah pesan terakhir panel, teks panel tidak diubah.
  const extraRows = [...rolemenu.rows(guild, key, state), ...forms.rows(guild, key, state)];
  if (extraRows.length && payloads.length) {
    const last = payloads[payloads.length - 1];
    last.components = [...last.components, ...extraRows].slice(0, 5);
  }
  try {
    const { ids, sent, edited } = await upsert(channel, oldIds, payloads);
    state.panels[key] = { channelId: channel.id, messageIds: ids, hash };
    store.saveState(state);
    return { key, status: 'ok', channel, sent, edited };
  } catch (err) {
    state.panels[key] = { channelId: channel.id, messageIds: err.partial ?? oldIds };
    store.saveState(state);
    return { key, status: 'error', channel, error: err.message, noAccess: NO_ACCESS.includes(err.code), tooBig: err.code === 40005 };
  }
}

async function unpublish(guild, key) {
  const state = store.loadState();
  const saved = state.panels[key];
  const ch = saved && guild.channels.cache.get(saved.channelId);
  if (ch) for (const id of saved.messageIds ?? []) await ch.messages.delete(id).catch(() => {});
  delete state.panels[key];
  store.saveState(state);
}

async function warm(guild) {
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
}

// Samakan semua panel dengan content.json. Yang tidak berubah dilewati.
// all: true = edit ulang semua panel non-draft walau tidak berubah.
async function syncGuild(guild, { all = false, onlyPosted = false } = {}) {
  await warm(guild);
  const content = store.loadContent();
  const out = { ok: [], same: [], draft: [], missing: [], failed: [] };
  for (const key of Object.keys(content.panels)) {
    // onlyPosted: cuma perbarui panel yang sudah terposting, tidak memposting panel baru
    if (onlyPosted && !store.loadState().panels[key]?.messageIds?.length) continue;
    const r = await publish(guild, key, { skipUnchanged: !all });
    if (r.status === 'ok') out.ok.push(key);
    else if (r.status === 'same') out.same.push(key);
    else if (r.status === 'draft') out.draft.push(key);
    else if (r.status === 'missing') out.missing.push(key);
    else if (r.status === 'error') out.failed.push({ key, error: r.error, noAccess: r.noAccess, tooBig: r.tooBig });
  }
  return out;
}

module.exports = {
  norm, slug, asText, asColor, isUrl, TEXT_TYPES,
  assetPath, isImageRef, imageRef, listAssets, saveAsset, removeAsset,
  byName, findChannel, moduleChannel, buildMessage, upsert, publish, unpublish, warm, syncGuild,
};
