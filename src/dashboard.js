const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType,
} = require('discord.js');
const store = require('./store');
const panels = require('./panels');
const members = require('./members');
const runtime = require('./runtime');
const safety = require('./safety');
const rolemenu = require('./rolemenu');
const akses = require('./akses');
const forms = require('./forms');
const statusLib = require('./status');
const updateLib = require('./update');
const musik = require('./musik');
const moderasi = require('./moderasi');
const komunitas = require('./komunitas');
const bursa = require('./bursa');
const game = require('./game');
const pkg = require('../package.json');

const { ts, minutes } = runtime;
const accent = (content) => panels.asColor(content.meta.warna);
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

function stats(guild) {
  const content = store.loadContent();
  const state = store.loadState();
  const keys = Object.keys(content.panels);
  return {
    content, state, keys,
    drafts: keys.filter((k) => content.panels[k].draft),
    missing: keys.filter((k) => !panels.findChannel(guild, k, state)),
    posted: keys.filter((k) => state.panels[k]?.messageIds?.length),
  };
}

const nextDraft = () => {
  const content = store.loadContent();
  return Object.keys(content.panels).find((k) => content.panels[k].draft) ?? null;
};

// Pilihan di menu pengaturan: [path di settings.json, label]
const TOGGLES = [
  ['logs.aktif', 'Log join/leave'], ['logs.invite', 'Lacak invite'], ['logs.raid.aktif', 'Alarm lonjakan'],
  ['pesan.aktif', 'Log voice'], ['roster.aktif', 'Roster'], ['aktivitas.aktif', 'Aktivitas'],
  ['backup.aktif', 'Backup'], ['otomatis.panel', 'Panel otomatis'],
  ['status.aktif', 'Status online'], ['status.bio', 'Bio bot'], ['musik.aktif', 'Musik'], ['layar.aktif', 'Log share screen'],
];
// Fitur tambahan (moderasi, auto-moderasi, sambutan, komunitas) punya halaman sendiri: Fitur lainnya.
const FITUR = [
  ['moderasi.aktif', 'Moderasi'], ['moderasi.dm', 'DM peringatan'], ['moderasi.eskalasi.aktif', 'Eskalasi'], ['automod.aktif', 'Auto-moderasi'],
  ['sambutan.aktif', 'Sambutan'], ['sambutan.keluar', 'Pesan keluar'], ['sambutan.dm', 'DM sambutan'], ['komunitas.aktif', 'Komunitas'],
  ['komunitas.afk', 'AFK'],
];
// Bursa harga punya halaman sendiri (tombol Bursa harga di menu utama).
const BURSA = [['bursa.aktif', 'Bursa harga'], ['bursa.rekapMingguan', 'Rekap mingguan'], ['bursa.log', 'Log penjualan']];
// Game & level punya halaman sendiri (tombol Game & level di menu utama).
const GAME = [['level.aktif', 'Level'], ['level.umumkan', 'Umumkan naik level'], ['level.voice', 'XP voice'], ['game.aktif', 'Game']];
const MODULES = {
  logs: 'Log join/leave', pesan: 'Log voice', roster: 'Roster anggota', aktivitas: 'Aktivitas', backup: 'Backup',
  moderasi: 'Log moderasi', sambutan: 'Channel sambutan', bursa: 'Log bursa harga', level: 'Pengumuman naik level',
  layar: 'Log share screen (video-recorder)',
};

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function togglePath(settings, path) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], settings);
  target[last] = !target[last];
}

// ---------- pesan kontrol (menetap di channel panel-bot, otomatis diperbarui) ----------

