const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AuditLogEvent, MessageFlags,
} = require('discord.js');
const store = require('./store');
const panels = require('./panels');
const members = require('./members');
const runtime = require('./runtime');
const safety = require('./safety');
const akses = require('./akses');

const { ts, duration, sleep } = runtime;

const roleIdsOf = (member) => [...member.roles.cache.keys()].filter((id) => id !== member.guild.id);

function roleNames(guild, ids) {
  const names = ids.map((id) => guild.roles.cache.get(id)?.name).filter(Boolean);
  return names.length ? names.join(', ').slice(0, 1000) : '-';
}

async function send(guild, payload) {
  try {
    const ch = panels.moduleChannel(guild, 'logs');
    if (ch) await ch.send(payload);
  } catch (err) {
    console.error(`Gagal kirim log di ${guild.name}: ${err.message}`);
  }
}

// ---------- invite ----------

const inviteCache = new Map(); // guildId -> Map(code -> { uses, inviterId })

async function fetchInvites(guild) {
  const list = await guild.invites.fetch();
  return new Map(list.map((i) => [i.code, { uses: i.uses ?? 0, inviterId: i.inviter?.id ?? null }]));
}

async function snapshotInvites(guild) {
  try {
    inviteCache.set(guild.id, await fetchInvites(guild));
  } catch {
    inviteCache.delete(guild.id);
  }
}

// Cari invite mana yang dipakai: yang jumlah pakainya naik, atau yang baru saja habis.
async function detectInvite(guild) {
  const before = inviteCache.get(guild.id);
  if (!before) return null;
  try {
    const after = await fetchInvites(guild);
    inviteCache.set(guild.id, after);
    for (const [code, v] of after) if (v.uses > (before.get(code)?.uses ?? 0)) return { code, inviterId: v.inviterId };
    const gone = [...before.keys()].filter((code) => !after.has(code));
    return gone.length === 1 ? { code: gone[0], inviterId: before.get(gone[0]).inviterId } : null;
  } catch {
    return null;
  }
}

// ---------- audit log ----------

async function audit(guild, types, targetId) {
  await sleep(1500);
  try {
    for (const type of types) {
      const logs = await guild.fetchAuditLogs({ type, limit: 6 });
      const e = logs.entries.find((x) => x.target?.id === targetId && Date.now() - x.createdTimestamp < 20000);
      if (e) return { type, by: e.executor, reason: e.reason };
    }
  } catch {
    // tidak ada izin View Audit Log: abaikan
  }
  return null;
}

// ---------- raid ----------

const recentJoins = new Map();
const lastRaidAlert = new Map();

function raidCount(guild, cfg) {
  if (!cfg.logs.raid.aktif) return 0;
  const now = Date.now();
  const list = (recentJoins.get(guild.id) ?? []).filter((t) => now - t < cfg.logs.raid.detik * 1000);
  list.push(now);
  recentJoins.set(guild.id, list);
  if (list.length >= cfg.logs.raid.jumlah && now - (lastRaidAlert.get(guild.id) ?? 0) > 10 * 60e3) {
    lastRaidAlert.set(guild.id, now);
    return list.length;
  }
  return 0;
}

// ---------- event ----------

