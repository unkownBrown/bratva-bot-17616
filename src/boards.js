const { EmbedBuilder } = require('discord.js');
const store = require('./store');
const panels = require('./panels');
const members = require('./members');
const runtime = require('./runtime');

const { ts, minutes } = runtime;
const MAX_CHARS = 5400; // batas Discord 6000 karakter embed per pesan

const embedLength = (e) => {
  const d = e.data;
  return (d.title?.length ?? 0) + (d.description?.length ?? 0) + (d.footer?.text?.length ?? 0)
    + (d.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
};

// Bagi embed ke beberapa pesan supaya tidak melewati batas Discord.
function pack(embeds) {
  const messages = [];
  let current = [];
  let size = 0;
  for (const e of embeds) {
    const len = embedLength(e);
    if (current.length && (current.length >= 10 || size + len > MAX_CHARS)) {
      messages.push(current);
      current = [];
      size = 0;
    }
    current.push(e);
    size += len;
  }
  if (current.length) messages.push(current);
  return messages.map((list) => ({ embeds: list, components: [], files: [] }));
}

// Role yang dilacak dicocokkan dari kata kunci di settings.json (nama role dengan hiasan tetap ketemu).
function trackedRoles(guild, keywords) {
  const seen = new Set();
  const out = [];
  for (const kw of keywords) {
    const want = panels.norm(kw);
    const role = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && !r.managed && panels.norm(r.name).includes(want))
      .sort((a, b) => panels.norm(a.name).length - panels.norm(b.name).length)[0];
    if (role && !seen.has(role.id)) {
      seen.add(role.id);
      out.push(role);
    }
  }
  return out;
}

function lines(rows, limit) {
  const out = [];
  let used = 0;
  for (const row of rows) {
    if (used + row.length + 1 > limit) {
      out.push(`+${rows.length - out.length} lainnya`);
      break;
    }
    out.push(row);
    used += row.length + 1;
  }
  return out.join('\n');
}

function renderRoster(guild) {
  const settings = store.loadSettings();
  const accent = panels.asColor(store.loadContent().meta.warna);
  const roles = trackedRoles(guild, settings.roster.role);
  const embeds = [new EmbedBuilder().setColor(accent).setTitle('LIST ANGGOTA')
    .setDescription(`Total di server: **${guild.memberCount}**\nDiperbarui otomatis ${ts(Date.now())}`)];

  const shown = new Set(); // orang dengan beberapa role cuma muncul di role tertinggi dalam daftar
  for (const role of roles) {
    const people = [...role.members.values()]
      .filter((m) => !m.user.bot && !shown.has(m.id))
      .sort((a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0));
    people.forEach((m) => shown.add(m.id));
    const rows = people.map((m) => `<@${m.id}> · sejak ${ts(m.joinedTimestamp ?? Date.now(), 'd')}`);
    embeds.push(new EmbedBuilder().setColor(role.color || accent).setTitle(`${role.name} · ${people.length}`)
      .setDescription(rows.length ? lines(rows, 1800) : 'Belum ada.'));
  }
  return pack(embeds.slice(0, 10));
}

function renderActivity(guild) {
  const settings = store.loadSettings();
  const cfg = settings.aktivitas;
  const accent = panels.asColor(store.loadContent().meta.warna);
  const people = new Map();
  for (const role of trackedRoles(guild, settings.roster.role)) {
    for (const m of role.members.values()) if (!m.user.bot) people.set(m.id, m);
  }

  const rows = [...people.values()].map((m) => ({ m, p: members.get(guild.id, m.id) })).filter((r) => r.p);
  const scored = rows.map((r) => ({ ...r, s: members.recent(r.p, cfg.hari) })).filter((r) => r.s.msgs || r.s.voice)
    .sort((a, b) => (b.s.msgs + b.s.voice / 5) - (a.s.msgs + a.s.voice / 5)).slice(0, cfg.top);
  const top = scored.length
    ? lines(scored.map((r, i) => `**${i + 1}.** <@${r.m.id}> · ${r.s.msgs} pesan · ${minutes(r.s.voice)} voice`), 1800)
    : 'Belum ada aktivitas tercatat.';

  const embeds = [new EmbedBuilder().setColor(accent).setTitle(`PALING AKTIF · ${cfg.hari} HARI`).setDescription(top)
    .setFooter({ text: '1 pesan dihitung setara 5 menit voice buat urutan' })];

  const trackedDays = (Date.now() - members.since(guild.id)) / 86400e3;
  if (trackedDays < cfg.tidakAktifHari) {
    embeds.push(new EmbedBuilder().setColor(0x6b7280).setTitle('PERLU DICEK')
      .setDescription(`Data aktivitas baru terkumpul ${Math.floor(trackedDays)} hari. Daftar anggota tidak aktif muncul setelah ${cfg.tidakAktifHari} hari data.`));
  } else {
    const limit = Date.now() - cfg.tidakAktifHari * 86400e3;
    const idle = rows
      .map((r) => ({ ...r, last: Math.max(r.p.lastActive || 0, r.m.joinedTimestamp ?? 0) }))
      .filter((r) => r.last < limit).sort((a, b) => a.last - b.last)
      .map((r) => `<@${r.m.id}> · ${r.p.lastActive ? `terakhir aktif ${ts(r.p.lastActive)}` : 'belum pernah terlihat aktif'}`);
    embeds.push(new EmbedBuilder().setColor(idle.length ? 0xd98a00 : 0x2e9e5b)
      .setTitle(`TIDAK AKTIF · ${cfg.tidakAktifHari}+ HARI`)
      .setDescription(idle.length ? lines(idle, 1800) : 'Semua anggota aktif.')
      .setFooter({ text: `Diperbarui otomatis` }).setTimestamp());
  }
  return pack(embeds);
}

async function refreshBoard(guild, name, module, render) {
  const settings = store.loadSettings();
  if (!settings[module].aktif || !runtime.features.members) return;
  const channel = panels.moduleChannel(guild, module);
  if (!channel) return;
  const state = store.loadState();
  const key = `${guild.id}:${name}`;
  const saved = state.boards[key];
  const old = saved?.channelId === channel.id ? saved.messageIds ?? [] : [];
  try {
    const { ids } = await panels.upsert(channel, old, render(guild));
    const fresh = store.loadState();
    fresh.boards[key] = { channelId: channel.id, messageIds: ids };
    store.saveState(fresh);
  } catch (err) {
    console.error(`Gagal perbarui ${name} di ${guild.name}: ${err.message}`);
  }
}

const refreshRoster = (guild) => refreshBoard(guild, 'roster', 'roster', renderRoster);
const refreshActivity = (guild) => refreshBoard(guild, 'activity', 'aktivitas', renderActivity);
const refreshAll = async (guild) => {
  await refreshRoster(guild);
  await refreshActivity(guild);
};

module.exports = { renderRoster, renderActivity, refreshRoster, refreshActivity, refreshAll, trackedRoles, pack };
