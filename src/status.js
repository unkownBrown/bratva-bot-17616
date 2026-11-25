const { ActivityType } = require('discord.js');
const store = require('./store');
const boards = require('./boards');
const runtime = require('./runtime');

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const info = { text: null, bioText: null, bioAt: 0, bioError: null, at: 0 };

// Jumlah online diambil dari hitungan perkiraan Discord (tanpa intent tambahan, bisa selisih sedikit).
// {anggota} = jumlah orang yang punya role anggota (daftar role roster). Tanpa Server Members Intent, dipakai total member.
async function counts(guild) {
  let g = guild;
  try {
    g = await guild.client.guilds.fetch({ guild: guild.id, withCounts: true, force: true });
  } catch {
    // pakai data yang ada
  }
  const total = g.approximateMemberCount ?? g.memberCount ?? 0;
  const online = g.approximatePresenceCount ?? null;
  let anggota = total;
  if (runtime.features.members) {
    const people = new Set();
    for (const role of boards.trackedRoles(guild, store.loadSettings().roster.role)) {
      for (const m of role.members.values()) if (!m.user.bot) people.add(m.id);
    }
    anggota = people.size;
  }
  return { online, total, anggota };
}

const render = (template, c, guild) => String(template)
  .replaceAll('{online}', c.online ?? '?').replaceAll('{total}', c.total)
  .replaceAll('{anggota}', c.anggota).replaceAll('{server}', guild.name);

// Perbarui status bot (tulisan "Watching ..." di bawah namanya) dan, kalau dinyalakan, bio bot (About Me).
// Bio dibatasi: hanya diubah kalau teksnya berubah dan sudah lewat bioMenit, supaya tidak kena batas Discord.
async function refresh(client, { forceBio = false } = {}) {
  const cfg = store.loadSettings().status;
  const guild = client.guilds.cache.first();
  if (!guild || (!cfg.aktif && !cfg.bio)) return;
  const c = await counts(guild);

  if (cfg.aktif) {
    info.text = clip(render(cfg.teks, c, guild), 128);
    info.at = Date.now();
    client.user.setPresence({ activities: [{ name: info.text, type: ActivityType.Watching }], status: 'online' });
  }
  if (cfg.bio) {
    const text = clip(render(cfg.bioTeks, c, guild), 400);
    const due = forceBio || (text !== info.bioText && Date.now() - info.bioAt >= Math.max(5, cfg.bioMenit) * 60000);
    if (due) {
      try {
        await client.application.edit({ description: text });
        Object.assign(info, { bioText: text, bioAt: Date.now(), bioError: null });
      } catch (err) {
        Object.assign(info, { bioAt: Date.now(), bioError: err.message });
      }
    }
  }
}

function clear(client) {
  client.user?.setPresence({ activities: [], status: 'online' });
  info.text = null;
}

module.exports = { refresh, clear, counts, render, info };
