// Pemutar: satu sesi per server. Mengurus koneksi voice, antrian, ffmpeg, lirik berjalan, pindah lagu otomatis, dan keluar sendiri kalau sepi.
const path = require('node:path');
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const store = require('../store');
const alat = require('./alat');
const mesin = require('./mesin');
const sumber = require('./sumber');
const lirik = require('./lirik');
const tampilan = require('./tampilan');
const { Antrian } = require('./antrian');

const { MusikError } = sumber;
const sessions = new Map(); // guildId -> Sesi
const LEAD = 350; // baris lirik ditampilkan sedikit lebih awal, menebus waktu edit pesan
const MIN_EDIT = 1100; // jarak minimum antar edit kartu supaya tidak kena batas Discord
const MAX_RETRY = 2;

const cfg = () => store.loadSettings().musik;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---------- paket voice (dimuat saat dibutuhkan, supaya bot tetap jalan walau paketnya belum terpasang) ----------

let voiceLib;
let voiceError = null;
function voice() {
  if (voiceLib === undefined) {
    try {
      voiceLib = require('@discordjs/voice');
    } catch (err) {
      voiceLib = null;
      voiceError = err.message;
    }
  }
  return voiceLib;
}
const voiceProblem = () => (voice() ? null : `Paket musik belum terpasang (${String(voiceError).split('\n')[0]}). Jalankan install.bat atau "npm install", lalu restart bot.`);

// ---------- offset lirik yang diingat per lagu ----------

const OFFSET_FILE = path.join(store.DIR, 'musik.json');
function loadOffsets() {
  try {
    return store.read(OFFSET_FILE, {}).offsets ?? {};
  } catch {
    return {};
  }
}
function saveOffset(key, ms) {
  try {
    const offsets = loadOffsets();
    if (ms) offsets[key] = ms;
    else delete offsets[key];
    const keys = Object.keys(offsets);
    for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete offsets[k];
    store.write(OFFSET_FILE, { offsets });
  } catch (err) {
    console.error(`[musik] offset lirik tidak tersimpan: ${err.message}`);
  }
}

// Bahan pencarian lirik dari data lagu.
function lyricInfo(t) {
  const durationMs = t.playMs ?? t.durationMs;
  if (t.source === 'spotify') return { key: t.key, title: t.title, artist: t.artist, album: t.album, durationMs: t.durationMs || durationMs, clean: true };
  if (t.ytTrack && t.artist) return { key: t.key, title: t.ytTrack, artist: t.artist, album: t.album, durationMs, clean: true };
  return { key: t.key, title: t.title, artist: t.artist, uploader: t.channel, album: t.album, durationMs, clean: false };
}

// ---------- sesi ----------

class Sesi {
  constructor(guild, voiceChannel, textChannel) {
    this.guild = guild;
    this.voiceChannelId = voiceChannel.id;
    this.textChannel = textChannel;
    this.queue = new Antrian();
    this.status = 'idle'; // idle | loading | playing | paused
    this.volume = 100;
    this.lyricsOn = cfg().lirik !== false;
    this.lyric = null;
    this.lyricKey = null;
    this.lyricGen = 0;
    this.offset = 0;
    this.lead = LEAD;
    this.shownIdx = -2;
    this.gen = 0;
    this.silent = false;
    this.closed = false;
    this.resource = null;
    this.pipe = null;
    this.startMs = 0;
    this.attempt = 0;
    this.message = null;
    this.moveCard = true;
    this.lastEdit = 0;
    this.renderTimer = null;
    this.dirty = false;
    this.pushing = false;
    this.tick = null;
    this.idleTimer = null;
    this.aloneTimer = null;
  }

  static async open(guild, voiceChannel, textChannel) {
    const v = voice();
    if (!v) throw new MusikError(voiceProblem());
    if (!alat.ffmpeg()) throw new MusikError(alat.info.ffmpeg.error);
    const s = new Sesi(guild, voiceChannel, textChannel);
    s.connection = v.joinVoiceChannel({
      channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true,
    });
    try {
      await v.entersState(s.connection, v.VoiceConnectionStatus.Ready, 25000);
    } catch {
      try { s.connection.destroy(); } catch { /* sudah mati */ }
      throw new MusikError('Gagal masuk ke voice channel (waktu habis). Cek izin Connect dan Speak untuk bot, lalu coba lagi.');
    }
    if (voiceChannel.type === ChannelType.GuildStageVoice) guild.members.me?.voice?.setSuppressed(false).catch(() => {});
    s.player = v.createAudioPlayer({ behaviors: { noSubscriber: v.NoSubscriberBehavior.Pause } });
    s.connection.subscribe(s.player);
    s.wire();
    sessions.set(guild.id, s);
    return s;
  }

