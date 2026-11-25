const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const store = require('./store');
const safety = require('./safety');

const BUTTON_LIMIT = 10; // sampai 10 role tampil sebagai tombol, lebih dari itu jadi dropdown
const MAX_ROLES = 25;

const menuOf = (guildId, key, state = store.loadState()) => state.roleMenus[guildId]?.[key] ?? null;

// Role pilihan admin yang masih ada dan masih aman, urut sesuai pilihan.
function activeRoles(guild, key, state) {
  const menu = menuOf(guild.id, key, state);
  if (!menu) return [];
  return menu.roleIds.map((id) => guild.roles.cache.get(id)).filter((r) => r && safety.isSafeRole(guild, r));
}

// Tombol (atau dropdown) yang ditempel di bawah pesan panel. Kosong kalau belum ada role dipilih.
function rows(guild, key, state) {
  const roles = activeRoles(guild, key, state);
  if (!roles.length) return [];
  if (roles.length <= BUTTON_LIMIT) {
    const out = [];
    for (let i = 0; i < roles.length; i += 5) {
      out.push(new ActionRowBuilder().addComponents(roles.slice(i, i + 5).map((r) =>
        new ButtonBuilder().setCustomId(`role:${key}:${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
    }
    return out;
  }
  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`role:${key}`).setPlaceholder('Pilih role buat diambil / dicopot')
      .addOptions(roles.slice(0, MAX_ROLES).map((r) => ({ label: r.name.slice(0, 100), value: r.id }))),
  )];
}

// Ikut dihitung di sidik jari panel: ganti role atau nama role = panel diedit otomatis.
function signature(guild, key, state) {
  const menu = menuOf(guild.id, key, state);
  return menu ? JSON.stringify(activeRoles(guild, key, state).map((r) => [r.id, r.name])) : '';
}

function update(guildId, key, patch) {
  const state = store.loadState();
  const all = (state.roleMenus[guildId] ??= {});
  all[key] = { roleIds: [], exclusive: false, ...all[key], ...patch };
  store.saveState(state);
  return all[key];
}

module.exports = { MAX_ROLES, BUTTON_LIMIT, menuOf, activeRoles, rows, signature, update };
