// Data komunitas (poll, giveaway, pengingat, AFK) di data/komunitas.json. Ditulis tertunda, disimpan juga lewat backup.
const store = require('../store');
const db = require('../db').open(store.FILES.komunitas, () => ({}));

function data() {
  const d = db.data;
  d.polls ??= {};
  d.giveaways ??= {};
  d.pengingat ??= [];
  d.afk ??= {};
  d.nextPengingat ??= 1;
  return d;
}

// Bersihkan poll / giveaway yang sudah selesai lebih dari 30 hari.
function prune(now = Date.now()) {
  const d = data();
  const old = now - 30 * 86400e3;
  for (const key of ['polls', 'giveaways']) {
    for (const [id, item] of Object.entries(d[key])) if (item.selesai && item.selesai < old) delete d[key][id];
  }
  db.save();
}

module.exports = { data, save: () => db.save(), flush: () => db.flush(), prune, db };