  wire() {
    const v = voice();
    this.player.on('stateChange', (oldS, newS) => {
      if (newS.status === v.AudioPlayerStatus.Idle && oldS.status !== v.AudioPlayerStatus.Idle && !this.silent) {
        this.onEnd().catch((err) => console.error(`[musik] ${err.message}`));
      }
    });
    this.player.on('error', (err) => {
      this.lastError = err.message;
      console.error(`[musik] pemutar: ${err.message}`);
    });
    this.connection.on(v.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          v.entersState(this.connection, v.VoiceConnectionStatus.Signalling, 5000),
          v.entersState(this.connection, v.VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        try { this.connection.destroy(); } catch { /* sudah mati */ }
      }
    });
    this.connection.on(v.VoiceConnectionStatus.Destroyed, () => {
      this.leave('Bot keluar dari voice channel. Ketik `/play` kalau mau lanjut.').catch(() => {});
    });
    this.connection.on('error', (err) => console.error(`[musik] voice: ${err.message}`));
  }

  // ----- posisi -----

  position() {
    return this.startMs + (this.resource?.playbackDuration ?? 0);
  }

  // ----- memutar -----

  // Hentikan audio yang sedang jalan tanpa memicu "lagu selesai".
  halt() {
    this.silent = true;
    try {
      this.player?.stop(true);
    } catch { /* belum ada yang diputar */ } finally {
      this.silent = false;
    }
    this.pipe?.kill();
    this.pipe = null;
    this.resource = null;
    clearTimeout(this.tick);
  }

  async playCurrent({ startMs = 0, attempt = this.attempt } = {}) {
    const track = this.queue.current;
    if (!track || this.closed) return;
    const gen = ++this.gen;
    this.clearIdle();
    this.halt();
    this.status = 'loading';
    this.startMs = startMs;
    this.attempt = attempt;
    this.shownIdx = -2;
    if (startMs === 0 && attempt === 0) this.moveCard = true;
    this.requestRender({ now: true });

    try {
      await sumber.prepare(track, { force: attempt > 0 });
    } catch (err) {
      if (gen !== this.gen || this.closed) return;
      return this.fail(track, err);
    }
    if (gen !== this.gen || this.closed) return;

    let pipe;
    try {
      pipe = mesin.launch({ track, startMs, volume: this.volume, mode: attempt >= MAX_RETRY ? 'pipa' : 'langsung' });
    } catch (err) {
      return this.fail(track, err);
    }
    const v = voice();
    this.pipe = pipe;
    this.resource = v.createAudioResource(pipe.stream, { inputType: v.StreamType.OggOpus });
    this.player.play(this.resource);
    this.status = 'playing';
    this.lastError = null;

    if (this.lyricKey !== track.key) this.startLyrics(track);
    else this.schedule();
    this.requestRender({ now: true });
    this.prefetch();
  }

  // Lagu berikutnya disiapkan dari sekarang (cari di YouTube, ambil alamat stream) supaya pindah lagu tanpa jeda panjang.
  prefetch() {
    const next = this.queue.items[0];
    if (!next || next.stream || next.preparing) return;
    next.preparing = sumber.prepare(next).catch(() => {}).finally(() => { next.preparing = null; });
  }

  // Dipanggil saat audio habis: lagu selesai, atau stream putus di tengah jalan.
  async onEnd() {
    const track = this.queue.current;
    if (!track || this.closed) return;
    const pipe = this.pipe;
    if (pipe) await Promise.race([pipe.closed, sleep(1500)]);
    if (this.closed || this.queue.current !== track) return;

    const pos = this.position();
    const expected = track.playMs ?? track.durationMs;
    const code = pipe?.code() ?? 0;
    const premature = code !== 0 || (!track.live && expected > 0 && pos < expected - 10000) || (track.live && pos < 5000);
    if (premature && this.attempt < MAX_RETRY) {
      // Stream putus: ambil alamat baru dan lanjut dari menit yang sama. Percobaan terakhir pakai mode pipa.
      console.error(`[musik] stream "${track.title}" putus di ${Math.round(pos / 1000)} dtk (kode ${code}). ${pipe?.tail().split('\n').pop() ?? ''}`);
      this.attempt += 1;
      return this.playCurrent({ startMs: pos, attempt: this.attempt });
    }
    if (premature && code !== 0) return this.fail(track, new Error(pipe?.tail().split('\n').pop() || this.lastError || 'Stream terputus.'));
    return this.next();
  }

  async next(opts = {}) {
    this.attempt = 0;
    const t = this.queue.advance(opts);
    if (!t) return this.finish();
    return this.playCurrent();
  }

  async fail(track, err) {
    const reason = sumber.friendly(err);
    console.error(`[musik] gagal memutar "${track.title}": ${err?.stderr || err?.message}`);
    this.notice(`⚠️ Gagal memutar **${lirik.esc(tampilan.clip(track.title, 80))}**: ${reason}`);
    return this.next({ drop: true, skipped: true });
  }

  // Antrian habis: kartu dibekukan, bot menunggu sebentar lalu keluar sendiri.
  finish() {
    this.halt();
    this.status = 'idle';
    this.queue.current = null;
    this.lyric = null;
    this.lyricKey = null;
    this.moveCard = true;
    this.pushNow(tampilan.ended('Antrian selesai. Ketik `/play` buat memutar lagu lagi.'));
    const minutes = Number(cfg().diamMenit) || 3;
    this.idleTimer = setTimeout(() => this.leave('Keluar karena tidak ada lagu yang diputar.'), minutes * 60000);
    this.idleTimer.unref?.();
  }

  clearIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  // ----- kontrol -----

  add(tracks, { next = false } = {}) {
    this.clearIdle();
    const n = this.queue.add(tracks, { next, max: Number(cfg().maksAntrian) || 200 });
    if (!this.queue.current && !this.closed && this.status === 'idle') {
      this.next().catch((err) => console.error(`[musik] ${err.message}`));
    } else {
      this.prefetch();
      this.requestRender();
    }
    return n;
  }

  skip() {
    if (!this.queue.current) return false;
    this.next({ skipped: true }).catch((err) => console.error(`[musik] ${err.message}`));
    return true;
  }

  pause() {
    if (this.status !== 'playing') return false;
    this.player.pause(true);
    this.status = 'paused';
    clearTimeout(this.tick);
    this.requestRender({ now: true });
    return true;
  }

  resume() {
    if (this.status !== 'paused') return false;
    this.player.unpause();
    this.status = 'playing';
    this.schedule();
    this.requestRender({ now: true });
    return true;
  }

  togglePause() {
    return this.status === 'paused' ? this.resume() : this.pause();
  }

  seek(ms) {
    const t = this.queue.current;
    if (!t || t.live) return false;
    const max = Math.max(0, (t.playMs ?? t.durationMs) - 1000);
    this.shownIdx = -2;
    this.playCurrent({ startMs: clamp(ms, 0, max || ms), attempt: 0 }).catch((err) => console.error(`[musik] ${err.message}`));
    return true;
  }

  setVolume(pct) {
    this.volume = clamp(Math.round(pct), 10, 200);
    if (this.queue.current && this.status !== 'idle') {
      // ffmpeg yang mengatur volume, jadi lagu dimulai ulang dari menit yang sama (jeda sekejap).
      this.playCurrent({ startMs: this.position(), attempt: 0 }).catch((err) => console.error(`[musik] ${err.message}`));
    }
    return this.volume;
  }

  // ----- lirik -----

  startLyrics(track) {
    this.lyricKey = track.key;
    this.offset = loadOffsets()[track.key] ?? 0;
    this.shownIdx = -2;
    this.lyric = { status: 'cari' };
    clearTimeout(this.tick);
    if (this.lyricsOn) this.fetchLyrics(track);
  }

  async fetchLyrics(track) {
    const gen = ++this.lyricGen;
    this.lyric = { status: 'cari' };
    let status;
    let data = null;
    try {
      data = await lirik.find(lyricInfo(track));
      status = !data ? 'tidak' : data.synced ? 'ada' : data.plain ? 'plain' : 'tidak';
    } catch (err) {
      console.error(`[musik] lirik: ${err.message}`);
      status = 'gagal';
    }
    if (gen !== this.lyricGen || this.queue.current?.key !== track.key || this.closed) return;
    this.lyric = { status, data };
    this.shownIdx = -2;
    this.requestRender({ now: true });
    this.schedule();
  }

  // Pemicu pembaruan lirik: jalan tepat saat baris berikutnya mulai.
  schedule() {
    clearTimeout(this.tick);
    const l = this.lyric;
    if (this.closed || !this.lyricsOn || this.status !== 'playing' || l?.status !== 'ada') return;
    const lines = l.data.synced;
    const pos = this.position() + this.offset + this.lead;
    const idx = lirik.indexAt(lines, pos);
    if (idx !== this.shownIdx) {
      this.shownIdx = idx;
      this.requestRender();
    }
    const nextAt = lines[idx + 1]?.t;
    if (nextAt === undefined) return;
    this.tick = setTimeout(() => this.schedule(), Math.max(150, nextAt - pos));
    this.tick.unref?.();
  }

  toggleLyrics() {
    this.lyricsOn = !this.lyricsOn;
    const t = this.queue.current;
    if (this.lyricsOn && t && (!this.lyric || this.lyric.status === 'cari')) this.fetchLyrics(t);
    this.shownIdx = -2;
    this.schedule();
    this.requestRender({ now: true });
    return this.lyricsOn;
  }

  // delta > 0: lirik muncul lebih awal, delta < 0: lebih lambat.
  shiftLyrics(delta) {
    const t = this.queue.current;
    if (!t) return 0;
    this.offset = clamp(this.offset + delta, -15000, 15000);
    saveOffset(t.key, this.offset);
    this.shownIdx = -2;
    this.schedule();
    this.requestRender({ now: true });
    return this.offset;
  }

  // ----- kartu di channel teks -----

  requestRender({ now = false } = {}) {
    if (this.closed || !this.textChannel) return;
    if (this.renderTimer) {
      this.dirty = true;
      return;
    }
    const gap = now ? 350 : MIN_EDIT;
    const wait = Math.max(0, this.lastEdit + gap - Date.now());
    this.renderTimer = setTimeout(async () => {
      this.renderTimer = null;
      if (this.pushing) {
        this.dirty = true;
        return;
      }
      this.pushing = true;
      try {
        await this.push(tampilan.card(this));
      } finally {
        this.pushing = false;
        if (this.dirty) {
          this.dirty = false;
          this.requestRender();
        }
      }
    }, wait);
    this.renderTimer.unref?.();
  }

  // Kirim / edit kartu. moveCard = kirim yang baru di paling bawah lalu hapus yang lama.
  async push(payload) {
    if (!this.textChannel) return;
    this.lastEdit = Date.now();
    try {
      if (this.moveCard || !this.message) {
        const old = this.message;
        this.message = await this.textChannel.send(payload);
        this.moveCard = false;
        old?.delete().catch(() => {});
      } else {
        await this.message.edit(payload);
      }
    } catch (err) {
      if (err.code === 10008) {
        this.message = null; // pesan dihapus orang lain: kirim ulang di putaran berikutnya
        this.moveCard = true;
        this.dirty = true;
      } else if (err.code === 50013 || err.code === 50001) {
        console.error('[musik] bot tidak boleh menulis di channel teks ini, kartu musik dimatikan.');
        this.textChannel = null;
      } else {
        console.error(`[musik] kartu: ${err.message}`);
      }
    }
  }

  async pushNow(payload) {
    clearTimeout(this.renderTimer);
    this.renderTimer = null;
    if (this.pushing) await sleep(300);
    await this.push(payload);
  }

  // Pesan singkat yang hilang sendiri (error, info).
  notice(text) {
    this.textChannel?.send({ content: text, allowedMentions: { parse: [] } })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 25000).unref?.())
      .catch(() => {});
  }

  // ----- keluar -----

  async leave(text = 'Musik dihentikan.') {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.renderTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.aloneTimer);
    clearTimeout(this.tick);
    this.halt();
    this.queue.clear();
    if (sessions.get(this.guild.id) === this) sessions.delete(this.guild.id);
    try { this.connection?.destroy(); } catch { /* sudah mati */ }
    if (this.message && text) await this.message.edit(tampilan.ended(text)).catch(() => {});
  }

  // Dipanggil tiap ada yang masuk / keluar voice: bot keluar sendiri kalau ditinggal semua orang.
  checkAlone() {
    if (this.closed) return;
    const botId = this.guild.client.user.id;
    const here = this.guild.voiceStates.cache.filter((vs) => vs.channelId === this.voiceChannelId && vs.id !== botId && !vs.member?.user?.bot);
    if (here.size === 0) {
      if (!this.aloneTimer) {
        const sec = Number(cfg().kosongDetik) || 60;
        this.aloneTimer = setTimeout(() => this.leave('Keluar karena tidak ada yang mendengarkan.'), sec * 1000);
        this.aloneTimer.unref?.();
      }
    } else if (this.aloneTimer) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
    }
  }
}

