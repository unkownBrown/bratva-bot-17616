const store = require('./store');

// Penyimpanan JSON kecil dengan tulis tertunda (supaya disk tidak ditulis tiap perubahan).
// Dipakai fitur moderasi (kasus) dan komunitas (poll, giveaway, pengingat, AFK).
const opened = new Set();

function open(file, init = () => ({})) {
  let data = null;
  let timer = null;
  let dirty = false;
  const api = {
    get data() {
      data ??= store.read(file, null) ?? init();
      return data;
    },
    reload() {
      clearTimeout(timer);
      timer = null;
      dirty = false;
      data = null;
    },
    save() {
      dirty = true;
      if (timer) return;
      timer = setTimeout(api.flush, 5000);
      timer.unref?.();
    },
    flush() {
      clearTimeout(timer);
      timer = null;
      if (!dirty || !data) return;
      dirty = false;
      store.write(file, data);
    },
  };
  opened.add(api);
  return api;
}

const flushAll = () => opened.forEach((d) => d.flush());
const reloadAll = () => opened.forEach((d) => d.reload());

module.exports = { open, flushAll, reloadAll };