function controlPayload(guild) {
  const { content, keys, drafts, missing, posted } = stats(guild);
  const cfg = store.loadSettings();
  const on = (b) => (b ? 'aktif' : 'mati');
  const lines = [
    `Bot jalan dalam **mode manual** di **${guild.name}**: tidak ada yang diposting atau dibuat sendiri sampai kamu menyalakannya.`,
    '',
    `**${keys.length}** panel  ·  **${posted.length}** terposting  ·  **${drafts.length}** draft`,
    `Log join/leave: ${on(cfg.logs.aktif)}  ·  Log voice: ${on(cfg.pesan.aktif)}  ·  Roster: ${on(cfg.roster.aktif)}  ·  Aktivitas: ${on(cfg.aktivitas.aktif)}  ·  Panel otomatis: ${on(cfg.otomatis.panel)}  ·  Musik: ${on(cfg.musik.aktif)}`,
    `Moderasi: ${on(cfg.moderasi.aktif)}  ·  Auto-moderasi: ${on(cfg.automod.aktif)}  ·  Sambutan: ${on(cfg.sambutan.aktif)}  ·  Komunitas: ${on(cfg.komunitas.aktif)}  ·  Bursa harga: ${on(cfg.bursa.aktif)}  ·  Level: ${on(cfg.level.aktif)}  ·  Game: ${on(cfg.game.aktif)}`,
  ];
  if (!runtime.features.members) {
    lines.push('', '**Fitur anggota belum aktif.** Buka Developer Portal, tab Bot, nyalakan **Server Members Intent**, lalu restart bot.');
  }
  if (!runtime.features.content) {
    lines.push('', '**Auto-moderasi yang membaca isi pesan belum bisa jalan.** Buka Developer Portal, tab Bot, nyalakan **Message Content Intent**, lalu restart bot.');
  }
  if (missing.length) {
    lines.push('', `Channel belum ketemu (${missing.length}): ${missing.slice(0, 8).map((k) => `\`${k}\``).join(', ')}${missing.length > 8 ? ' ...' : ''}`,
      'Buat channelnya lalu klik Posting ulang semua, atau hubungkan lewat menu panel.');
  }
  if (drafts.length) lines.push('', `**${drafts.length}** panel masih draft. Klik **Isi draft** buat nulis, terposting setelah disimpan.`);

  const embed = new EmbedBuilder().setColor(accent(content)).setTitle('PANEL KONTROL').setDescription(lines.join('\n'))
    .setFooter({ text: 'Diperbarui otomatis' }).setTimestamp();

  const components = [
    row(
      button('dash:resync', 'Posting ulang semua', ButtonStyle.Primary),
      button('dash:draft', drafts.length ? `Isi draft (${drafts.length})` : 'Isi draft').setDisabled(!drafts.length),
      button('dash:add', 'Tambah channel'),
      button('dash:img', 'Logo & banner'),
      button('dash:status', 'Status bot'),
    ),
    row(
      button('dash:roles', 'Take role'), button('dash:forms', 'Formulir'), button('dash:access', 'Akses channel'),
      button('dash:list', 'Daftar panel'), button('dash:set', 'Pengaturan'),
    ),
    row(button('dash:fitur', 'Fitur lainnya', ButtonStyle.Primary), button('dash:bursa', 'Bursa harga', ButtonStyle.Success), button('dash:game', 'Game & level', ButtonStyle.Success), button('dash:kasus', 'Kasus moderasi')),
  ];
  if (keys.length) {
    const sorted = [...keys].sort((a, b) => Number(!!content.panels[b].draft) - Number(!!content.panels[a].draft) || a.localeCompare(b));
    const options = sorted.slice(0, 25).map((key) => {
      const panel = content.panels[key];
      const title = panels.asText(panel.messages?.[0]?.title ?? '');
      return { label: key.slice(0, 100), value: key, description: `${panel.draft ? 'draft' : 'aktif'}${title ? ` · ${title}` : ''}`.slice(0, 100) };
    });
    components.push(row(new StringSelectMenuBuilder().setCustomId('dash:pick').setPlaceholder('Ubah / atur panel...').addOptions(options)));
    if (keys.length > 25) embed.setFooter({ text: `Daftar menampilkan 25 dari ${keys.length} panel. Sisanya ada di Daftar panel.` });
  }
  components.push(row(new UserSelectMenuBuilder().setCustomId('dash:member').setPlaceholder('Lihat data anggota...')));
  return { embeds: [embed], components, files: [] };
}

// Pesan kontrol hanya diedit kalau memang sudah kamu pasang (tombol "Taruh menu kontrol di channel ini"). Tidak pernah dikirim sendiri.
async function refreshDashboard(guild) {
  const access = store.loadState().access[guild.id];
  const channel = access?.dashboardId && guild.channels.cache.get(access.channelId);
  if (!channel) return;
  await channel.messages.fetch(access.dashboardId).then((m) => m.edit(controlPayload(guild))).catch(() => {});
}

async function pinDashboard(guild, channel) {
  const msg = await channel.send(controlPayload(guild));
  const state = store.loadState();
  state.access[guild.id] = { ...(state.access[guild.id] ?? {}), channelId: channel.id, dashboardId: msg.id };
  store.saveState(state);
  return msg;
}

// ---------- tampilan ephemeral ----------

function panelDetail(guild, key) {
  const { content, state } = stats(guild);
  const panel = content.panels[key];
  if (!panel) return null;
  const channel = panels.findChannel(guild, key, state);
  const msgs = panel.messages ?? [];
  const status = panel.draft ? 'draft (belum diposting)' : state.panels[key]?.messageIds?.length ? 'terposting' : 'belum diposting';
  const embed = new EmbedBuilder().setColor(accent(content)).setTitle(`PANEL · ${key}`).setDescription([
    `Channel: ${channel ?? '**tidak ketemu**'}`,
    `Status: ${status}`,
    `Isi: ${msgs.length} pesan${msgs[0]?.title ? ` · "${panels.asText(msgs[0].title)}"` : ''}`,
  ].join('\n'));
  const components = [row(
    button(`pd:edit:${key}:1`, 'Edit teks', ButtonStyle.Primary),
    button(`pd:post:${key}`, 'Posting ulang'),
    button(`pd:bind:${key}`, 'Hubungkan channel'),
    button(`pd:roles:${key}`, 'Atur role'),
    button(`pd:del:${key}`, 'Hapus', ButtonStyle.Danger),
  )];
  if (msgs.length > 1) {
    components.push(row(...msgs.slice(1, 5).map((_, i) => button(`pd:edit:${key}:${i + 2}`, `Edit bagian ${i + 2}`))));
  }
  return { embeds: [embed], components };
}


// ---------- role menu (take role) ----------

// Panel yang ditawarkan di daftar: take-role dan free-role dulu, lalu yang sudah punya menu, lalu sisanya.
function roleMenuKeys(guild) {
  const { keys, state } = stats(guild);
  const own = Object.keys(state.roleMenus[guild.id] ?? {});
  return [...new Set(['take-role', 'free-role', ...own, ...keys])].filter((k) => keys.includes(k)).slice(0, 25);
}

function roleChooser(guild) {
  const { content, state } = stats(guild);
  const lines = roleMenuKeys(guild).map((key) => {
    const n = rolemenu.activeRoles(guild, key, state).length;
    return `\`${key}\` · ${n ? `${n} role` : 'belum ada role'}`;
  });
  const embed = new EmbedBuilder().setColor(accent(content)).setTitle('ROLE MENU').setDescription([
    'Pilih role apa saja yang boleh diambil member sendiri. Tombolnya muncul di bawah pesan panel, teks panel tidak berubah.',
    '',
    lines.join('\n') || 'Belum ada panel.',
    '',
    'Pilih panel di bawah buat mengatur role-nya (biasanya take-role atau free-role).',
  ].join('\n'));
  const options = roleMenuKeys(guild).map((key) => {
    const n = rolemenu.activeRoles(guild, key, state).length;
    return { label: key.slice(0, 100), value: key, description: n ? `${n} role` : 'belum ada role' };
  });
  return { embeds: [embed], components: options.length ? [row(new StringSelectMenuBuilder().setCustomId('rm:pick').setPlaceholder('Pilih panel...').addOptions(options))] : [] };
}

