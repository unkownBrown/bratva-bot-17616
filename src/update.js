const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const store = require('./store');
const runtime = require('./runtime');

const ROOT = path.join(__dirname, '..');
const ROLLBACK = path.join(store.DIR, 'rollback');
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 12 * 1024 * 1024;
const MAX_FILES = 300;

// Hanya file kode bot yang boleh ditimpa. data/, .env, dan node_modules tidak pernah disentuh.
const FILES = new Set([
  'index.js', 'package.json', 'package-lock.json', 'README.md', 'HOSTING.md', 'CARA-UPDATE.txt', 'Dockerfile', 'Procfile',
  '.dockerignore', '.gitignore', '.env.example', 'install.bat', 'start.bat', 'update.bat', 'autostart.bat',
  'netlify.toml', 'NETLIFY.md', '.nvmrc',
]);
const DIRS = ['src/', 'deploy/', 'netlify/'];
const allowed = (rel) => FILES.has(rel) || DIRS.some((d) => rel.startsWith(d));

const versionNow = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function blocked() {
  if (process.env.BRV_EMBEDDED) return 'Bot ini jalan di Netlify, filenya hilang tiap bot dinyalakan ulang. Update dengan deploy ulang proyeknya (lihat NETLIFY.md).';
  if (process.env.DISABLE_SELF_UPDATE) return 'Update lewat Discord dimatikan di hosting ini (DISABLE_SELF_UPDATE).';
  return null;
}

// Baca zip, tolak yang berbahaya atau rusak. Hasilnya: daftar file kode yang sah.
function inspect(buffer) {
  let entries;
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch {
    throw new Error('File ini bukan zip yang valid.');
  }
  if (entries.length > MAX_FILES * 3) throw new Error('Isi zip terlalu banyak.');

  const files = new Map();
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let rel = entry.entryName.replace(/\\/g, '/');
    if (rel.startsWith('bratva-bot/')) rel = rel.slice('bratva-bot/'.length);
    if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..')) throw new Error(`Zip ditolak: ada path berbahaya (${rel}).`);
    if (!allowed(rel)) continue;
    const data = entry.getData();
    if (data.length > MAX_FILE) throw new Error(`Zip ditolak: ${rel} terlalu besar.`);
    total += data.length;
    if (total > MAX_TOTAL || files.size >= MAX_FILES) throw new Error('Zip ditolak: ukurannya tidak wajar buat update bot.');
    files.set(rel, data);
  }
  if (!files.has('index.js') || !files.has('package.json') || ![...files.keys()].some((f) => f.startsWith('src/'))) {
    throw new Error('Ini bukan file update bot ini (index.js, package.json, atau folder src tidak ada).');
  }
  let pkg;
  try {
    pkg = JSON.parse(files.get('package.json').toString());
  } catch {
    throw new Error('package.json di dalam zip rusak.');
  }
  if (pkg.name !== 'brv-panel-bot') throw new Error('Ini bukan file update bot ini (nama paketnya beda).');
  return { files, pkg };
}

// Cek sintaks semua file JavaScript baru di folder sementara, sebelum ada file asli yang diubah.
function syntaxCheck(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brv-check-'));
  try {
    for (const [rel, data] of files) {
      if (!/\.m?js$/.test(rel)) continue; // .mjs = berkas server Netlify
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      try {
        execFileSync(process.execPath, ['--check', target], { stdio: 'pipe', timeout: 20000 });
      } catch (err) {
        throw new Error(`Update ditolak: ${rel} ada kesalahan penulisan. ${String(err.stderr ?? '').split('\n').find((l) => /Error/.test(l)) ?? ''}`.trim());
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function backupCurrent(files) {
  const dir = path.join(ROLLBACK, String(Date.now()));
  const manifest = { existed: [], created: [] };
  for (const rel of files.keys()) {
    const target = path.join(ROOT, rel);
    if (fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.copyFileSync(target, path.join(dir, rel));
      manifest.existed.push(rel);
    } else {
      manifest.created.push(rel);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const old = fs.readdirSync(ROLLBACK).sort().slice(0, -3); // simpan 3 terakhir
  for (const name of old) fs.rmSync(path.join(ROLLBACK, name), { recursive: true, force: true });
  return dir;
}

function writeFiles(files) {
  for (const [rel, data] of files) {
    const target = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.new`, data);
    fs.renameSync(`${target}.new`, target);
  }
}

const npmInstall = () => new Promise((resolve, reject) => {
  execFile('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ROOT, timeout: 240000, shell: process.platform === 'win32' }, (err, _out, stderr) => {
    if (err) reject(new Error(`npm install gagal: ${String(stderr || err.message).slice(0, 300)}`));
    else resolve();
  });
});

const latestRollback = () => {
  try {
    return fs.readdirSync(ROLLBACK).filter((n) => fs.existsSync(path.join(ROLLBACK, n, 'manifest.json'))).sort().at(-1) ?? null;
  } catch {
    return null;
  }
};
const hasRollback = () => Boolean(latestRollback());

function restoreFrom(name) {
  const dir = path.join(ROLLBACK, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const rel of manifest.existed) fs.copyFileSync(path.join(dir, rel), path.join(ROOT, rel));
  for (const rel of manifest.created) fs.rmSync(path.join(ROOT, rel), { force: true });
}

// Terapkan update. Kalau ada yang gagal setelah file ditimpa, versi lama dikembalikan otomatis.
async function apply(buffer) {
  const reason = blocked();
  if (reason) throw new Error(reason);
  const { files, pkg } = inspect(buffer);
  syntaxCheck(files);

  const from = versionNow();
  const oldDeps = JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies ?? {});
  const dir = backupCurrent(files);
  try {
    writeFiles(files);
    const depsChanged = JSON.stringify(pkg.dependencies ?? {}) !== oldDeps;
    if (depsChanged) await npmInstall();
    return { from, to: pkg.version, count: files.size, npm: depsChanged };
  } catch (err) {
    restoreFrom(path.basename(dir));
    throw new Error(`${err.message} Versi lama sudah dikembalikan.`);
  }
}

function rollback() {
  const name = latestRollback();
  if (!name) throw new Error('Belum ada versi sebelumnya yang tersimpan.');
  const from = versionNow();
  restoreFrom(name);
  fs.rmSync(path.join(ROLLBACK, name), { recursive: true, force: true });
  return { from, to: versionNow() };
}

const restart = () => runtime.requestRestart();

module.exports = { inspect, syntaxCheck, apply, rollback, hasRollback, versionNow, blocked, restart };
