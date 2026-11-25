const { PermissionFlagsBits: P } = require('discord.js');

// Role yang punya izin ini tidak boleh dibagi otomatis (take role, kembalikan role).
const DANGEROUS = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.KickMembers, P.BanMembers,
  P.ManageWebhooks, P.ModerateMembers, P.ManageMessages, P.MentionEveryone,
];

// Aman dibagi = bukan role bot / @everyone, posisinya di bawah role bot, dan tanpa izin berbahaya.
function isSafeRole(guild, role) {
  if (!role || role.managed || role.id === guild.id) return false;
  const me = guild.members.me;
  if (!me || role.position >= me.roles.highest.position) return false;
  return !DANGEROUS.some((flag) => role.permissions.has(flag));
}

module.exports = { DANGEROUS, isSafeRole };