function roleEditor(guild, key, notes = '') {
  const { content, state } = stats(guild);
  const menu = rolemenu.menuOf(guild.id, key, state) ?? { roleIds: [], exclusive: false };
  const current = menu.roleIds.map((id) => guild.roles.cache.get(id)).filter(Boolean);
  const stale = current.filter((r) => !safety.isSafeRole(guild, r));
  const channel = panels.findChannel(guild, key, state);

  const lines = [
    `Panel: **${key}** · ${channel ?? '**channel belum ketemu**'}`,
    '',
    current.length ? current.map((r) => `<@&${r.id}>`).join(' ') : 'Belum ada role. Pilih dari daftar di bawah.',
    '',
    `Mode: ${menu.exclusive ? '**satu saja** (ambil satu role mencopot role lain di menu ini)' : '**bebas** (boleh ambil beberapa role)'}`,
    current.length > rolemenu.BUTTON_LIMIT ? `Lebih dari ${rolemenu.BUTTON_LIMIT} role, tampil sebagai dropdown.` : `Sampai ${rolemenu.BUTTON_LIMIT} role tampil sebagai tombol.`,
    'Hanya role aman yang bisa dipilih: bukan role bot, tanpa izin admin / kelola, dan posisinya di bawah role bot.',
  ];
  if (stale.length) lines.push('', `Tidak ditampilkan lagi karena sudah tidak aman: ${stale.map((r) => r.name).join(', ')}`);
  if (notes) lines.unshift(notes, '');

  const select = new RoleSelectMenuBuilder().setCustomId(`rm:set:${key}`).setPlaceholder('Pilih role yang boleh diambil member...')
    .setMinValues(0).setMaxValues(rolemenu.MAX_ROLES);
  if (current.length) select.setDefaultRoles(...current.map((r) => r.id).slice(0, rolemenu.MAX_ROLES));
  return {
    embeds: [new EmbedBuilder().setColor(accent(content)).setTitle(`ROLE MENU · ${key}`).setDescription(lines.join('\n'))],
    components: [
      row(select),
      row(
        button(`rm:ex:${key}`, menu.exclusive ? 'Mode: satu saja' : 'Mode: bebas'),
        button(`rm:clear:${key}`, 'Kosongkan').setDisabled(!current.length),
        button('rm:back', 'Kembali'),
      ),
    ],
  };
}

// ---------- status bot ----------

const EPHEMERAL_HOSTS = ['RENDER', 'DYNO', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'KOYEB_APP_NAME', 'K_SERVICE'];

function statusView(guild) {
  const client = guild.client;
  const settings = store.loadSettings();
  const access = store.loadState().access[guild.id] ?? {};
  const upMs = process.uptime() * 1000;
  const rss = Math.round(process.memoryUsage().rss / 1048576);
  const host = EPHEMERAL_HOSTS.find((k) => process.env[k]);
  const on = (b) => (b ? 'aktif' : 'mati');

  const embed = new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('STATUS BOT').addFields(
    { name: 'Nyala sejak', value: `${ts(Date.now() - upMs)} (${runtime.duration(upMs)})`, inline: true },
    { name: 'Ping', value: client.ws?.ping >= 0 ? `${Math.round(client.ws.ping)} ms` : '-', inline: true },
    { name: 'Memori', value: `${rss} MB`, inline: true },
    { name: 'Versi', value: `bot ${pkg.version} · Node ${process.versions.node}`, inline: true },
    { name: 'Server', value: String(client.guilds?.cache?.size ?? 1), inline: true },
    { name: 'Data anggota', value: `${members.all(guild.id).length} orang`, inline: true },
    { name: 'Intent', value: `Members: ${on(runtime.features.members)} · Message Content: ${on(runtime.features.content)}` },
    { name: 'Backup', value: `${on(settings.backup.aktif)} · terakhir ${access.backupAt ? ts(access.backupAt) : 'belum pernah'}` },
    { name: 'Status online', value: settings.status.aktif ? (statusLib.info.text ? `\`${statusLib.info.text}\`` : 'menunggu hitungan pertama') : 'mati', inline: true },
    { name: 'Bio bot', value: !settings.status.bio ? 'mati' : statusLib.info.bioError ? `gagal: ${statusLib.info.bioError}`.slice(0, 200) : statusLib.info.bioText ? 'terpasang' : 'menunggu', inline: true },
    { name: 'Musik', value: musik.summary() },
    { name: 'Moderasi', value: moderasi.summary(guild.id) },
    { name: 'Komunitas', value: komunitas.summary() },
    { name: 'Bursa harga', value: bursa.summary(guild.id) },
    { name: 'Game & level', value: game.summary(guild.id) },
    { name: 'Folder data', value: `\`${store.DIR}\`` },
  );
  if (host && !settings.backup.aktif) {
    embed.setDescription(`**Perhatian:** bot ini jalan di hosting (${host}) yang filenya bisa ke-reset. Nyalakan **Backup** di Pengaturan, dan isi environment variable BACKUP_CHANNEL_ID, supaya pengaturan dan data anggota tidak hilang.`);
  }
  const buttons = [button('dash:backup', 'Backup sekarang', ButtonStyle.Primary), button('dash:status', 'Segarkan'), button('dash:update', 'Update bot')];
  if (updateLib.hasRollback()) buttons.push(button('dash:rollback', 'Kembalikan versi sebelumnya'));
  return { embeds: [embed], components: [row(...buttons)] };
}

