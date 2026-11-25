// Status yang dipakai bersama oleh semua modul.
// Jadi false kalau intent-nya belum dinyalakan di Developer Portal (Server Members Intent / Message Content Intent).
const features = { members: true, content: true };

const timers = new Map();
// Jalankan fn sekali setelah ms, kalau dipanggil lagi sebelum itu hitungannya diulang.
function debounce(key, ms, fn) {
  clearTimeout(timers.get(key));
  const t = setTimeout(() => {
    timers.delete(key);
    Promise.resolve(fn()).catch((err) => console.error(`[${key}] ${err.message}`));
  }, ms);
  t.unref?.();
  timers.set(key, t);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

// Waktu tetap dalam WIB (tidak tergantung zona waktu yang melihat), contoh: 21 Okt 2026 06.18.32 WIB
const wibFormat = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const wib = (ms = Date.now()) => `${wibFormat.format(ms)} WIB`;

function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} hari${h ? ` ${h} jam` : ''}`;
  if (h) return `${h} jam${m ? ` ${m} menit` : ''}`;
  return `${Math.max(m, 1)} menit`;
}

const minutes = (min) => (min >= 60 ? `${Math.floor(min / 60)}j ${min % 60}m` : `${min}m`);

// Dipasang oleh index.js: simpan data lalu keluar dengan kode 42. Penjaga (start.bat / systemd / hosting) menyalakan bot lagi.
const hooks = { restart: () => process.exit(42) };
const requestRestart = () => hooks.restart();

module.exports = { hooks, requestRestart, features, debounce, sleep, ts, wib, duration, minutes };
