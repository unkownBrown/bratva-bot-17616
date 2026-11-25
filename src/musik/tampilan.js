// Tampilan musik: kartu "sedang diputar" (dengan lirik berjalan dan tombol kontrol), antrian, dan lirik lengkap.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../store');
const lirik = require('./lirik');

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function color() {
  try {
    return require('../panels').asColor(store.loadContent().meta.warna);
  } catch {
    return 0x8c1c1c;
  }
}

function fmt(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const shift = (ms) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${(Math.abs(ms) / 1000).toFixed(1)}s`;
const link = (t) => (t.url ? `[${lirik.esc(clip(t.title, 90))}](${t.url})` : lirik.esc(clip(t.title, 90)));
const byline = (t) => (t.artist || t.channel ? lirik.esc(clip(t.artist || t.channel, 80)) : null);
const who = (t) => (t.by?.id ? `<@${t.by.id}>` : t.by?.name ?? '');

const LOOP_LABEL = { mati: 'mati', lagu: 'ulang lagu', antrian: 'ulang antrian' };

// Isi kolom lirik sesuai keadaan pencarian.
function lyricBlock(s) {
  const l = s.lyric;
  if (!l || l.status === 'cari') return '*Mencari lirik...*';
  if (l.status === 'tidak') return '*Lirik tidak ditemukan untuk lagu ini.*';
  if (l.status === 'gagal') return '*Lirik tidak bisa diambil sekarang.*';
  if (l.status === 'instrumental') return '*Instrumental.*';
  if (l.status === 'plain') {
    const lines = String(l.data.plain).split(/\r?\n/).filter(Boolean).slice(0, 10).map(lirik.esc);
    return `${lines.join('\n')}\n*... lirik ini tanpa waktu, lengkapnya: /musik lirik*`;
  }
  const idx = lirik.indexAt(l.data.synced, s.position() + s.offset + s.lead);
  return lirik.windowText(l.data.synced, idx) || '*♪*';
}

function card(s) {
  const q = s.queue;
  const t = q.current;
  const embed = new EmbedBuilder().setColor(color());

  if (!t) {
    embed.setTitle('Antrian kosong').setDescription('Ketik `/play` buat memutar lagu (judul, link YouTube, atau link Spotify).');
    return { embeds: [embed], components: [] };
  }

  const dur = t.playMs ?? t.durationMs;
  const pos = s.position();
  const title = { loading: '⏳ Menyiapkan lagu', paused: '⏸ Dijeda', playing: '▶ Sedang diputar' }[s.status] ?? '▶ Sedang diputar';
  const lines = [`**${link(t)}**`];
  const by = byline(t);
  if (by) lines.push(by);
  const meta = [t.live ? '🔴 LIVE' : dur ? fmt(dur) : null, who(t) ? `diminta ${who(t)}` : null].filter(Boolean);
  if (meta.length) lines.push(meta.join(' · '));
  if (s.status === 'playing' && dur && !t.live) lines.push(`Selesai ${ts(Date.now() + Math.max(0, dur - pos))}`);
  if (s.status === 'paused') lines.push(`Berhenti di ${fmt(pos)}${dur ? ` / ${fmt(dur)}` : ''}`);

  embed.setAuthor({ name: title }).setDescription(lines.join('\n'));
  if (t.thumbnail) embed.setThumbnail(t.thumbnail);
  if (s.lyricsOn) embed.addFields({ name: '🎤 Lirik', value: clip(lyricBlock(s), 1000) });

  const foot = [`Antrian: ${q.size}`, `Loop: ${LOOP_LABEL[q.loop]}`];
  if (s.volume !== 100) foot.push(`Volume ${s.volume}%`);
  if (s.lyricsOn && s.offset) foot.push(`Lirik digeser ${shift(s.offset)}`);
  if (s.lyric?.data?.approx && s.lyricsOn) foot.push('lirik mungkin beda versi');
  embed.setFooter({ text: foot.join(' · ') });

  const busy = s.status === 'loading';
  const synced = Boolean(s.lyric?.data?.synced);
  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`mu:${id}`).setStyle(style);
    if (label) b.setLabel(label);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  const rows = [
    new ActionRowBuilder().addComponents(
      btn('pause', s.status === 'paused' ? 'Lanjut' : 'Jeda', ButtonStyle.Primary, s.status === 'paused' ? '▶️' : '⏸️').setDisabled(busy),
      btn('skip', 'Lewati', ButtonStyle.Secondary, '⏭️'),
      btn('stop', 'Stop', ButtonStyle.Danger, '⏹️'),
      btn('loop', `Loop: ${LOOP_LABEL[q.loop]}`, q.loop === 'mati' ? ButtonStyle.Secondary : ButtonStyle.Success, '🔁'),
      btn('shuffle', 'Acak', ButtonStyle.Secondary, '🔀'),
    ),
    new ActionRowBuilder().addComponents(
      btn('lirik', `Lirik: ${s.lyricsOn ? 'on' : 'off'}`, s.lyricsOn ? ButtonStyle.Success : ButtonStyle.Secondary, '🎤'),
      btn('offm', 'Lirik lebih lambat', ButtonStyle.Secondary, '⏪').setDisabled(!s.lyricsOn || !synced),
      btn('offp', 'Lirik lebih awal', ButtonStyle.Secondary, '⏩').setDisabled(!s.lyricsOn || !synced),
      btn('queue', 'Antrian', ButtonStyle.Secondary, '📃'),
      btn('vol', 'Volume', ButtonStyle.Secondary, '🔊'),
    ),
  ];
  return { embeds: [embed], components: rows };
}

// Kartu yang dibekukan saat sesi berakhir (tombol dihapus).
function ended(text) {
  return { embeds: [new EmbedBuilder().setColor(color()).setDescription(text)], components: [] };
}

function queueEmbed(s) {
  const q = s.queue;
  const embed = new EmbedBuilder().setColor(color()).setTitle('Antrian lagu');
  const lines = [];
  if (q.current) lines.push(`**Sekarang:** ${link(q.current)} (${fmt(q.current.playMs ?? q.current.durationMs)})`, '');
  const shown = q.items.slice(0, 15);
  shown.forEach((t, i) => lines.push(`\`${i + 1}.\` ${link(t)} · ${t.durationMs ? fmt(t.durationMs) : '?'}${t.by?.id ? ` · <@${t.by.id}>` : ''}`));
  if (q.size > shown.length) lines.push(`... dan ${q.size - shown.length} lagu lagi`);
  if (!q.size) lines.push('Belum ada lagu berikutnya.');
  embed.setDescription(clip(lines.join('\n'), 4000));
  const foot = [`${q.size} lagu menunggu`, q.totalMs() ? `total ${fmt(q.totalMs())}` : null, `Loop: ${LOOP_LABEL[q.loop]}`].filter(Boolean);
  return embed.setFooter({ text: foot.join(' · ') });
}

// Lirik lengkap (tanpa waktu) buat dibaca.
function lyricsEmbed(t, data) {
  const text = data.plain || (data.synced ?? []).map((l) => l.text || '').join('\n');
  const embed = new EmbedBuilder().setColor(color()).setTitle(clip(`${data.artist ? `${data.artist} - ` : ''}${data.title ?? t.title}`, 250));
  const body = lirik.esc(text.trim());
  embed.setDescription(clip(body || '*Tidak ada teks.*', 4000));
  return embed.setFooter({ text: data.synced ? 'Lirik berwaktu dari LRCLIB' : 'Lirik dari LRCLIB (tanpa waktu)' });
}

module.exports = { card, ended, queueEmbed, lyricsEmbed, fmt, clip, shift };