// ---------- formulir pengajuan ----------

function formKeys(guild) {
  const { keys, state } = stats(guild);
  const own = Object.keys(state.forms[guild.id] ?? {});
  const likely = keys.filter((k) => /req|report|interview|approach|insider|langganan|syarat/.test(k));
  return [...new Set([...own, ...likely, ...keys])].filter((k) => keys.includes(k)).slice(0, 25);
}

function formChooser(guild) {
  const { content, state } = stats(guild);
  const active = Object.entries(state.forms[guild.id] ?? {}).filter(([k]) => content.panels[k]);
  const lines = active.map(([key, c]) => `\`${key}\` · ${c.reviewChannelId ? `tombol "${c.label}" → <#${c.reviewChannelId}>` : 'belum lengkap (pilih channel peninjau)'}`);
  const embed = new EmbedBuilder().setColor(accent(content)).setTitle('FORMULIR PENGAJUAN').setDescription([
    'Member klik tombol di panel, isi formulir, dan pengajuannya masuk ke channel peninjau. Staff tinggal klik **Terima** atau **Tolak**. Kalau diterima, role bisa diberikan otomatis dan member diberi tahu lewat DM.',
    '',
    lines.join('\n') || 'Belum ada formulir. Pilih panel di bawah, misalnya request-approach, request-insider, atau report-anggota.',
  ].join('\n'));
  const options = formKeys(guild).map((key) => {
    const c = forms.configOf(guild.id, key, state);
    return { label: key.slice(0, 100), value: key, description: c ? (c.reviewChannelId ? 'aktif' : 'belum lengkap') : 'belum ada' };
  });
  return { embeds: [embed], components: options.length ? [row(new StringSelectMenuBuilder().setCustomId('fm:pick').setPlaceholder('Pilih panel...').addOptions(options))] : [] };
}

function formEditor(guild, key, notes = '') {
  const { content, state } = stats(guild);
  const cfg = forms.configOf(guild.id, key, state);
  const channel = panels.findChannel(guild, key, state);
  const fields = cfg?.fields ?? forms.DEFAULT_FIELDS;
  const lines = [
    `Panel: **${key}** · ${channel ?? '**channel belum ketemu**'}`,
    `Tombol: **${cfg?.label ?? 'Ajukan'}**`,
    `Isian: ${fields.map((f) => `${f.label}${f.long ? ' (panjang)' : ''}`).join(', ')}`,
    `Channel peninjau: ${cfg?.reviewChannelId ? `<#${cfg.reviewChannelId}>` : '**belum dipilih** (tombol baru muncul setelah ini dipilih)'}`,
    `Role kalau diterima: ${cfg?.roleId && guild.roles.cache.get(cfg.roleId) ? `<@&${cfg.roleId}>` : 'tidak ada'}`,
    '',
    'Satu orang hanya bisa punya satu pengajuan yang menunggu per formulir. Yang bisa menerima atau menolak: pengelola bot.',
  ];
  if (notes) lines.unshift(notes, '');

  const review = new ChannelSelectMenuBuilder().setCustomId(`fm:rev:${key}`).setPlaceholder('Channel peninjau (tempat pengajuan masuk)...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (cfg?.reviewChannelId && guild.channels.cache.has(cfg.reviewChannelId)) review.setDefaultChannels(cfg.reviewChannelId);
  const grant = new RoleSelectMenuBuilder().setCustomId(`fm:role:${key}`).setPlaceholder('Role yang diberikan kalau diterima (opsional)...').setMinValues(0).setMaxValues(1);
  if (cfg?.roleId && guild.roles.cache.get(cfg.roleId)) grant.setDefaultRoles(cfg.roleId);
  return {
    embeds: [new EmbedBuilder().setColor(accent(content)).setTitle(`FORMULIR · ${key}`).setDescription(lines.join('\n'))],
    components: [
      row(review), row(grant),
      row(button(`fm:fields:${key}`, 'Atur tombol & isian', ButtonStyle.Primary), button(`fm:del:${key}`, 'Hapus formulir', ButtonStyle.Danger).setDisabled(!cfg), button('fm:home', 'Kembali')),
    ],
  };
}

function channelPicker(customId, placeholder) {
  return {
    components: [row(new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder)
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1))],
  };
}

const toggleButton = (settings) => ([path, label]) => button(`set:t:${path}`, `${label}: ${getPath(settings, path) ? 'aktif' : 'mati'}`,
  getPath(settings, path) ? ButtonStyle.Success : ButtonStyle.Secondary);

