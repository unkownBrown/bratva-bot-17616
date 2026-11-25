const path = require('node:path');
const {
  SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, InteractionContextType, ChannelType, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, FileUploadBuilder, EmbedBuilder,
} = require('discord.js');
const store = require('./store');
const panels = require('./panels');
const dashboard = require('./dashboard');
const access = require('./access');
const backup = require('./backup');
const logs = require('./logs');
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

const EPHEMERAL = MessageFlags.Ephemeral;
const CTX_NAME = 'Data anggota';

// Satu-satunya command: /panel membuka menu. Logo dan banner boleh dilampirkan langsung (cadangan kalau form upload tidak muncul).
const definition = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Buka menu kontrol bot')
  .setContexts(InteractionContextType.Guild)
  .addAttachmentOption((o) => o.setName('logo').setDescription('Logo kecil di pojok kanan atas panel'))
  .addAttachmentOption((o) => o.setName('banner').setDescription('Banner lebar di bawah teks panel (GIF boleh)'));

const userMenu = new ContextMenuCommandBuilder()
  .setName(CTX_NAME)
  .setType(ApplicationCommandType.User)
  .setContexts(InteractionContextType.Guild);

// Command musik, moderasi, komunitas, dan bursa harga ikut terdaftar hanya kalau fiturnya dinyalakan (Pengaturan / Fitur lainnya).
const commandJSON = () => [definition.toJSON(), userMenu.toJSON(), ...musik.enabledCommands(), ...moderasi.enabledCommands(), ...komunitas.enabledCommands(), ...bursa.enabledCommands(), ...game.enabledCommands()];

// ---------- helpers ----------

const hint = (r) => {
  if (r.noAccess) return ' (bot belum punya izin View Channel / Send Messages / Embed Links di sana)';
  if (r.tooBig) return ' (gambarnya kebesaran: batas upload 10 MB di server tanpa boost. Kecilkan filenya atau pakai link)';
  return '';
};

function describe(r) {
  switch (r.status) {
    case 'ok': return `${r.sent ? 'Terkirim' : 'Diperbarui'}: ${r.channel}`;
    case 'missing': return `Channel untuk "${r.key}" tidak ketemu. Buat channelnya (panel terpasang otomatis) atau hubungkan lewat menu panel.`;
    case 'unknown': return `Panel "${r.key}" tidak ada.`;
    default: return `Gagal kirim ke ${r.channel}: ${r.error}${hint(r)}`;
  }
}

async function guarded(interaction, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    const text = `Gagal: ${err.message}`.slice(0, 1900);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: text, components: [] }).catch(() => {});
    else await interaction.reply({ content: text, flags: EPHEMERAL }).catch(() => {});
  }
}

const reply = (interaction, content) => interaction.reply({ content, flags: EPHEMERAL });
const defer = (interaction) => interaction.deferReply({ flags: EPHEMERAL });
const refreshDash = (guild) => runtime.debounce(`dash:${guild.id}`, 1500, () => dashboard.refreshDashboard(guild));

const field = (id, label, style, { value, placeholder, max, required = false } = {}) => {
  const input = new TextInputBuilder().setCustomId(id).setLabel(String(label).slice(0, 45)).setStyle(style).setRequired(required);
  if (value) input.setValue(String(value).slice(0, max ?? 4000));
  if (placeholder) input.setPlaceholder(String(placeholder).slice(0, 100));
  if (max) input.setMaxLength(max);
  return new ActionRowBuilder().addComponents(input);
};