async function onAdd(member, { silent = false } = {}) {
  const { guild } = member;
  const cfg = store.loadSettings();
  const p = members.ensure(guild.id, member.user);
  const returning = p.joinCount > 0;
  const lastLeave = p.leaves.at(-1);

  p.joinCount += 1;
  p.joins = [...p.joins, member.joinedTimestamp ?? Date.now()].slice(-10);
  p.inGuild = true;
  p.seeded = true;
  p.roleIds = roleIdsOf(member);
  p.nick = member.nickname ?? null;

  const inv = !silent && cfg.logs.invite ? await detectInvite(guild) : null;
  if (inv?.inviterId) p.invitedBy = inv.inviterId;
  members.save();
  if (silent || !cfg.logs.aktif) return;

  const created = member.user.createdTimestamp;
  const fresh = Date.now() - created < cfg.logs.akunBaruHari * 86400e3;
  const embed = new EmbedBuilder()
    .setColor(fresh ? 0xd98a00 : returning ? 0x3b82f6 : 0x2e9e5b)
    .setTitle(returning ? 'MEMBER MASUK KEMBALI' : 'MEMBER MASUK')
    .setDescription(`${member} · ${member.user.tag}`)
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Akun dibuat', value: ts(created, 'D'), inline: true },
      { name: 'Masuk ke-', value: String(p.joinCount), inline: true },
      { name: 'Total anggota', value: String(guild.memberCount), inline: true },
    )
    .setFooter({ text: `ID ${member.id}` });
  if (inv) {
    embed.addFields({ name: 'Diundang oleh', value: `${inv.inviterId ? `<@${inv.inviterId}>` : 'tidak diketahui'} · kode \`${inv.code}\`` });
  }
  if (returning && lastLeave) {
    embed.addFields({
      name: 'Riwayat',
      value: `Terakhir keluar ${ts(lastLeave.at)}.\nRole sebelumnya: ${roleNames(guild, lastLeave.roleIds)}`.slice(0, 1024),
    });
  }
  if (fresh) embed.addFields({ name: 'Perlu dicek', value: `Akun baru, umurnya ${duration(Date.now() - created)}.` });

  const components = [];
  if (returning && lastLeave?.roleIds?.length) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`restore:${member.id}`).setLabel('Kembalikan role sebelumnya').setStyle(ButtonStyle.Secondary),
    ));
  }
  await send(guild, { embeds: [embed], components });

  const burst = raidCount(guild, cfg);
  if (burst) {
    const roleId = store.loadState().access[guild.id]?.roleId;
    await send(guild, {
      content: roleId ? `<@&${roleId}>` : undefined,
      allowedMentions: { roles: roleId ? [roleId] : [] },
      embeds: [new EmbedBuilder().setColor(0xb91c1c).setTitle('LONJAKAN MEMBER MASUK')
        .setDescription(`**${burst}** akun masuk dalam ${cfg.logs.raid.detik} detik. Cek apakah ini wajar.`)],
    });
  }
  runtime.debounce(`roster:${guild.id}`, 5000, () => require('./boards').refreshRoster(guild));
}

async function onRemove(member, { silent = false, unknownTime = false } = {}) {
  const { guild } = member;
  const cfg = store.loadSettings();
  const p = members.get(guild.id, member.id) ?? members.ensure(guild.id, member.user);
  const now = Date.now();
  const roleIds = member.roles?.cache?.size > 1 ? roleIdsOf(member) : p.roleIds ?? [];
  const joined = member.joinedTimestamp ?? p.joins.at(-1) ?? null;

  p.inGuild = false;
  p.leaveCount += 1;
  p.leaves = [...p.leaves, { at: now, roleIds }].slice(-10);
  members.save();
  if (silent || !cfg.logs.aktif) return;

  const why = unknownTime ? null : await audit(guild, [AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd], member.id);
  const banned = why?.type === AuditLogEvent.MemberBanAdd;
  const embed = new EmbedBuilder()
    .setColor(banned ? 0x7f1d1d : 0xdc2626)
    .setTitle(banned ? 'MEMBER DI-BAN' : why ? 'MEMBER DI-KICK' : 'MEMBER KELUAR')
    .setDescription(`<@${member.id}> · ${member.user.tag}`)
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `ID ${member.id}` });
  embed.addFields(
    { name: 'Lama di server', value: joined ? duration(now - joined) : '-', inline: true },
    { name: 'Keluar ke-', value: String(p.leaveCount), inline: true },
    { name: 'Total anggota', value: String(guild.memberCount), inline: true },
    { name: 'Role terakhir', value: roleNames(guild, roleIds) },
  );
  if (why) embed.addFields({ name: 'Oleh', value: `${why.by ? `<@${why.by.id}>` : '-'}${why.reason ? `\nAlasan: ${why.reason}` : ''}`.slice(0, 1024) });
  if (unknownTime) embed.addFields({ name: 'Catatan', value: 'Keluar waktu bot sedang mati. Waktu pastinya tidak diketahui.' });
  else if (joined && now - joined < cfg.logs.keluarCepatJam * 3600e3) {
    embed.addFields({ name: 'Perlu dicek', value: `Keluar kurang dari ${cfg.logs.keluarCepatJam} jam setelah masuk.` });
  }
  await send(guild, { embeds: [embed] });
  runtime.debounce(`roster:${guild.id}`, 5000, () => require('./boards').refreshRoster(guild));
}