// Halaman "Fitur lainnya": moderasi, auto-moderasi, sambutan, komunitas.
function fiturView(guild) {
  const settings = store.loadSettings();
  const state = store.loadState();
  const on = (b) => (b ? 'aktif' : 'mati');
  const ch = (mod) => panels.moduleChannel(guild, mod, state, settings);
  const m = settings.moderasi;
  const esk = require('./moderasi/aksi').formatEskalasi(m.eskalasi.aturan);
  const autoRole = settings.sambutan.roleOtomatis.filter((id) => guild.roles.cache.has(id));
  const lines = [
    `**Moderasi**: ${on(m.aktif)} · log di ${ch('moderasi') ?? 'channel logs-moderasi belum ketemu (hubungkan di bawah)'}`,
    '`/warn`, klik kanan member › Apps › **Beri peringatan** (pesannya dikirim lewat DM), `/dm`, `/mod` (timeout, kick, ban, purge, lock, riwayat, catatan).',
    `Eskalasi: ${on(m.eskalasi.aktif)} (${esk || 'belum diatur'}) · peringatan kedaluwarsa: ${m.kedaluwarsaHari ? `${m.kedaluwarsaHari} hari` : 'tidak'}`,
    `**Auto-moderasi**: ${on(settings.automod.aktif)} · atur aturannya dengan \`/automod status\``,
    `**Sambutan**: ${on(settings.sambutan.aktif)} · channel ${ch('sambutan') ?? 'selamat-datang belum ketemu (hubungkan di bawah)'} · role otomatis: ${autoRole.length ? autoRole.map((id) => `<@&${id}>`).join(' ') : 'tidak ada'}`,
    'Teks sambutan boleh pakai `{user}` `{nama}` `{server}` `{jumlah}` (atur lewat **Atur sambutan**).',
    `**Komunitas**: ${on(settings.komunitas.aktif)} · \`/poll\`, \`/giveaway\`, \`/ingatkan\`, \`/afk\`, \`/info\`, \`/umumkan\``,
    '',
    'Semua mati sampai kamu nyalakan. Command-nya baru muncul di Discord setelah fiturnya menyala.',
  ];
  if (!runtime.features.members) lines.push('', '**Server Members Intent belum nyala**: sambutan dan role otomatis tidak bisa jalan.');
  const embed = new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('FITUR LAINNYA').setDescription(lines.join('\n'));
  const toggle = toggleButton(settings);
  const bind = new StringSelectMenuBuilder().setCustomId('set:bindmod').setPlaceholder('Hubungkan channel log moderasi / sambutan...')
    .addOptions([{ label: MODULES.moderasi, value: 'moderasi' }, { label: MODULES.sambutan, value: 'sambutan' }]);
  const roles = new RoleSelectMenuBuilder().setCustomId('set:autorole').setPlaceholder('Role otomatis untuk member baru (opsional)...').setMinValues(0).setMaxValues(5);
  if (autoRole.length) roles.setDefaultRoles(...autoRole);
  return {
    embeds: [embed],
    components: [
      row(...FITUR.slice(0, 4).map(toggle)),
      row(...FITUR.slice(4, 8).map(toggle)),
      row(toggle(FITUR[8]), button('set:modtext', 'Atur moderasi'), button('set:welcometext', 'Atur sambutan'), button('dash:kasus', 'Kasus moderasi')),
      row(roles),
      row(bind),
    ],
  };
}

// Halaman "Bursa harga": nyalakan, perbarui harga (tempel daftar), pasang papan harga, atur siapa yang boleh mencatat.
function bursaView(guild) {
  const settings = store.loadSettings();
  const state = store.loadState();
  const c = settings.bursa;
  const on = (b) => (b ? 'aktif' : 'mati');
  const ch = panels.moduleChannel(guild, 'bursa', state, settings);
  const roles = (c.role ?? []).filter((id) => guild.roles.cache.has(id));
  const lines = [
    `**Bursa harga Disnaker**: ${on(c.aktif)}`,
    'Member: `/harga` (lihat daftar), `/jual` (catat jualan, total otomatis), `/penghasilan` (penghasilanku). Pengelola: `/rekap`, `/bursa`.',
  ];
  if (c.aktif) {
    const d = bursa.data.guild(guild.id);
    lines.push(
      bursa.summary(guild.id),
      `Papan harga: ${d.papan && guild.channels.cache.has(d.papan.channelId) ? `<#${d.papan.channelId}> (diperbarui otomatis)` : 'belum dipasang (klik **Pasang papan harga**)'}`,
    );
  }
  lines.push(
    `Log penjualan dan rekap: ${ch ?? 'channel logs-bursa belum ketemu (hubungkan di bawah)'} · log tiap penjualan ${on(c.log)} · rekap otomatis tiap Senin ${on(c.rekapMingguan)}`,
    `Boleh mencatat penjualan: ${roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : 'semua member'}`,
    '',
    'Harga baru dari Disnaker? Klik **Perbarui harga**, tempel pengumumannya apa adanya. Harga dibaca otomatis dan papan ikut diperbarui. Penghasilan yang sudah tercatat tidak berubah.',
    'Mati sampai kamu nyalakan. Command-nya baru muncul di Discord setelah menyala.',
  );
  const embed = new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('BURSA HARGA').setDescription(lines.join('\n'));
  const toggle = toggleButton(settings);
  const pilihRole = new RoleSelectMenuBuilder().setCustomId('set:bursarole').setPlaceholder('Role yang boleh mencatat penjualan (kosong = semua)...').setMinValues(0).setMaxValues(5);
  if (roles.length) pilihRole.setDefaultRoles(...roles);
  const bind = new StringSelectMenuBuilder().setCustomId('set:bindmod').setPlaceholder('Hubungkan channel log bursa...')
    .addOptions([{ label: MODULES.bursa, value: 'bursa' }]);
  return {
    embeds: [embed],
    components: [
      row(...BURSA.map(toggle)),
      row(button('set:bursaharga', 'Perbarui harga', ButtonStyle.Primary), button('set:bursapapan', 'Pasang papan harga'), button('dash:bursarekap', 'Rekap minggu ini')),
      row(pilihRole),
      row(bind),
    ],
  };
}