const cleanColor = (v) => {
  const hex = String(v ?? '').trim().replace(/^#/, '');
  if (!hex) return { value: null };
  return /^[0-9a-f]{6}$/i.test(hex) ? { value: `#${hex.toLowerCase()}` } : { error: true };
};

// Boleh link http(s) atau nama file yang ada di folder assets (contoh: banner.gif).
const IMAGE_ERROR = 'Gambar harus berupa link http(s) atau nama file yang ada di folder assets. Untuk upload file, pakai tombol Logo & banner.';
const cleanImage = (v) => {
  const ref = String(v ?? '').trim();
  if (!ref) return { value: null };
  return panels.isImageRef(ref) ? { value: ref } : { error: true };
};

// ---------- modal ----------

function editModal(key, idx = 1) {
  const msg = store.loadContent().panels[key]?.messages?.[idx - 1];
  if (!msg) return null;
  return new ModalBuilder()
    .setCustomId(`edit:${key}:${idx}`)
    .setTitle(`Edit ${key}${idx > 1 ? ` (${idx})` : ''}`.slice(0, 45))
    .addComponents(
      field('judul', 'Judul', TextInputStyle.Short, { value: msg.title, max: 256 }),
      field('isi', 'Isi', TextInputStyle.Paragraph, {
        value: panels.asText(msg.description), max: 4000,
        placeholder: 'Boleh pakai {#nama-channel}, {@Nama Role}, {server}',
      }),
      field('warna', 'Warna (hex, kosong = bawaan)', TextInputStyle.Short, { value: msg.color, max: 7, placeholder: '#8c1c1c' }),
      field('gambar', 'Banner (link / nama file di assets)', TextInputStyle.Short, { value: msg.image, max: 400, placeholder: 'kosong = pakai banner bawaan' }),
      field('thumbnail', 'Logo kecil (link / nama file di assets)', TextInputStyle.Short, { value: msg.thumbnail, max: 400, placeholder: 'kosong = pakai logo bawaan' }),
    );
}

const quickAddModal = () => new ModalBuilder()
  .setCustomId('quickadd')
  .setTitle('Channel baru + isinya')
  .addComponents(
    field('nama', 'Nama channel', TextInputStyle.Short, { required: true, max: 90 }),
    field('kategori', 'Kategori (nama, opsional)', TextInputStyle.Short, { max: 100, placeholder: 'contoh: PUBLIC ROOM' }),
    field('judul', 'Judul', TextInputStyle.Short, { max: 256 }),
    field('isi', 'Isi', TextInputStyle.Paragraph, { required: true, max: 4000, placeholder: 'Boleh pakai {#nama-channel}, {@Nama Role}, {server}' }),
    field('gambar', 'Banner (link / nama file di assets)', TextInputStyle.Short, { max: 400 }),
  );

const imageModal = () => new ModalBuilder()
  .setCustomId('img:submit')
  .setTitle('Logo & banner')
  .addLabelComponents(
    new LabelBuilder().setLabel('Logo (kecil, pojok kanan atas)').setDescription('png, jpg, gif, atau webp. Boleh dikosongkan.')
      .setFileUploadComponent(new FileUploadBuilder().setCustomId('logo').setRequired(false).setMinValues(0).setMaxValues(1)),
    new LabelBuilder().setLabel('Banner (lebar, GIF boleh)').setDescription('png, jpg, gif, atau webp. Boleh dikosongkan.')
      .setFileUploadComponent(new FileUploadBuilder().setCustomId('banner').setRequired(false).setMinValues(0).setMaxValues(1)),
  );

// ---------- aksi bersama ----------

async function syncAndReport(interaction, { all }) {
  const guild = interaction.guild;
  const r = await panels.syncGuild(guild, { all });
  const out = [`${r.ok.length} panel diperbarui${r.same.length ? `, ${r.same.length} sudah sama` : ''}.`];
  if (r.missing.length) out.push(`Channel belum ketemu: ${r.missing.join(', ')}`);
  if (r.draft.length) out.push(`Masih draft (belum diposting): ${r.draft.join(', ')}`);
  if (r.failed.length) out.push(`Gagal:\n${r.failed.map((f) => `${f.key}: ${f.error}${hint(f)}`).join('\n')}`);
  refreshDash(guild);
  return out.join('\n\n').slice(0, 1900);
}

// Simpan logo / banner dari lampiran Discord, lalu terapkan otomatis ke semua panel.
async function saveImages(interaction, uploads) {
  const content = store.loadContent();
  const notes = [];
  for (const [slot, att] of uploads) {
    if (!att) continue;
    const ext = path.extname(att.name ?? '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      notes.push(`${slot}: format "${ext || '?'}" tidak didukung. Pakai png, jpg, gif, atau webp.`);
      continue;
    }
    const res = await fetch(att.url);
    if (!res.ok) {
      notes.push(`${slot}: gagal mengunduh filenya (${res.status}).`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    panels.saveAsset(slot, ext, buffer);
    content.meta[slot] = `${slot}${ext}`;
    const mb = buffer.length / 1048576;
    notes.push(`${slot}: tersimpan (${mb.toFixed(1)} MB)${mb > 10 ? '. Di atas 10 MB, bisa gagal terkirim di server tanpa boost.' : ''}`);
  }
  store.saveContent(content);
  await panels.syncGuild(interaction.guild, { onlyPosted: true });
  backupSoon(interaction.guild);
  return notes.join('\n');
}

function backupSoon(guild) {
  if (store.loadSettings().backup.aktif) runtime.debounce(`backup:${guild.id}`, 60000, () => backup.run(guild));
}

async function createWithContent(interaction, { name, parentId, title, description, image }) {
  const guild = interaction.guild;
  const channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId ?? undefined });

  const content = store.loadContent();
  const base = panels.slug(name) || `panel-${Date.now().toString(36)}`;
  let key = base;
  for (let n = 2; content.panels[key]; n++) key = `${base}-${n}`;

  const msg = {};
  if (title) msg.title = title;
  msg.description = description;
  if (image) msg.image = image;
  content.panels[key] = { messages: [msg] };
  store.saveContent(content);

  const state = store.loadState();
  state.panels[key] = { channelId: channel.id, messageIds: [] };
  store.saveState(state);

  await panels.warm(guild);
  const r = await panels.publish(guild, key, { force: true });
  refreshDash(guild);
  backupSoon(guild);
  await interaction.editReply(
    r.status === 'ok'
      ? `Channel ${channel} dibuat dan isinya sudah diposting. Ubah lagi lewat menu panel (pilih "${key}").`
      : `Channel ${channel} dibuat, tapi posting gagal. ${describe(r)}`,
  );
}

// ---------- slash & context menu ----------

async function openMenu(interaction) {
  await defer(interaction);
  await panels.warm(interaction.guild);
  await interaction.editReply(dashboard.controlPayload(interaction.guild));
}

async function slashPanel(interaction) {
  const logo = interaction.options.getAttachment('logo');
  const banner = interaction.options.getAttachment('banner');
  if (!logo && !banner) return openMenu(interaction);
  await defer(interaction);
  const notes = await saveImages(interaction, [['logo', logo], ['banner', banner]]);
  await interaction.editReply(dashboard.imageView(interaction.guild, `${notes}\nSudah diterapkan ke panel yang sudah terposting.`));
}

async function memberCard(interaction, userId) {
  await defer(interaction);
  const guild = interaction.guild;
  const user = await guild.client.users.fetch(userId);
  const member = await guild.members.fetch(userId).catch(() => null);
  await interaction.editReply({ embeds: [dashboard.profileEmbed(guild, user, member)] });
}

// ---------- tombol & select ----------

async function handleDash(interaction, action) {
  const guild = interaction.guild;
  switch (action) {
    case 'resync':
      await defer(interaction);
      return interaction.editReply(await syncAndReport(interaction, { all: true }));
    case 'draft': {
      const key = dashboard.nextDraft();
      if (!key) return reply(interaction, 'Semua panel sudah terisi.');
      return interaction.showModal(editModal(key, 1));
    }
    case 'add':
      return interaction.showModal(quickAddModal());
    case 'img':
      await defer(interaction);
      return interaction.editReply(dashboard.imageView(guild));
    case 'list':
      await defer(interaction);
      await panels.warm(guild);
      return interaction.editReply({ embeds: [dashboard.listEmbed(guild)] });
    case 'set':
      await defer(interaction);
      return interaction.editReply(dashboard.settingsView(guild));
    case 'roles':
      await defer(interaction);
      return interaction.editReply(dashboard.roleChooser(guild));
    case 'forms':
      await defer(interaction);
      return interaction.editReply(dashboard.formChooser(guild));
    case 'fitur':
      await defer(interaction);
      return interaction.editReply(dashboard.fiturView(guild));
    case 'bursa':
      await defer(interaction);
      return interaction.editReply(dashboard.bursaView(guild));
    case 'bursarekap':
      await defer(interaction);
      return interaction.editReply({ embeds: [bursa.rekapEmbedUntuk(guild.id, 'minggu')] });
    case 'game':
      await defer(interaction);
      return interaction.editReply(dashboard.gameView(guild));
    case 'kasus':
      await defer(interaction);
      return interaction.editReply({ embeds: [moderasi.kasusTerbaru(guild)] });
    case 'update':
      return startUpdate(interaction);
    case 'rollback':
      return rollbackUpdate(interaction);
    case 'status':
      await defer(interaction);
      return interaction.editReply(dashboard.statusView(guild));
    case 'access':
      await defer(interaction);
      await panels.warm(guild);
      return interaction.editReply(dashboard.accessHome());
    case 'pin':
      await defer(interaction);
      await dashboard.pinDashboard(guild, interaction.channel);
      return interaction.editReply('Menu kontrol dipasang di channel ini. Isinya diperbarui otomatis. Hapus pesannya kalau sudah tidak mau.');
    case 'backup':
      await defer(interaction);
      if (!panels.moduleChannel(guild, 'backup')) {
        return interaction.editReply('Pilih dulu channel backup (channel privat) lewat Pengaturan, bagian "Hubungkan channel modul".');
      }
      await backup.run(guild);
      return interaction.editReply('Cadangan tersimpan di channel panel-backup.');
    case 'pick': {
      const view = dashboard.panelDetail(guild, interaction.values[0]);
      if (!view) return reply(interaction, 'Panel itu sudah tidak ada.');
      return interaction.reply({ ...view, flags: EPHEMERAL });
    }
    case 'member':
      return memberCard(interaction, interaction.values[0]);
    default:
  }
}

async function handlePanelDetail(interaction, action, key, idx) {
  const guild = interaction.guild;
  switch (action) {
    case 'edit': {
      const modal = editModal(key, Number(idx));
      if (!modal) return reply(interaction, 'Panel itu sudah tidak ada.');
      return interaction.showModal(modal);
    }
    case 'post':
      await defer(interaction);
      await panels.warm(guild);
      return interaction.editReply(describe(await panels.publish(guild, key, { force: true })));
    case 'roles':
      return interaction.reply({ ...dashboard.roleEditor(guild, key), flags: EPHEMERAL });
    case 'bind':
      return interaction.reply({
        content: `Pilih channel tujuan untuk panel "${key}":`, flags: EPHEMERAL,
        ...dashboard.channelPicker(`bind:${key}`, 'Pilih channel...'),
      });
    case 'del': {
      return interaction.reply({
        content: `Hapus panel "${key}" beserta pesan botnya? Channelnya tidak disentuh. Cadangan teks ada di content.bak.json.`,
        flags: EPHEMERAL,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pd:delok:${key}`).setLabel('Ya, hapus').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('pd:no').setLabel('Batal').setStyle(ButtonStyle.Secondary),
        )],
      });
    }
    case 'delok': {
      await interaction.deferUpdate();
      const content = store.loadContent();
      if (content.panels[key]) {
        await panels.warm(guild);
        await panels.unpublish(guild, key);
        delete content.panels[key];
        store.saveContent(content);
        backupSoon(guild);
        refreshDash(guild);
      }
      return interaction.editReply({ content: `Panel "${key}" dihapus.`, components: [] });
    }
    case 'no':
      return interaction.update({ content: 'Dibatalkan.', components: [] });
    default:
  }
}

async function handleSettings(interaction, action, arg) {
  const guild = interaction.guild;
  if (action === 't') {
    const allowed = [...dashboard.TOGGLES, ...dashboard.FITUR, ...dashboard.BURSA, ...dashboard.GAME].map(([p]) => p);
    if (!allowed.includes(arg)) return;
    const settings = store.loadSettings();
    const turningOn = !arg.split('.').reduce((o, k) => o?.[k], settings);
    const needs = { 'logs.aktif': 'members', 'roster.aktif': 'members', 'aktivitas.aktif': 'members', 'sambutan.aktif': 'members' }[arg];
    if (turningOn && needs && !runtime.features[needs]) {
      return reply(interaction, needs === 'members'
        ? 'Server Members Intent belum dinyalakan. Buka Developer Portal, tab Bot, nyalakan Server Members Intent, lalu restart bot.'
        : 'Message Content Intent belum dinyalakan. Buka Developer Portal, tab Bot, nyalakan Message Content Intent, lalu restart bot.');
    }
    if (turningOn && arg === 'backup.aktif' && !panels.moduleChannel(guild, 'backup')) {
      return reply(interaction, 'Pilih dulu channel backup (channel privat) lewat "Hubungkan channel modul".');
    }
    dashboard.togglePath(settings, arg);
    store.saveSettings(settings);
    refreshDash(guild);
    const boards = require('./boards');
    if (turningOn && (arg === 'roster.aktif' || arg === 'aktivitas.aktif')) boards.refreshAll(guild).catch(() => {});
    if (turningOn && (arg === 'logs.aktif' || arg === 'logs.invite')) require('./logs').snapshotInvites(guild).catch(() => {});
    if (turningOn && arg === 'otomatis.panel') runtime.debounce(`sync:${guild.id}`, 1000, () => panels.syncGuild(guild));
    if (arg === 'musik.aktif') {
      // Command musik dipasang / dilepas, mesin musik disiapkan (atau semua sesi dihentikan).
      guild.commands.set(commandJSON()).catch((err) => console.error(`[musik] pasang command: ${err.message}`));
      if (turningOn) musik.warmup();
      else musik.stopAll().catch(() => {});
    }
    if (['moderasi.aktif', 'automod.aktif', 'komunitas.aktif', 'bursa.aktif', 'level.aktif', 'game.aktif'].includes(arg)) {
      guild.commands.set(commandJSON()).catch((err) => console.error(`[fitur] pasang command: ${err.message}`));
    }
    if (arg === 'status.aktif') Promise.resolve(turningOn ? statusLib.refresh(interaction.client) : statusLib.clear(interaction.client)).catch(() => {});
    if (arg === 'status.bio' && turningOn) statusLib.refresh(interaction.client, { forceBio: true }).catch(() => {});
    if (dashboard.BURSA.some(([p]) => p === arg)) return interaction.update(dashboard.bursaView(guild));
    if (dashboard.GAME.some(([p]) => p === arg)) return interaction.update(dashboard.gameView(guild));
    const fitur = dashboard.FITUR.some(([p]) => p === arg);
    return interaction.update(fitur ? dashboard.fiturView(guild) : dashboard.settingsView(guild));
  }
  if (action === 'modtext') return interaction.showModal(moderasi.settingsModal());
  if (action === 'welcometext') return interaction.showModal(komunitas.sambutan.settingsModal());
  if (action === 'bursaharga') return interaction.showModal(bursa.hargaModal('set:bursasubmit'));
  if (action === 'bursapapan') {
    return interaction.reply({ content: 'Pilih channel untuk papan harga (pesannya diperbarui otomatis setiap harga berubah):', flags: EPHEMERAL, ...dashboard.channelPicker('bind:$papan', 'Pilih channel...') });
  }
  if (action === 'gamenum') return interaction.showModal(game.angkaModal('set:gamesubmit'));
  if (action === 'gamechan' || action === 'levelabaikan') {
    const settings = store.loadSettings();
    const ids = (interaction.values ?? []).slice(0, 10);
    if (action === 'gamechan') settings.game.channelBoleh = ids;
    else settings.level.abaikanChannel = ids;
    store.saveSettings(settings);
    return interaction.update(dashboard.gameView(guild));
  }
  if (action === 'bursarole') {
    const settings = store.loadSettings();
    settings.bursa.role = (interaction.values ?? []).slice(0, 5);
    store.saveSettings(settings);
    return interaction.update(dashboard.bursaView(guild));
  }
  if (action === 'autorole') {
    const settings = store.loadSettings();
    const chosen = interaction.values ?? [];
    const safe = chosen.filter((id) => safety.isSafeRole(guild, guild.roles.cache.get(id)));
    settings.sambutan.roleOtomatis = safe;
    store.saveSettings(settings);
    await interaction.update(dashboard.fiturView(guild));
    if (safe.length < chosen.length) {
      await interaction.followUp({ content: 'Sebagian role ditolak: role bot, role di atas role bot, atau role dengan izin berbahaya (admin, kelola server / role / channel, kick, ban, timeout, hapus pesan) tidak boleh dibagi otomatis.', flags: EPHEMERAL }).catch(() => {});
    }
    return null;
  }
  if (action === 'bindmod') {
    const mod = interaction.values[0];
    return interaction.reply({
      content: `Pilih channel untuk ${dashboard.MODULES[mod] ?? mod}:`, flags: EPHEMERAL,
      ...dashboard.channelPicker(`bind:@${mod}`, 'Pilih channel...'),
    });
  }
  if (action === 'statustext') {
    const cfg = store.loadSettings().status;
    return interaction.showModal(new ModalBuilder().setCustomId('set:statussubmit').setTitle('Teks status & bio')
      .addComponents(
        field('teks', 'Teks status (di bawah nama bot)', TextInputStyle.Short, { value: cfg.teks, max: 128, required: true, placeholder: '{online} online · {anggota} anggota' }),
        field('bio', 'Teks bio bot (About Me)', TextInputStyle.Paragraph, { value: cfg.bioTeks, max: 400, required: true, placeholder: '{server} · {online} online dari {total} member' }),
      ));
  }
  if (action === 'mgr') {
    access.setManagerRole(guild.id, interaction.values[0] ?? null);
    return interaction.update(dashboard.settingsView(guild));
  }
}

// Pilihan channel dari menu "Hubungkan channel" (panel atau modul).
async function handleBind(interaction, target) {
  await interaction.deferUpdate();
  const guild = interaction.guild;
  const channelId = interaction.values[0];
  if (target === '$papan') {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.send) return interaction.editReply({ content: 'Channel itu tidak bisa dipakai.', components: [] });
    try {
      await bursa.pasangPapan(guild, channel);
    } catch (err) {
      return interaction.editReply({ content: `Gagal memasang papan di <#${channelId}>: ${err.message}. Pastikan bot boleh melihat dan menulis di sana.`, components: [] });
    }
    return interaction.editReply({ content: `Papan harga terpasang di <#${channelId}> dan diperbarui otomatis setiap harga berubah.`, components: [] });
  }
  const state = store.loadState();
  if (target.startsWith('@')) {
    const mod = target.slice(1);
    state.modules[mod] = { channelId };
    store.saveState(state);
    const boards = require('./boards');
    if (mod === 'roster') boards.refreshRoster(guild).catch(() => {});
    if (mod === 'aktivitas') boards.refreshActivity(guild).catch(() => {});
    if (mod === 'logs') require('./logs').snapshotInvites(guild).catch(() => {});
    return interaction.editReply({ content: `${dashboard.MODULES[mod] ?? mod} sekarang di <#${channelId}>.`, components: [] });
  }
  const prev = state.panels[target];
  state.panels[target] = { channelId, messageIds: prev?.channelId === channelId ? prev.messageIds ?? [] : [] };
  store.saveState(state);
  await panels.warm(guild);
  const r = await panels.publish(guild, target);
  refreshDash(guild);
  return interaction.editReply({
    content: r.status === 'draft' ? `"${target}" terhubung ke <#${channelId}>. Panelnya masih draft, isi dulu lewat menu.` : describe(r),
    components: [],
  });
}

// Admin mengatur role apa saja yang boleh diambil member di sebuah panel.
async function handleRoleMenu(interaction, action, key) {
  const guild = interaction.guild;
  switch (action) {
    case 'pick':
      return interaction.update(dashboard.roleEditor(guild, interaction.values[0]));
    case 'back':
      return interaction.update(dashboard.roleChooser(guild));
    case 'ex': {
      const menu = rolemenu.menuOf(guild.id, key);
      rolemenu.update(guild.id, key, { exclusive: !menu?.exclusive });
      return interaction.update(dashboard.roleEditor(guild, key));
    }
    case 'set':
    case 'clear': {
      await interaction.deferUpdate();
      await panels.warm(guild);
      const picked = action === 'clear' ? [] : interaction.values;
      const safe = [];
      const skipped = [];
      for (const id of picked) {
        const role = guild.roles.cache.get(id);
        if (role && safety.isSafeRole(guild, role)) safe.push(id);
        else skipped.push(role?.name ?? id);
      }
      rolemenu.update(guild.id, key, { roleIds: safe });
      const r = await panels.publish(guild, key);
      const notes = [
        skipped.length ? `Tidak dimasukkan (role bot, izin admin / kelola, atau di atas role bot): ${skipped.join(', ')}` : null,
        r.status === 'ok' || r.status === 'same' ? `Menu sudah dipasang di ${r.channel}.` : null,
        r.status === 'missing' ? 'Channel panel ini belum ketemu. Menu terpasang otomatis begitu channelnya ada.' : null,
        r.status === 'draft' ? 'Panel ini masih draft. Menu muncul setelah panelnya diisi dan diposting.' : null,
        r.status === 'error' ? `Gagal memasang menu: ${r.error}${hint(r)}` : null,
      ].filter(Boolean).join('\n');
      backupSoon(guild);
      return interaction.editReply(dashboard.roleEditor(guild, key, notes));
    }
    default:
  }
}

// Member menekan tombol / dropdown role di panel. Siapa saja boleh, tapi hanya untuk role yang
// dipilih admin dan masih aman. Cek diulang di sini, jadi tombol palsu atau role lama tidak berguna.
async function takeRole(interaction) {
  const [, key, buttonRoleId] = interaction.customId.split(':');
  const roleId = buttonRoleId ?? interaction.values?.[0];
  const guild = interaction.guild;
  await defer(interaction);

  const menu = rolemenu.menuOf(guild.id, key);
  const role = guild.roles.cache.get(roleId);
  if (!menu?.roleIds.includes(roleId) || !role || !safety.isSafeRole(guild, role)) {
    return interaction.editReply('Role ini sudah tidak tersedia.');
  }
  const member = await guild.members.fetch(interaction.user.id);
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(role, 'Take role');
      return interaction.editReply(`Role **${role.name}** dicopot.`);
    }
    await member.roles.add(role, 'Take role');
    akses.suppress(guild.id, member.id, roleId);
    let extra = '';
    if (menu.exclusive) {
      const others = menu.roleIds.filter((id) => id !== roleId && member.roles.cache.has(id)).map((id) => guild.roles.cache.get(id)).filter(Boolean);
      if (others.length) {
        await member.roles.remove(others, 'Take role (mode satu saja)');
        extra = ` Role lain di menu ini dicopot: ${others.map((r) => r.name).join(', ')}.`;
      }
    }
    const direction = akses.directionEmbed(guild, [roleId]);
    return interaction.editReply({ content: `Role **${role.name}** ditambahkan.${extra}`, embeds: direction ? [direction] : [] });
  } catch (err) {
    if (err.code === 50013) return interaction.editReply('Bot tidak bisa mengubah role kamu (posisi role kamu lebih tinggi dari bot).');
    throw err;
  }
}

// Lihat permission channel dan atur arahan role.
async function handleAccess(interaction, action, roleId) {
  const guild = interaction.guild;
  switch (action) {
    case 'home':
      return interaction.update(dashboard.accessHome());
    case 'role': {
      const view = dashboard.roleAccessView(guild, interaction.values[0]);
      return view ? interaction.update(view) : reply(interaction, 'Role itu sudah tidak ada.');
    }
    case 'chan': {
      const view = dashboard.channelAccessView(guild, interaction.values[0]);
      return view ? interaction.update(view) : reply(interaction, 'Channel itu sudah tidak ada.');
    }
    case 'list':
      return interaction.reply({ ...dashboard.arahanList(guild), flags: EPHEMERAL });
    case 'tog': {
      const cfg = akses.configOf(guild.id, roleId);
      akses.setConfig(guild.id, roleId, { aktif: cfg ? !cfg.aktif : true });
      backupSoon(guild);
      return interaction.update(dashboard.roleAccessView(guild, roleId));
    }
    case 'pick':
      return interaction.reply({
        content: 'Pilih channel tujuan arahan. Kosongkan pilihan = otomatis (channel yang dibuka role itu).',
        flags: EPHEMERAL, ...dashboard.arahanPicker(guild, roleId),
      });
    case 'set':
      akses.setConfig(guild.id, roleId, { channelIds: interaction.values });
      backupSoon(guild);
      return interaction.update({ content: `Tujuan arahan disimpan (${interaction.values.length ? `${interaction.values.length} channel` : 'otomatis'}).`, components: [] });
    case 'note': {
      const cfg = akses.configOf(guild.id, roleId);
      return interaction.showModal(new ModalBuilder().setCustomId(`ac:notesubmit:${roleId}`).setTitle('Pesan arahan')
        .addComponents(field('note', 'Pesan buat yang dapat role ini', TextInputStyle.Paragraph, {
          value: cfg?.note, max: 500, placeholder: 'Contoh: Selamat datang! Baca aturan dulu sebelum chat.',
        })));
    }
    case 'del':
      akses.removeConfig(guild.id, roleId);
      backupSoon(guild);
      return interaction.update(dashboard.roleAccessView(guild, roleId, 'Arahan dihapus.'));
    default:
  }
}

async function submitAccessNote(interaction) {
  const roleId = interaction.customId.split(':')[2];
  akses.setConfig(interaction.guild.id, roleId, { note: interaction.fields.getTextInputValue('note').trim() });
  backupSoon(interaction.guild);
  const view = dashboard.roleAccessView(interaction.guild, roleId, 'Pesan arahan disimpan.');
  return interaction.reply({ ...(view ?? { content: 'Role itu sudah tidak ada.' }), flags: EPHEMERAL });
}

// ---------- formulir pengajuan ----------

const publishNote = (r, cfg) => {
  if (!cfg?.reviewChannelId) return 'Pilih channel peninjau supaya tombolnya muncul di panel.';
  if (r.status === 'ok' || r.status === 'same') return `Tombol sudah dipasang di ${r.channel}.`;
  if (r.status === 'missing') return 'Channel panel ini belum ketemu. Tombol muncul begitu panelnya diposting.';
  if (r.status === 'draft') return 'Panel ini masih draft. Tombol muncul setelah panelnya diposting.';
  if (r.status === 'error') return `Gagal memasang tombol: ${r.error}${hint(r)}`;
  return '';
};

// Member membuka formulir (siapa saja boleh).
async function openForm(interaction) {
  const guild = interaction.guild;
  const key = interaction.customId.split(':')[2];
  const cfg = forms.configOf(guild.id, key);
  if (!cfg?.reviewChannelId) return reply(interaction, 'Formulir ini belum aktif.');

  const state = store.loadState();
  const pendingKey = `${key}:${interaction.user.id}`;
  const pendingId = state.requests[guild.id]?.[pendingKey];
  if (pendingId) {
    const channel = guild.channels.cache.get(cfg.reviewChannelId);
    const stillWaiting = channel && await channel.messages.fetch(pendingId).then(() => true).catch(() => false);
    if (stillWaiting) return reply(interaction, 'Pengajuanmu sebelumnya masih menunggu keputusan staff.');
    delete state.requests[guild.id][pendingKey];
    store.saveState(state);
  }
  return interaction.showModal(forms.openModal(key, cfg));
}

async function submitForm(interaction) {
  const guild = interaction.guild;
  const key = interaction.customId.split(':')[2];
  const cfg = forms.configOf(guild.id, key);
  await defer(interaction);
  const channel = cfg?.reviewChannelId && guild.channels.cache.get(cfg.reviewChannelId);
  if (!channel) return interaction.editReply('Formulir ini sedang tidak aktif. Coba lagi nanti.');

  const answers = cfg.fields.map((_, i) => interaction.fields.getTextInputValue(`f${i}`).trim());
  const user = interaction.user;
  const embed = forms.reviewEmbed(key, user, cfg, answers, panels.asColor(store.loadContent().meta.warna));
  const msg = await channel.send({ embeds: [embed], components: [forms.reviewButtons(key, user.id)] });
  const state = store.loadState();
  (state.requests[guild.id] ??= {})[`${key}:${user.id}`] = msg.id;
  store.saveState(state);
  return interaction.editReply('Pengajuan terkirim. Staff akan meninjaunya, dan kamu diberi tahu lewat DM.');
}

// Staff menerima / menolak. Kartu di channel peninjau diubah statusnya, role diberikan kalau diterima, member dikabari lewat DM.
async function finishForm(interaction, { accepted, key, userId, reason }) {
  const guild = interaction.guild;
  const cfg = forms.configOf(guild.id, key);
  const member = await guild.members.fetch(userId).catch(() => null);
  const notes = [];

  if (accepted && cfg?.roleId) {
    const role = guild.roles.cache.get(cfg.roleId);
    if (!member) notes.push('Orangnya sudah keluar dari server, role tidak diberikan.');
    else if (!role || !safety.isSafeRole(guild, role)) notes.push('Role tidak diberikan (role sudah tidak ada atau tidak aman lagi).');
    else {
      try {
        await member.roles.add(role, `Pengajuan ${key} diterima oleh ${interaction.user.tag}`);
        notes.push(`Role ${role.name} diberikan.`);
      } catch (err) {
        notes.push(`Gagal memberi role: ${err.message}`);
      }
    }
  }
  if (member) {
    const dm = new EmbedBuilder().setColor(accepted ? 0x2e9e5b : 0xdc2626)
      .setTitle(accepted ? 'PENGAJUAN DITERIMA' : 'PENGAJUAN DITOLAK')
      .setDescription(`Pengajuanmu (${key}) di **${guild.name}** ${accepted ? 'diterima' : 'ditolak'}.`);
    if (reason) dm.addFields({ name: 'Alasan', value: reason.slice(0, 1000) });
    try {
      await member.send({ embeds: [dm] });
    } catch {
      notes.push('DM member tertutup, dia belum diberi tahu.');
    }
  }

  const source = interaction.message.embeds[0];
  await interaction.editReply({
    embeds: [forms.decided(source, { status: accepted ? 'DITERIMA' : 'DITOLAK', by: interaction.user.id, reason, color: accepted ? 0x2e9e5b : 0xdc2626 })],
    components: [],
  });
  const state = store.loadState();
  if (state.requests[guild.id]) delete state.requests[guild.id][`${key}:${userId}`];
  store.saveState(state);
  if (notes.length) await interaction.followUp({ content: notes.join('\n'), flags: EPHEMERAL });
}

async function applyForm(interaction, key, patch) {
  const guild = interaction.guild;
  const cfg = forms.setConfig(guild.id, key, patch);
  backupSoon(guild);
  await panels.warm(guild);
  const r = await panels.publish(guild, key);
  return dashboard.formEditor(guild, key, publishNote(r, cfg));
}

// Pengaturan formulir (khusus pengelola) + tombol Terima / Tolak.
async function handleFormAdmin(interaction, action, key, userId) {
  const guild = interaction.guild;
  switch (action) {
    case 'home':
      return interaction.update(dashboard.formChooser(guild));
    case 'pick':
      return interaction.update(dashboard.formEditor(guild, interaction.values[0]));
    case 'rev':
      await interaction.deferUpdate();
      return interaction.editReply(await applyForm(interaction, key, { reviewChannelId: interaction.values[0] }));
    case 'role': {
      await interaction.deferUpdate();
      const roleId = interaction.values[0] ?? null;
      const role = roleId && guild.roles.cache.get(roleId);
      if (roleId && !(role && safety.isSafeRole(guild, role))) {
        return interaction.editReply(dashboard.formEditor(guild, key, 'Role itu tidak dimasukkan (role bot, izin admin / kelola, atau di atas role bot).'));
      }
      forms.setConfig(guild.id, key, { roleId });
      backupSoon(guild);
      return interaction.editReply(dashboard.formEditor(guild, key));
    }
    case 'fields': {
      const cfg = forms.configOf(guild.id, key);
      return interaction.showModal(new ModalBuilder().setCustomId(`fm:fieldsubmit:${key}`).setTitle('Tombol & isian formulir')
        .addComponents(
          field('label', 'Tulisan di tombol', TextInputStyle.Short, { value: cfg?.label ?? 'Ajukan', max: 80, required: true }),
          field('fields', 'Isian (satu baris, maks 5)', TextInputStyle.Paragraph, {
            value: forms.fieldsText(cfg?.fields ?? forms.DEFAULT_FIELDS), max: 600, required: true,
            placeholder: 'Awali dengan > kalau jawabannya panjang. Contoh:\nNama IC\n> Alasan',
          }),
        ));
    }
    case 'del':
      await interaction.deferUpdate();
      forms.removeConfig(guild.id, key);
      backupSoon(guild);
      await panels.warm(guild);
      await panels.publish(guild, key);
      return interaction.editReply(dashboard.formChooser(guild));
    case 'ok':
      await interaction.deferUpdate();
      return finishForm(interaction, { accepted: true, key, userId });
    case 'no':
      return interaction.showModal(new ModalBuilder().setCustomId(`fm:reason:${key}:${userId}`).setTitle('Tolak pengajuan')
        .addComponents(field('alasan', 'Alasan (opsional, ikut dikirim ke member)', TextInputStyle.Paragraph, { max: 500 })));
    default:
  }
}

async function submitFormAdmin(interaction, action) {
  const [, , key, userId] = interaction.customId.split(':');
  if (action === 'reason') {
    await interaction.deferUpdate();
    return finishForm(interaction, { accepted: false, key, userId, reason: interaction.fields.getTextInputValue('alasan').trim() });
  }
  if (action === 'fieldsubmit') {
    const parsed = forms.parseFields(interaction.fields.getTextInputValue('fields'));
    if (!parsed.length) return reply(interaction, 'Isi minimal satu isian.');
    await defer(interaction);
    const view = await applyForm(interaction, key, { label: interaction.fields.getTextInputValue('label').trim() || 'Ajukan', fields: parsed });
    return interaction.editReply(view);
  }
  return undefined;
}

// Kotak isian dari Pengaturan / Fitur lainnya: teks status, aturan moderasi, pesan sambutan.
async function submitSettingsModal(interaction, which) {
  if (which === 'bursasubmit') return bursa.submitHargaBaru(interaction);
  if (which === 'gamesubmit') {
    const r = game.simpanAngka(interaction);
    if (r.galat) return reply(interaction, `Tidak disimpan:\n${r.galat.join('\n')}`);
    refreshDash(interaction.guild);
    return reply(interaction, 'Angka game & level tersimpan.');
  }
  if (which === 'modsubmit' || which === 'welcomesubmit') {
    const r = which === 'modsubmit' ? moderasi.saveSettings(interaction) : komunitas.sambutan.saveSettings(interaction);
    if (r.error) return reply(interaction, `Tidak disimpan. ${r.error}`);
    refreshDash(interaction.guild);
    return reply(interaction, which === 'modsubmit' ? 'Pengaturan moderasi tersimpan.' : 'Pesan sambutan tersimpan.');
  }
  return submitStatusText(interaction);
}

// Teks status & bio. Kata dalam kurung kurawal diganti angka terbaru: {online} {anggota} {total} {server}.
async function submitStatusText(interaction) {
  const settings = store.loadSettings();
  settings.status.teks = interaction.fields.getTextInputValue('teks').trim();
  settings.status.bioTeks = interaction.fields.getTextInputValue('bio').trim();
  store.saveSettings(settings);
  await defer(interaction);
  const guild = interaction.guild;
  const c = await statusLib.counts(guild);
  statusLib.refresh(interaction.client, { forceBio: settings.status.bio }).catch(() => {});
  return interaction.editReply(`Tersimpan. Contoh tampilannya sekarang:\nStatus: ${statusLib.render(settings.status.teks, c, guild)}\nBio: ${statusLib.render(settings.status.bioTeks, c, guild)}`);
}

// ---------- update dari Discord (khusus pemilik server) ----------

const isOwner = (interaction) => interaction.user.id === interaction.guild.ownerId;

const updateModal = () => new ModalBuilder().setCustomId('upd:submit').setTitle('Update bot')
  .addLabelComponents(new LabelBuilder().setLabel('File zip update').setDescription('Zip dari yang bikin bot. Teks panel, pengaturan, dan data tidak ikut tertimpa.')
    .setFileUploadComponent(new FileUploadBuilder().setCustomId('zip').setRequired(true).setMinValues(1).setMaxValues(1)));

function restartSoon(guild) {
  backupSoon(guild);
  setTimeout(() => updateLib.restart(), 2500).unref?.();
}

async function startUpdate(interaction) {
  if (!isOwner(interaction)) return reply(interaction, 'Update lewat Discord khusus pemilik server, karena ini mengganti kode bot.');
  const reason = updateLib.blocked();
  if (reason) return reply(interaction, reason);
  return interaction.showModal(updateModal());
}

async function submitUpdate(interaction) {
  if (!isOwner(interaction)) return reply(interaction, 'Update lewat Discord khusus pemilik server.');
  await defer(interaction);
  const file = interaction.fields.getUploadedFiles('zip')?.first();
  if (!file) return interaction.editReply('Tidak ada file yang dipilih.');
  if (!/\.zip$/i.test(file.name ?? '')) return interaction.editReply('File harus berformat .zip');
  if ((file.size ?? 0) > 15 * 1048576) return interaction.editReply('File terlalu besar buat update bot.');
  const res = await fetch(file.url);
  if (!res.ok) return interaction.editReply(`Gagal mengunduh filenya (${res.status}).`);
  const result = await updateLib.apply(Buffer.from(await res.arrayBuffer()));
  await interaction.editReply(
    `Update berhasil: ${result.from} → ${result.to} (${result.count} file${result.npm ? ', kebutuhan baru dipasang' : ''}).\n`
    + 'Bot restart sebentar lagi. Kalau tidak nyala sendiri, jalankan start.bat lagi. Versi lama disimpan, bisa dikembalikan dari menu Status bot.',
  );
  restartSoon(interaction.guild);
}

async function rollbackUpdate(interaction) {
  if (!isOwner(interaction)) return reply(interaction, 'Khusus pemilik server.');
  await defer(interaction);
  const result = updateLib.rollback();
  await interaction.editReply(`Dikembalikan ke versi ${result.to} (sebelumnya ${result.from}). Bot restart sebentar lagi.`);
  restartSoon(interaction.guild);
}

async function handleImage(interaction, action, slot) {
  const guild = interaction.guild;
  if (action === 'up') return interaction.showModal(imageModal());
  if (action === 'rm' && ['logo', 'banner'].includes(slot)) {
    await interaction.deferUpdate();
    panels.removeAsset(slot);
    const content = store.loadContent();
    delete content.meta[slot];
    store.saveContent(content);
    await panels.syncGuild(guild, { onlyPosted: true });
    backupSoon(guild);
    return interaction.editReply(dashboard.imageView(guild, `${slot} dicopot dan sudah diterapkan ke panel yang sudah terposting.`));
  }
  if (action === 'submit') {
    await interaction.deferReply({ flags: EPHEMERAL });
    const logo = interaction.fields.getUploadedFiles('logo')?.first() ?? null;
    const banner = interaction.fields.getUploadedFiles('banner')?.first() ?? null;
    if (!logo && !banner) return interaction.editReply('Tidak ada file yang dipilih.');
    const notes = await saveImages(interaction, [['logo', logo], ['banner', banner]]);
    return interaction.editReply(dashboard.imageView(guild, `${notes}\nSudah diterapkan ke panel yang sudah terposting.`));
  }
}

// ---------- submit form teks ----------

async function submitEdit(interaction) {
  const [, key, idxRaw] = interaction.customId.split(':');
  const idx = Number(idxRaw);
  const get = (id) => interaction.fields.getTextInputValue(id).trim();

  const color = cleanColor(get('warna'));
  const image = cleanImage(get('gambar'));
  const thumb = cleanImage(get('thumbnail'));
  if (color.error) return reply(interaction, 'Warna harus format hex, contoh #8c1c1c');
  if (image.error || thumb.error) return reply(interaction, IMAGE_ERROR);

  const content = store.loadContent();
  const panel = content.panels[key];
  const msg = panel?.messages?.[idx - 1];
  if (!msg) return reply(interaction, 'Panelnya sudah tidak ada.');
  if (!get('judul') && !get('isi') && !msg.fields?.length) return reply(interaction, 'Judul dan isi tidak boleh kosong dua-duanya.');

  const apply = (prop, value) => (value ? (msg[prop] = value) : delete msg[prop]);
  apply('title', get('judul'));
  apply('description', get('isi'));
  apply('color', color.value);
  apply('image', image.value);
  apply('thumbnail', thumb.value);
  delete panel.draft;
  store.saveContent(content);

  await defer(interaction);
  await panels.warm(interaction.guild);
  const r = await panels.publish(interaction.guild, key, { force: true });
  backupSoon(interaction.guild);
  refreshDash(interaction.guild);
  const remaining = Object.values(store.loadContent().panels).filter((p) => p.draft).length;
  await interaction.editReply({
    content: `Tersimpan. ${describe(r)}`,
    components: remaining
      ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dash:draft').setLabel(`Lanjut isi draft (${remaining})`).setStyle(ButtonStyle.Primary))]
      : [],
  });
}

async function submitQuickAdd(interaction) {
  const get = (id) => interaction.fields.getTextInputValue(id).trim();
  const image = cleanImage(get('gambar'));
  if (image.error) return reply(interaction, IMAGE_ERROR);

  let parentId = null;
  const wanted = panels.norm(get('kategori'));
  if (get('kategori')) {
    const category = [...interaction.guild.channels.cache.values()].find(
      (c) => c.type === ChannelType.GuildCategory && wanted && panels.norm(c.name).includes(wanted),
    );
    if (!category) return reply(interaction, `Kategori "${get('kategori')}" tidak ketemu. Kosongkan kalau tidak perlu.`);
    parentId = category.id;
  }
  await defer(interaction);
  await createWithContent(interaction, { name: get('nama'), parentId, title: get('judul'), description: get('isi'), image: image.value });
}

// ---------- pintu masuk ----------

async function handle(interaction) {
  if (interaction.inGuild() === false) return;

  // Musik boleh dipakai semua member. Aturan siapa boleh apa ada di src/musik/index.js.
  if (musik.owns(interaction)) return musik.handle(interaction);
  // Moderasi dan komunitas punya aturan izinnya sendiri (izin Discord asli, atau pengelola bot).
  if (moderasi.owns(interaction)) return moderasi.handle(interaction);
  if (komunitas.owns(interaction)) return komunitas.handle(interaction);
  if (bursa.owns(interaction)) return bursa.handle(interaction);
  if (game.owns(interaction)) return game.handle(interaction);

  const id = interaction.customId ?? '';
  const isCmd = interaction.isChatInputCommand() && interaction.commandName === 'panel';
  const isCtx = interaction.isUserContextMenuCommand() && interaction.commandName === CTX_NAME;
  const isOurs = (interaction.isMessageComponent() || interaction.isModalSubmit()) && /^(dash|pd|set|img|restore|edit|quickadd|bind|rm|ac|fm|upd)(:|$)/.test(id);

  // Tombol take role boleh dipakai semua member (bukan hanya pengelola).
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && /^role:/.test(id)) {
    return guarded(interaction, () => takeRole(interaction));
  }
  // Member biasa boleh membuka dan mengirim formulir.
  if (interaction.isButton() && /^fm:open:/.test(id)) return guarded(interaction, () => openForm(interaction));
  if (interaction.isModalSubmit() && /^fm:submit:/.test(id)) return guarded(interaction, () => submitForm(interaction));
  if (!isCmd && !isCtx && !isOurs) return;

  if (!access.isManager(interaction)) {
    return reply(interaction, 'Ini khusus yang punya izin Manage Server atau role pengelola bot.');
  }

  return guarded(interaction, async () => {
    if (isCmd) return slashPanel(interaction);
    if (isCtx) return memberCard(interaction, interaction.targetId);

    const [ns, a, b, c] = id.split(':');
    if (interaction.isModalSubmit()) {
      if (ns === 'edit') return submitEdit(interaction);
      if (ns === 'quickadd') return submitQuickAdd(interaction);
      if (ns === 'img') return handleImage(interaction, 'submit');
      if (ns === 'ac') return submitAccessNote(interaction);
      if (ns === 'fm') return submitFormAdmin(interaction, a);
      if (ns === 'upd') return submitUpdate(interaction);
      if (ns === 'set') return submitSettingsModal(interaction, a);
      return undefined;
    }
    switch (ns) {
      case 'dash': return handleDash(interaction, a);
      case 'pd': return handlePanelDetail(interaction, a, b, c);
      case 'set': return handleSettings(interaction, a, b);
      case 'bind': return handleBind(interaction, a);
      case 'rm': return handleRoleMenu(interaction, a, b);
      case 'ac': return handleAccess(interaction, a, b);
      case 'fm': return handleFormAdmin(interaction, a, b, c);
      case 'img': return handleImage(interaction, a, b);
      case 'restore': return logs.restoreRoles(interaction, a);
      default: return undefined;
    }
  });
}

module.exports = { handle, commandJSON, backupSoon };
