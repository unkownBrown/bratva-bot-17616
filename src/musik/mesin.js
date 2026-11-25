// Mesin audio: ffmpeg mengubah apa pun jadi Ogg Opus 48 kHz yang langsung bisa dikirim ke voice Discord.
//  - Mode "langsung": ffmpeg membaca alamat stream dari yt-dlp (cepat, bisa loncat ke menit tertentu).
//  - Mode "pipa": yt-dlp yang mengunduh dan mengalirkan ke ffmpeg (cadangan kalau alamat langsung ditolak, mis. 403).
const { spawn } = require('node:child_process');
const alat = require('./alat');

const FORMAT = 'bestaudio[acodec=opus]/bestaudio/best';
const WHITELIST = 'http,https,tcp,tls,crypto'; // ffmpeg tidak boleh membuka file lokal lewat playlist buatan orang

function headerString(headers) {
  return Object.entries(headers ?? {})
    .filter(([k, v]) => !/^accept-encoding$/i.test(k) && !/[\r\n]/.test(`${k}${v}`))
    .map(([k, v]) => `${k}: ${v}\r\n`).join('');
}

// Susunan argumen ffmpeg. Fungsi murni supaya gampang dites.
function ffmpegArgs({ input, headers, startMs = 0, volume = 100, direct = true }) {
  const a = ['-hide_banner', '-loglevel', 'warning', '-nostdin'];
  if (direct) {
    if (!/^https?:\/\//i.test(input)) throw new Error('Alamat audio tidak valid.');
    a.push('-protocol_whitelist', WHITELIST, '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
    const h = headerString(headers);
    if (h) a.push('-headers', h);
  }
  if (startMs > 0) a.push('-ss', (startMs / 1000).toFixed(3));
  a.push('-i', input, '-vn', '-sn', '-dn');
  if (volume !== 100) a.push('-af', `volume=${(volume / 100).toFixed(2)}`);
  a.push('-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-vbr', 'on', '-application', 'audio', '-frame_duration', '20', '-f', 'ogg', 'pipe:1');
  return a;
}

// Mulai satu saluran audio. Hasil: { stream, kill(), tail(), closed, code() }
function launch({ track, startMs = 0, volume = 100, mode = 'langsung', ffmpegBin = alat.ffmpeg(), local = null }) {
  if (!ffmpegBin) throw new Error('ffmpeg tidak ditemukan.');
  const direct = mode === 'langsung';
  const args = ffmpegArgs({
    input: local ?? (direct ? track.stream.url : 'pipe:0'), headers: track.stream?.headers, startMs, volume, direct: local ? false : direct,
  });
  const ff = spawn(ffmpegBin, args, { windowsHide: true, stdio: [direct || local ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  alat.children.add(ff);

  let dl = null;
  if (!direct && !local) {
    dl = alat.spawnStream(['-f', FORMAT, '-o', '-', '--quiet', '--no-playlist', track.url]);
    dl.stdout.pipe(ff.stdin);
    dl.stdout.on('error', () => {});
    ff.stdin.on('error', () => {}); // EPIPE waktu ffmpeg dimatikan, wajar
  }

  let stderr = '';
  const onErr = (d) => { stderr = (stderr + d).slice(-1500); };
  ff.stderr.on('data', onErr);
  dl?.stderr.on('data', onErr);
  ff.stdout.on('error', () => {});

  let exit = null;
  const closed = new Promise((resolve) => {
    ff.once('close', (code, signal) => {
      exit = code ?? (signal ? -1 : 0);
      alat.children.delete(ff);
      dl?.kill('SIGKILL');
      resolve(exit);
    });
    ff.once('error', (err) => {
      stderr += `\n${err.message}`;
      exit = exit ?? -2;
      resolve(exit);
    });
  });

  return {
    stream: ff.stdout,
    closed,
    code: () => exit,
    tail: () => stderr.trim(),
    kill() {
      try { dl?.kill('SIGKILL'); } catch { /* sudah mati */ }
      try { ff.kill('SIGKILL'); } catch { /* sudah mati */ }
    },
  };
}

// Uji cepat: ffmpeg membaca 2 detik pertama dari alamat stream dan membuangnya. Dipakai /musik cek.
function probe(track, ffmpegBin = alat.ffmpeg()) {
  if (!ffmpegBin) return Promise.resolve({ ok: false, tail: 'ffmpeg tidak ditemukan.' });
  const args = ffmpegArgs({ input: track.stream.url, headers: track.stream.headers, direct: true });
  args.splice(args.indexOf('pipe:1') - 2, 3, '-t', '2', '-f', 'null', '-');
  return new Promise((resolve) => {
    const ff = spawn(ffmpegBin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    ff.stderr.on('data', (d) => { tail = (tail + d).slice(-600); });
    const timer = setTimeout(() => ff.kill('SIGKILL'), 25000);
    ff.once('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, tail: tail.trim().split('\n').pop() ?? '' }); });
    ff.once('error', (err) => { clearTimeout(timer); resolve({ ok: false, tail: err.message }); });
  });
}

module.exports = { ffmpegArgs, headerString, launch, probe, FORMAT };