// Halaman "Game & level": nyalakan level dan game, atur angka, batasi channel, hubungkan channel pengumuman naik level.
function gameView(guild) {
  const settings = store.loadSettings();
  const state = store.loadState();
  const l = settings.level;
  const g = settings.game;
  const on = (b) => (b ? 'aktif' : 'mati');
  const ada = (ids) => (ids ?? []).filter((id) => guild.channels.cache.has(id));
  const gameCh = ada(g.channelBoleh);
  const abaikan = ada(l.abaikanChannel);
  const ch = panels.moduleChannel(guild, 'level', state, settings);
  const hadiah = (l.hadiah ?? []).filter((h) => guild.roles.cache.has(h.role));
  const num = (n) => Number(n).toLocaleString('id-ID');
  const lines = [
    `**Level**: ${on(l.aktif)} · XP ${l.xpMin}-${l.xpMaks} per pesan (jeda ${l.jedaDetik} detik) · voice ${l.voice && l.xpVoice ? `${l.xpVoice} XP per menit` : 'mati'}`,
    `Pengumuman naik level: ${l.umumkan ? (ch ? `${ch}` : 'di channel tempat orang ngobrol (channel level-up belum ketemu, hubungkan di bawah)') : 'mati'}`,
    `Hadiah role: ${hadiah.length ? hadiah.map((h) => `level ${h.level} → <@&${h.role}>`).join(', ') : 'belum ada (atur dengan `/atur-game hadiah`)'}`,
    `XP tidak dihitung di: ${abaikan.length ? abaikan.map((id) => `<#${id}>`).join(' ') : 'tidak ada yang dikecualikan'}`,
    '',
    `**Game**: ${on(g.aktif)} · hadiah harian ${num(g.harian)} koin · kuis ${num(g.kuis)} koin · naik level ${num(g.koinNaikLevel)} koin · taruhan maksimal ${num(g.taruhanMaks)}`,
    `Channel game: ${gameCh.length ? gameCh.map((id) => `<#${id}>`).join(' ') : 'semua channel'}`,
    '',
    'Member: `/rank` `/top` `/koin` `/harian` `/beri` `/game` `/slot` `/dadu` `/lempar` `/suit` `/xo` `/kuis` `/blackjack`. Pengelola: `/atur-game` (koin, XP, hadiah role, soal kuis).',
    'Mati sampai kamu nyalakan. Command-nya baru muncul di Discord setelah menyala.',
  ];
  if (l.aktif || g.aktif) lines.splice(lines.length - 2, 0, game.summary(guild.id), '');
  const embed = new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('GAME & LEVEL').setDescription(lines.join('\n'));
  const toggle = toggleButton(settings);
  const picker = (id, placeholder, ids) => {
    const m = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder)
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(10);
    if (ids.length) m.setDefaultChannels(...ids);
    return m;
  };
  const bind = new StringSelectMenuBuilder().setCustomId('set:bindmod').setPlaceholder('Hubungkan channel pengumuman naik level...')
    .addOptions([{ label: MODULES.level, value: 'level' }]);
  return {
    embeds: [embed],
    components: [
      row(...GAME.map(toggle), button('set:gamenum', 'Atur angka', ButtonStyle.Primary)),
      row(picker('set:gamechan', 'Game hanya di channel ini (kosong = semua channel)...', gameCh)),
      row(picker('set:levelabaikan', 'Channel yang tidak menghasilkan XP (opsional)...', abaikan)),
      row(bind),
    ],
  };
}

function settingsView(guild) {
  const settings = store.loadSettings();
  const state = store.loadState();
  const lines = Object.entries(MODULES).map(([mod, label]) => {
    const ch = panels.moduleChannel(guild, mod, state, settings)
      || (mod === 'pesan' ? panels.moduleChannel(guild, 'logs', state, settings) : null);
    return `**${label}**: ${settings[mod].aktif ? 'aktif' : 'mati'} · ${ch ?? 'channel tidak ketemu'}`;
  });
  const managerId = state.access[guild.id]?.roleId;
  lines.push(
    `**Panel otomatis**: ${settings.otomatis.panel ? 'aktif (panel dipasang dan diperbarui sendiri)' : 'mati (panel diposting kalau kamu klik)'}`,
    `**Role pengelola**: ${managerId && guild.roles.cache.get(managerId) ? `<@&${managerId}>` : 'belum dipilih (hanya yang punya izin Manage Server)'}`,
    '',
    'Semua fitur mati sampai kamu nyalakan. Angka lain (batas akun baru, hari tidak aktif, role roster, channel yang diabaikan) ada di settings.json.',
  );
  const embed = new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('PENGATURAN').setDescription(lines.join('\n'));

  const toggle = toggleButton(settings);
  const bind = new StringSelectMenuBuilder().setCustomId('set:bindmod').setPlaceholder('Hubungkan channel modul...')
    .addOptions(Object.entries(MODULES).map(([value, label]) => ({ label, value })));
  const mgr = new RoleSelectMenuBuilder().setCustomId('set:mgr').setPlaceholder('Role pengelola bot (opsional)...').setMinValues(0).setMaxValues(1);
  if (managerId && guild.roles.cache.get(managerId)) mgr.setDefaultRoles(managerId);
  return {
    embeds: [embed],
    components: [
      row(...TOGGLES.slice(0, 5).map(toggle)),
      row(...TOGGLES.slice(5, 10).map(toggle)),
      row(...TOGGLES.slice(10).map(toggle), button('set:statustext', 'Teks status & bio'), button('dash:pin', 'Taruh menu di channel ini')),
      row(bind),
      row(mgr),
    ],
  };
}