async function onUpdate(oldMember, member) {
  const { guild } = member;
  const cfg = store.loadSettings();
  const p = members.ensure(guild.id, member.user);
  const current = roleIdsOf(member);
  const nick = member.nickname ?? null;

  if (!p.seeded) {
    Object.assign(p, { seeded: true, roleIds: current, nick, inGuild: true });
    members.save();
    return;
  }
  const added = current.filter((id) => !p.roleIds.includes(id));
  const removed = p.roleIds.filter((id) => !current.includes(id));
  const nickChanged = (p.nick ?? null) !== nick;
  const oldNick = p.nick;
  p.roleIds = current;
  p.nick = nick;
  if (nickChanged) p.nicks = [...p.nicks, { at: Date.now(), from: oldNick, to: nick }].slice(-10);
  members.save();
  if (!added.length && !removed.length && !nickChanged) return;

  if (added.length || removed.length) runtime.debounce(`roster:${guild.id}`, 5000, () => require('./boards').refreshRoster(guild));
  if (added.length) akses.onRolesAdded(member, added).catch((err) => console.error(`Arahan role: ${err.message}`));
  if (!cfg.logs.aktif) return;

  const embed = new EmbedBuilder().setColor(0x3b82f6)
    .setTitle(added.length || removed.length ? 'ROLE BERUBAH' : 'NICKNAME BERUBAH')
    .setDescription(`${member} · ${member.user.tag}`)
    .setFooter({ text: `ID ${member.id}` });
  if (added.length) embed.addFields({ name: 'Ditambah', value: roleNames(guild, added), inline: true });
  if (removed.length) embed.addFields({ name: 'Dicopot', value: roleNames(guild, removed), inline: true });
  if (nickChanged) embed.addFields({ name: 'Nickname', value: `${oldNick ?? '(kosong)'} → ${nick ?? '(kosong)'}` });
  if (added.length || removed.length) {
    const who = await audit(guild, [AuditLogEvent.MemberRoleUpdate], member.id);
    if (who?.by) embed.addFields({ name: 'Oleh', value: `<@${who.by.id}>` });
  }
  await send(guild, { embeds: [embed] });
}

// Samakan data dengan kondisi sekarang waktu bot menyala: catat yang masuk / keluar saat bot mati.
async function catchUp(guild) {
  const hadData = members.hasGuild(guild.id);
  const list = await guild.members.fetch();
  const present = new Set(list.keys());

  for (const m of list.values()) {
    if (m.user.bot) continue;
    const p = members.get(guild.id, m.id);
    if (!p || !p.inGuild) {
      await onAdd(m, { silent: !hadData });
    } else {
      Object.assign(p, { name: m.user.tag, roleIds: roleIdsOf(m), nick: m.nickname ?? null, seeded: true });
    }
  }
  if (hadData) {
    for (const p of members.all(guild.id)) {
      if (p.inGuild && !present.has(p.id)) {
        const user = await guild.client.users.fetch(p.id).catch(() => null);
        await onRemove({ guild, id: p.id, user: user ?? { id: p.id, tag: p.name, displayAvatarURL: () => null }, roles: null, joinedTimestamp: null }, { unknownTime: true });
      }
    }
  }
  members.save();
}

// Tombol "Kembalikan role sebelumnya" di log masuk kembali.
async function restoreRoles(interaction, userId) {
  const guild = interaction.guild;
  const last = members.get(guild.id, userId)?.leaves?.at(-1);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || !last) return interaction.reply({ content: 'Orangnya sudah tidak ada di server atau datanya tidak ada.', flags: MessageFlags.Ephemeral });

  const ok = [];
  const skipped = [];
  for (const id of last.roleIds) {
    const role = guild.roles.cache.get(id);
    if (!role || member.roles.cache.has(id)) continue;
    (safety.isSafeRole(guild, role) ? ok : skipped).push(role);
  }
  if (ok.length) await member.roles.add(ok, `Dikembalikan oleh ${interaction.user.tag}`);

  await interaction.update({ components: [] });
  const text = [
    ok.length ? `Role dikembalikan: ${ok.map((r) => r.name).join(', ')}` : 'Tidak ada role yang bisa dikembalikan.',
    skipped.length ? `Dilewati (role khusus / di atas bot): ${skipped.map((r) => r.name).join(', ')}` : null,
  ].filter(Boolean).join('\n');
  await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
}

module.exports = { onAdd, onRemove, onUpdate, catchUp, restoreRoles, snapshotInvites, audit };