// ---------- pintu masuk modul ----------

const get = (guildId) => {
  const s = sessions.get(guildId);
  return s && !s.closed ? s : null;
};

// Cek izin bot di voice channel. Hasil: teks masalah, atau null kalau aman.
function joinProblem(voiceChannel) {
  const me = voiceChannel.guild.members.me;
  const perms = voiceChannel.permissionsFor(me);
  if (!perms?.has([P.ViewChannel, P.Connect])) return 'Bot tidak punya izin **Connect** di voice channel itu.';
  if (voiceChannel.type !== ChannelType.GuildStageVoice && !perms.has(P.Speak)) return 'Bot tidak punya izin **Speak** di voice channel itu.';
  if (voiceChannel.full && !perms.has(P.MoveMembers)) return 'Voice channel itu sudah penuh.';
  return null;
}

// Ambil sesi yang ada, atau buat baru dan masuk ke voice channel.
async function ensure(guild, voiceChannel, textChannel) {
  const problem = joinProblem(voiceChannel);
  if (problem) throw new MusikError(problem);
  const existing = get(guild.id);
  if (existing) {
    if (existing.voiceChannelId === voiceChannel.id) {
      if (!existing.textChannel && textChannel) existing.textChannel = textChannel;
      return existing;
    }
    if (existing.status !== 'idle' || existing.queue.size) {
      throw new MusikError(`Bot sedang memutar musik di <#${existing.voiceChannelId}>. Gabung ke sana, atau tunggu sampai selesai.`);
    }
    await existing.leave('');
  }
  return Sesi.open(guild, voiceChannel, textChannel);
}

