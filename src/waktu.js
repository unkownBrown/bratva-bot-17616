// Bantuan waktu: baca durasi ketikan ("30m", "2j", "1d 12j") dan tulis durasi dalam bahasa Indonesia.
const SATUAN = {
  s: 1e3, dtk: 1e3, detik: 1e3,
  m: 60e3, mnt: 60e3, menit: 60e3,
  j: 3600e3, jam: 3600e3, h: 3600e3,
  d: 86400e3, hari: 86400e3,
  w: 604800e3, mgg: 604800e3, minggu: 604800e3,
};

// "30m" -> 1800000, "1j30m" -> 5400000, "2 hari" -> 172800000. Angka tanpa satuan, atau teks lain, dianggap tidak valid (null).
function parseDurasi(text) {
  const t = String(text ?? '').toLowerCase().replace(/,/g, '.').trim();
  if (!t) return null;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let total = 0;
  let rest = t;
  for (const m of t.matchAll(re)) {
    const unit = SATUAN[m[2]];
    if (!unit) return null;
    total += Number(m[1]) * unit;
    rest = rest.replace(m[0], '');
  }
  if (rest.replace(/[\s+]|dan/g, '') !== '') return null;
  return total > 0 && Number.isFinite(total) ? Math.round(total) : null;
}

// 5400000 -> "1 jam 30 menit". Paling banyak dua satuan terbesar.
function formatDurasi(ms) {
  let s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return '0 detik';
  const parts = [];
  for (const [label, size] of [['hari', 86400], ['jam', 3600], ['menit', 60], ['detik', 1]]) {
    const n = Math.floor(s / size);
    if (n) {
      parts.push(`${n} ${label}`);
      s -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

module.exports = { parseDurasi, formatDurasi, SATUAN };
