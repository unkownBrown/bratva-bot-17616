const store = require('./store');

// Data anggota disimpan per server di members.json (ditulis tertunda supaya tidak sering menulis disk).
let db = null;
let timer = null;
let dirty = false;

const WIB = 7 * 3600e3;
const dayKey = (t = Date.now()) => new Date(t + WIB).toISOString().slice(0, 10);

function load() {
  db ??= store.read(store.FILES.members, {});
  return db;
}

const reload = () => {
  db = store.read(store.FILES.members, {});
};

function guildData(guildId) {
  load();
  db[guildId] ??= { since: Date.now(), users: {} };
  return db[guildId];
}

function save() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(flush, 15000);
  timer.unref?.();
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!dirty || !db) return;
  dirty = false;
  store.write(store.FILES.members, db);
}

const hasGuild = (guildId) => Boolean(load()[guildId]);
const since = (guildId) => guildData(guildId).since;
const all = (guildId) => Object.values(guildData(guildId).users);
const get = (guildId, userId) => guildData(guildId).users[userId] ?? null;

function ensure(guildId, user) {
  const g = guildData(guildId);
  let p = g.users[user.id];
  if (!p) {
    p = g.users[user.id] = {
      id: user.id, name: user.tag ?? user.username, firstSeen: Date.now(),
      joinCount: 0, leaveCount: 0, joins: [], leaves: [], nicks: [], roleIds: [], nick: null,
      msgs: 0, voice: 0, days: {}, lastActive: 0, inGuild: false, invitedBy: null, seeded: false,
    };
    save();
  }
  p.name = user.tag ?? user.username ?? p.name;
  return p;
}

function addActivity(guildId, user, { msgs = 0, voice = 0 }) {
  const p = ensure(guildId, user);
  const key = dayKey();
  const d = (p.days[key] ??= [0, 0]);
  d[0] += msgs;
  d[1] += voice;
  p.msgs += msgs;
  p.voice += voice;
  p.lastActive = Date.now();
  const cutoff = dayKey(Date.now() - 40 * 86400e3);
  for (const k of Object.keys(p.days)) if (k < cutoff) delete p.days[k];
  save();
}

// Jumlah pesan dan menit voice dalam N hari terakhir.
function recent(p, days) {
  const cutoff = dayKey(Date.now() - (days - 1) * 86400e3);
  let msgs = 0;
  let voice = 0;
  for (const [k, [m, v]] of Object.entries(p.days)) {
    if (k >= cutoff) {
      msgs += m;
      voice += v;
    }
  }
  return { msgs, voice };
}

module.exports = { load, reload, flush, save, hasGuild, since, all, get, ensure, addActivity, recent };