function onVoiceState(oldState, newState) {
  const guildId = (newState.guild ?? oldState.guild).id;
  const s = get(guildId);
  if (!s) return;
  const botId = s.guild.client.user.id;
  if (newState.id === botId) {
    if (newState.channelId && newState.channelId !== s.voiceChannelId) s.voiceChannelId = newState.channelId; // dipindah admin
    return s.checkAlone();
  }
  if (oldState.channelId === s.voiceChannelId || newState.channelId === s.voiceChannelId) s.checkAlone();
}

// Bot dimatikan / restart: keluar dari semua voice dan matikan ffmpeg / yt-dlp yang masih jalan.
async function shutdown() {
  await Promise.race([
    Promise.all([...sessions.values()].map((s) => s.leave('Bot sedang restart. Ketik `/play` lagi sebentar lagi.'))),
    sleep(2500),
  ]);
  alat.killAll();
}

const activeCount = () => [...sessions.values()].filter((s) => !s.closed && s.queue.current).length;

function dependencyReport() {
  const v = voice();
  if (!v) return `@discordjs/voice: tidak terpasang (${String(voiceError).split('\n')[0]})`;
  try {
    return v.generateDependencyReport();
  } catch (err) {
    return `@discordjs/voice terpasang, laporan gagal dibuat: ${err.message}`;
  }
}

process.on('exit', () => alat.killAll());

module.exports = { Sesi, ensure, get, joinProblem, onVoiceState, shutdown, activeCount, dependencyReport, voice, voiceProblem, lyricInfo, sessions };
