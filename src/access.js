const { PermissionFlagsBits: P } = require('discord.js');
const store = require('./store');

// Siapa yang boleh pakai bot: punya izin Manage Server, atau punya role pengelola yang kamu pilih sendiri di Pengaturan.
// Bot tidak membuat role atau channel apa pun sendiri.
function isManager(interaction) {
  if (interaction.memberPermissions?.has(P.ManageGuild)) return true;
  const roleId = store.loadState().access[interaction.guildId]?.roleId;
  if (!roleId) return false;
  const roles = interaction.member?.roles;
  return Array.isArray(roles) ? roles.includes(roleId) : Boolean(roles?.cache?.has(roleId));
}

// roleId null = hanya yang punya izin Manage Server.
function setManagerRole(guildId, roleId) {
  const state = store.loadState();
  state.access[guildId] = { ...(state.access[guildId] ?? {}), roleId: roleId ?? null };
  store.saveState(state);
}

module.exports = { isManager, setManagerRole };