// ---------- akses channel (lihat permission + arahan) ----------

function accessHome() {
  const embed = new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('AKSES CHANNEL').setDescription([
    'Pilih **role** buat lihat channel apa saja yang dibuka role itu, dan atur arahannya: kalau ada yang dapat role itu, otomatis diarahkan ke channel yang kamu mau.',
    '',
    'Atau pilih **channel** buat lihat siapa saja yang bisa melihat dan menulis di sana.',
  ].join('\n'));
  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId('ac:role').setPlaceholder('Pilih role...').setMinValues(1).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId('ac:chan').setPlaceholder('Pilih channel...').setMinValues(1).setMaxValues(1)),
      row(button('ac:list', 'Daftar arahan')),
    ],
  };
}

function roleAccessView(guild, roleId, notes = '') {
  const role = guild.roles.cache.get(roleId);
  if (!role) return null;
  const { admin, channels } = akses.opensFor(guild, role);
  const cfg = akses.configOf(guild.id, roleId);
  const picked = (cfg?.channelIds ?? []).map((id) => guild.channels.cache.get(id)).filter(Boolean);

  const lines = [];
  if (notes) lines.push(notes, '');
  lines.push(admin
    ? 'Role ini punya izin **Administrator**: bisa melihat semua channel.'
    : channels.length
      ? `**Channel yang dibuka role ini** (${channels.length}):\n${akses.groupText(channels, 2200)}`
      : 'Role ini tidak membuka channel khusus (semua channel yang bisa dilihatnya juga terlihat oleh semua orang).');
  lines.push('', cfg
    ? [
      `**Arahan**: ${cfg.aktif ? 'aktif' : 'mati'}`,
      `Tujuan: ${picked.length ? picked.map((c) => `<#${c.id}>`).join(' ') : 'otomatis (channel yang dibuka role ini)'}`,
      `Pesan: ${cfg.note || '(tidak ada)'}`,
    ].join('\n')
    : '**Arahan**: belum diatur. Nyalakan supaya yang dapat role ini otomatis diberi tahu channel mana yang terbuka.');

  const embed = new EmbedBuilder().setColor(role.color || accent(store.loadContent())).setTitle(`AKSES · ${role.name}`).setDescription(lines.join('\n').slice(0, 4000));
  return {
    embeds: [embed],
    components: [row(
      button(`ac:tog:${roleId}`, cfg?.aktif ? 'Arahan: aktif' : 'Arahan: mati', cfg?.aktif ? ButtonStyle.Success : ButtonStyle.Secondary),
      button(`ac:pick:${roleId}`, 'Pilih channel tujuan'),
      button(`ac:note:${roleId}`, 'Tulis pesan'),
      button(`ac:del:${roleId}`, 'Hapus arahan', ButtonStyle.Danger).setDisabled(!cfg),
      button('ac:home', 'Kembali'),
    )],
  };
}

function arahanPicker(guild, roleId) {
  const cfg = akses.configOf(guild.id, roleId);
  const select = new ChannelSelectMenuBuilder().setCustomId(`ac:set:${roleId}`)
    .setPlaceholder('Pilih channel tujuan (kosong = otomatis)...').setMinValues(0).setMaxValues(10);
  const current = (cfg?.channelIds ?? []).filter((id) => guild.channels.cache.has(id));
  if (current.length) select.setDefaultChannels(...current);
  return { components: [row(select)] };
}

function channelAccessView(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return null;
  const r = akses.rolesFor(guild, channel);
  const list = (roles) => (roles.length ? roles.map((x) => `<@&${x.id}>`).join(' ') : 'tidak ada role khusus');
  const lines = [
    `Channel: <#${channel.id}>${channel.parent ? ` · ${channel.parent.name}` : ''}`,
    '',
    r.everyoneSees ? '**Dilihat oleh**: semua orang (@everyone)' : `**Dilihat oleh**: ${list(r.view)}`,
    r.everyoneActs ? `**${r.voice ? 'Bisa masuk' : 'Bisa kirim pesan'}**: semua orang` : `**${r.voice ? 'Bisa masuk' : 'Bisa kirim pesan'}**: ${list(r.act)}`,
    '',
    'Role dengan izin Administrator dan role bot tidak ditampilkan.',
  ];
  return { embeds: [new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('SIAPA BISA MASUK').setDescription(lines.join('\n').slice(0, 4000))] };
}

function arahanList(guild) {
  const all = store.loadState().arahan[guild.id] ?? {};
  const lines = Object.entries(all).filter(([id]) => guild.roles.cache.has(id)).map(([id, cfg]) => {
    const chs = akses.targets(guild, id, cfg);
    return `<@&${id}> · ${cfg.aktif ? 'aktif' : 'mati'} · ${chs.length ? chs.slice(0, 6).map((c) => `<#${c.id}>`).join(' ') : 'tanpa tujuan'}`;
  });
  return { embeds: [new EmbedBuilder().setColor(accent(store.loadContent())).setTitle('DAFTAR ARAHAN').setDescription(lines.join('\n') || 'Belum ada arahan.')] };
}

