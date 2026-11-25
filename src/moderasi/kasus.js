// Catatan kasus moderasi per server (peringatan, timeout, kick, ban, pesan DM, catatan internal).
// Disimpan di data/moderasi.json. Kasus tidak pernah dihapus: peringatan yang "dihapus" hanya ditandai supaya jejaknya tetap ada.
const store = require('../store');
const db = require('../db').open(store.FILES.moderasi, () => ({}));

const guildData = (guildId) => (db.data[guildId] ??= { next: 1, cases: [], locks: {} });

function add(guildId, data) {
  const d = guildData(guildId);
  const c = { id: d.next++, at: Date.now(), ...data };
  if (c.reason) c.reason = String(c.reason).slice(0, 1000);
  d.cases.push(c);
  db.save();
  return c;
}

// Batalkan kasus yang barusan dibuat tapi aksinya gagal (nomor dikembalikan kalau itu kasus terakhir).
function discard(guildId, id) {
  const d = guildData(guildId);
  const i = d.cases.findIndex((c) => c.id === Number(id));
  if (i < 0) return;
  d.cases.splice(i, 1);
  if (Number(id) === d.next - 1) d.next -= 1;
  db.save();
}

const get = (guildId, id) => guildData(guildId).cases.find((c) => c.id === Number(id)) ?? null;
const forUser = (guildId, userId) => guildData(guildId).cases.filter((c) => c.userId === userId).reverse();
const recent = (guildId, n = 15) => guildData(guildId).cases.slice(-n).reverse();
const total = (guildId) => guildData(guildId).cases.length;

function update(guildId, id, patch) {
  const c = get(guildId, id);
  if (!c) return null;
  Object.assign(c, patch);
  db.save();
  return c;
}

// Peringatan yang masih dihitung: belum dihapus dan (kalau ada batas kedaluwarsa) belum lewat.
function activeWarns(guildId, userId, expireDays = 0, now = Date.now()) {
  const cutoff = expireDays > 0 ? now - expireDays * 86400e3 : 0;
  return guildData(guildId).cases.filter((c) => c.userId === userId && c.type === 'warn' && !c.removed && c.at >= cutoff);
}

function removeWarn(guildId, id, by, why) {
  const c = get(guildId, id);
  if (!c) return { error: 'notfound' };
  if (c.type !== 'warn') return { error: 'type' };
  if (c.removed) return { error: 'done' };
  c.removed = { by: by.id, byName: by.tag ?? by.username, at: Date.now(), why: why ? String(why).slice(0, 300) : null };
  db.save();
  return { case: c };
}

// Hitungan ringkas untuk tombol "Kasus moderasi" di panel.
function summary(guildId, days = 7) {
  const cutoff = Date.now() - days * 86400e3;
  const out = { total: 0, byType: {} };
  for (const c of guildData(guildId).cases) {
    if (c.at < cutoff) continue;
    out.total += 1;
    out.byType[c.type] = (out.byType[c.type] ?? 0) + 1;
  }
  return out;
}

// Kunci channel: simpan keadaan izin @everyone sebelumnya supaya "unlock" mengembalikan persis seperti semula.
const lockOf = (guildId, channelId) => guildData(guildId).locks[channelId];
function setLock(guildId, channelId, prev) {
  const d = guildData(guildId);
  if (prev === undefined) delete d.locks[channelId];
  else d.locks[channelId] = prev;
  db.save();
}

const flush = () => db.flush();

module.exports = { add, discard, get, forUser, recent, total, update, activeWarns, removeWarn, summary, lockOf, setLock, flush, db };