function imageView(guild, notes = '') {
  const content = store.loadContent();
  const preview = panels.buildMessage(
    { title: 'PRATINJAU', description: 'Begini logo dan banner tampil di setiap panel.' },
    content.meta, guild, store.loadState(), true,
  );
  const status = `Logo: ${content.meta.logo || 'belum ada'}  ·  Banner: ${content.meta.banner || 'belum ada'}`;
  return {
    content: [notes, status].filter(Boolean).join('\n'),
    embeds: preview.embeds,
    files: preview.files,
    components: [row(
      button('img:up', 'Upload logo & banner', ButtonStyle.Primary),
      button('img:rm:logo', 'Copot logo').setDisabled(!content.meta.logo),
      button('img:rm:banner', 'Copot banner').setDisabled(!content.meta.banner),
    )],
  };
}

function listEmbed(guild) {
  const { content, state, keys } = stats(guild);
  const lines = keys.map((key) => {
    const ch = panels.findChannel(guild, key, state);
    const tags = [content.panels[key].draft && 'draft', state.panels[key]?.messageIds?.length && 'terposting'].filter(Boolean);
    return `\`${key}\` › ${ch ? `<#${ch.id}>` : '**channel tidak ketemu**'}${tags.length ? ` · ${tags.join(', ')}` : ''}`;
  });
  return new EmbedBuilder().setColor(accent(content)).setTitle('Daftar panel').setDescription(lines.join('\n').slice(0, 4000) || 'Belum ada panel.');
}

// Ringkasan moderasi untuk kartu anggota: peringatan aktif dan kasus terakhir (kosong kalau belum pernah ada kasus).
function modLine(guild, user) {
  const kasus = require('./moderasi/kasus');
  const nama = require('./moderasi/tampilan').nama;
  const list = kasus.forUser(guild.id, user.id).filter((c) => c.type !== 'catatan' && c.type !== 'dm');
  if (!list.length) return null;
  const aktif = kasus.activeWarns(guild.id, user.id, store.loadSettings().moderasi.kedaluwarsaHari).length;
  const n = (t) => list.filter((c) => c.type === t).length;
  const last = list[0];
  return `**${aktif}** peringatan aktif · ${n('timeout')} timeout · ${n('kick')} kick · ${n('ban')} ban\nTerakhir: #${last.id} ${nama(last.type)} ${ts(last.at)}`;
}

// Kartu data anggota (dari menu pilih anggota atau klik kanan > Apps > Data anggota).
function profileEmbed(guild, user, member) {
  const cfg = store.loadSettings();
  const p = members.get(guild.id, user.id);
  const embed = new EmbedBuilder().setColor(accent(store.loadContent())).setTitle(user.tag ?? user.username)
    .setThumbnail(user.displayAvatarURL()).setFooter({ text: `ID ${user.id}` });
  const mod = modLine(guild, user);
  if (!p) {
    embed.setDescription(`${user}\nBelum ada datanya. Data mulai tercatat sejak bot aktif di server ini.`);
    return mod ? embed.addFields({ name: 'Moderasi', value: mod }) : embed;
  }
  const joined = member?.joinedTimestamp ?? p.joins.at(-1);
  const week = members.recent(p, cfg.aktivitas.hari);
  const roles = member ? [...member.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`).join(' ') : '-';
  embed.setDescription(`${user} · ${p.inGuild ? 'ada di server' : '**sudah keluar**'}`).addFields(
    { name: 'Akun dibuat', value: ts(user.createdTimestamp, 'D'), inline: true },
    { name: 'Bergabung', value: joined ? ts(joined, 'D') : '-', inline: true },
    { name: 'Masuk / keluar', value: `${p.joinCount}x / ${p.leaveCount}x`, inline: true },
    { name: 'Role', value: roles.slice(0, 1000) || '-' },
    { name: `${cfg.aktivitas.hari} hari terakhir`, value: `${week.msgs} pesan · ${minutes(week.voice)} voice`, inline: true },
    { name: 'Total tercatat', value: `${p.msgs} pesan · ${minutes(p.voice)} voice`, inline: true },
    { name: 'Terakhir aktif', value: p.lastActive ? ts(p.lastActive) : 'belum tercatat', inline: true },
  );
  if (p.invitedBy) embed.addFields({ name: 'Diundang oleh', value: `<@${p.invitedBy}>`, inline: true });
  if (mod) embed.addFields({ name: 'Moderasi', value: `${mod}\nDetail: \`/mod riwayat\`` });
  if (p.nicks.length) {
    embed.addFields({ name: 'Riwayat nickname', value: p.nicks.slice(-3).map((n) => `${ts(n.at, 'd')} ${n.from ?? '(kosong)'} → ${n.to ?? '(kosong)'}`).join('\n').slice(0, 1000) });
  }
  return embed;
}

module.exports = {
  stats, nextDraft, TOGGLES, FITUR, BURSA, GAME, MODULES, togglePath, controlPayload, refreshDashboard, pinDashboard,
  statusView, formChooser, formEditor, accessHome, roleAccessView, arahanPicker, channelAccessView, arahanList,
  panelDetail, roleChooser, roleEditor, channelPicker, settingsView, fiturView, bursaView, gameView, imageView, listEmbed, profileEmbed,
};
