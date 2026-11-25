# BRV Panel Bot

Bot server buat ngisi channel (rules, guide, request, BM, interview) pakai embed rapi, take role, formulir pengajuan,
log join / leave / voice, data anggota, akses channel, **musik** (YouTube / Spotify + lirik berjalan), **moderasi** (peringatan yang dikirim lewat DM, timeout / kick / ban, auto-moderasi),
fitur komunitas (poll, giveaway, pengingat, sambutan, dan lainnya), **bursa harga Disnaker** (catat jualan, total penghasilan otomatis), **level dan game** (naik level lewat chat dan voice, hadiah role, koin, slot, dadu, XO, kuis, blackjack), serta **log share screen** (siapa mulai dan selesai share screen di voice). Teks panel yang kamu simpan tidak diubah-ubah bot.

**Mode manual:** bot tidak membuat role atau channel, dan tidak memposting apa pun sendiri.
Semua fitur mati sampai kamu menyalakannya lewat menu **Pengaturan**.

## Pasang pertama kali

1. https://discord.com/developers/applications → **New Application** → tab **Bot**.
   - **Reset Token**, copy tokennya.
   - Di **Privileged Gateway Intents** nyalakan **Server Members Intent** (log join / leave, roster, aktivitas)
     dan **Message Content Intent** (auto-moderasi yang membaca isi pesan: undangan, link, kata, kapital). Kalau belum dinyalakan, bot tetap jalan tapi fitur itu mati dan bot memberi tahu.
2. Windows: ekstrak zip, klik dua kali **install.bat**, tempel token. Link invite terbuka sendiri.
   Mac / Linux: `npm install`, salin `.env.example` jadi `.env`, isi token, `npm start`.
3. Invite bot ke server (izin Administrator paling gampang), lalu ketik **/panel** di server.

## Update (tanpa install ulang)

**Lewat Discord (paling gampang):** buka `/panel` → **Status bot** → **Update bot** → upload zip update. Bot memeriksa zipnya, menimpa kodenya,
memasang kebutuhan baru kalau ada, lalu restart sendiri. Versi lama disimpan, bisa dikembalikan dengan tombol **Kembalikan versi sebelumnya**.
Khusus **pemilik server** (karena ini mengganti kode bot). Hanya file kode bot yang boleh ditimpa. Teks panel, pengaturan, data, `.env`, dan `node_modules` tidak pernah disentuh.
Kode yang salah tulis ditolak sebelum ada yang diubah. Mau mematikan fitur ini: isi environment variable `DISABLE_SELF_UPDATE=1`.
Syarat: bot dijalankan lewat start.bat, systemd (`deploy/linux-service.sh`), atau hosting yang menyalakan ulang bot saat berhenti.
Di hosting yang filenya suka ke-reset, update lewat Discord ikut hilang saat redeploy, jadi update lewat repo / upload ulang di sana.

**Lewat update.bat:** seret zip update-nya. Dipakai buat update pertama ke versi ini (karena ada kebutuhan baru), atau kalau bot sedang mati. Lihat CARA-UPDATE.txt.
Setelah update, fitur baru mati sampai kamu nyalakan. Update dari versi lama otomatis mematikan fitur yang memposting sendiri (sekali saja).

## Musik (YouTube, Spotify, lirik berjalan)

Bot masuk ke voice channel dan memutar lagu. **Mati sampai kamu nyalakan:** `/panel` → **Pengaturan** → tombol **Musik**.
Begitu menyala, command `/play`, `/skip`, `/stop`, `/queue`, `/musik` muncul di server, dan mesinnya dipasang sendiri.

**Cara pakai (semua member):** masuk voice channel, ketik `/play` lalu isi salah satu:
- judul lagu (`/play hati hati di jalan tulus`)
- link YouTube (video atau playlist), link Spotify (lagu, album, playlist, artis), atau link situs lain yang didukung yt-dlp (SoundCloud, dll)

Spotify tidak mengizinkan bot memutar audionya, jadi bot membaca judul dan artis dari Spotify lalu memutar versi yang paling cocok dari YouTube (dicocokkan lewat durasi, kanal resmi / Topic).

**Kartu lagu.** Tiap lagu muncul kartu di channel tempat `/play` diketik, lengkap dengan tombol: jeda / lanjut, lewati, **stop**, loop, acak, lirik on / off,
geser lirik, antrian, volume. Kartu selalu muncul di paling bawah channel.

**Lirik otomatis.** Lirik berwaktu diambil dari LRCLIB (gratis, tanpa kunci) dan baris yang sedang dinyanyikan ditebalkan, bergerak mengikuti lagu.
Kalau liriknya telat atau kecepatan (misalnya video musik punya intro), tekan **Lirik lebih awal** / **Lirik lebih lambat** (geser 0,5 detik). Geserannya diingat per lagu.
Kalau lagu tidak punya lirik berwaktu, ditampilkan lirik biasa. `/musik lirik` menampilkan lirik lengkap.

**Command lain** (`/musik ...`): `jeda`, `lanjut`, `loop`, `acak`, `hapus`, `volume`, `loncat`, `lirik`, `cari` (pilih dari beberapa hasil), `sekarang` (pindahkan kartu ke channel ini), `masuk`, `cek`.
`/play berikutnya:True` menaruh lagu paling depan antrian.

**Stop.** `/stop` atau tombol **Stop**: musik berhenti, antrian dikosongkan, bot keluar dari voice.
Bot juga keluar sendiri kalau antrian habis (3 menit) atau semua orang pergi dari voice (1 menit).
Yang boleh mengontrol: member yang ada di voice channel yang sama dengan bot, dan pengelola.

**Jalan dan update sendiri.** Pertama kali dinyalakan, bot mengunduh **yt-dlp** sendiri ke `data/bin`. yt-dlp lalu diperbarui otomatis
(saat bot menyala dan tiap 12 jam, kanal nightly karena YouTube sering berubah), dan langsung diperbarui kalau YouTube mengubah sesuatu yang bikin lagu gagal, lalu lagunya dicoba lagi.
ffmpeg ikut `npm install` (paket ffmpeg-static). Tidak ada yang perlu dipasang manual.

**Cek kesehatan.** `/musik cek` (pengelola) menguji semuanya: paket voice, ffmpeg, yt-dlp, pencarian dan stream YouTube, lirik, dan Spotify, lengkap dengan alasannya kalau ada yang gagal.
Jalankan ini sekali setelah menyalakan Musik.

**Syarat dan catatan.**
- Node.js 20 ke atas (disarankan 22). yt-dlp memakai Node untuk memecahkan tantangan YouTube.
- Izin bot di voice channel: **Connect** dan **Speak**. Di channel teks: Send Messages dan Embed Links.
- Bot yang dijalankan di hosting / VPS sering diblokir YouTube ("Sign in to confirm you're not a bot"). Solusinya: ekspor cookies YouTube
  (ekstensi "Get cookies.txt LOCALLY", dari akun cadangan, bukan akun utama), simpan sebagai `data/cookies.txt` atau isi `YT_COOKIES` dengan path-nya. Di PC rumah biasanya tidak perlu.
- Playlist Spotify lewat halaman embed dibatasi 100 lagu. Mau lebih dan lebih stabil: isi `SPOTIFY_CLIENT_ID` dan `SPOTIFY_CLIENT_SECRET` (gratis di developer.spotify.com).
- Mengubah volume atau meloncat memulai lagu dari menit yang sama (ada jeda sekejap).
- Hormati hak cipta dan aturan YouTube / Spotify di server kamu. Bot ini cuma pemutar.

Pengaturan angka ada di `data/settings.json` bagian `musik`: `maksAntrian` (200), `maksDurasiMenit` (180, 0 = bebas), `diamMenit` (3), `kosongDetik` (60),
`lirik` (true = lirik nyala dari awal), `updateOtomatis` (true), `updateJam` (12), `kanalYtdlp` (`nightly` atau `stable`).

## Moderasi (peringatan lewat DM)

Nyalakan di **/panel → Fitur lainnya → Moderasi**. Command-nya baru muncul di Discord setelah menyala. Log kasus ditulis ke channel `logs-moderasi`
(buat channelnya, atau hubungkan lewat dropdown di halaman Fitur lainnya).

**Kasih peringatan.** Dua cara:
- Klik kanan nama member → Apps → **Beri peringatan**, tulis pesannya di kotak yang muncul.
- Atau ketik `/warn member alasan` (alasan cepat muncul sebagai saran: Spam, Kata kasar, dst; boleh ketik bebas).

Bot mengirim pesan itu lewat **DM** ke member (kotak rapi berisi alasan, bukti kalau ada, peringatan keberapa, dan siapa yang memberi), mencatatnya sebagai kasus, dan menulisnya ke channel log.
Kalau member menutup DM, kamu diberi tahu dan peringatannya tetap tercatat. `diam:True` = catat saja tanpa DM. Moderator juga bisa disembunyikan dari DM (`tampilkanModerator` di settings.json).

**Eskalasi (opsional, mati bawaannya).** Nyalakan **Eskalasi**, lalu **Atur moderasi** untuk menulis aturannya, contoh `3=timeout 60m, 5=kick, 7=ban`.
Begitu peringatan aktif seseorang mencapai angka itu, bot menindak sendiri dan memberi tahu. DM peringatan ikut memberi peringatan dini ("di peringatan ke-3 kamu akan di-timeout").
Peringatan bisa kedaluwarsa setelah sekian hari (isi di Atur moderasi, 0 = tidak pernah) dan bisa dihapus (`/mod hapus`), jejaknya tetap ada di riwayat.

**Command lain.**

| Command | Fungsi |
|---|---|
| `/dm member pesan` | Kirim pesan DM lewat bot (bukan peringatan), boleh anonim |
| `/mod timeout member durasi` | Bungkam sementara. Durasi: `10m`, `2j`, `1d`, `1j30m` (m menit, j jam, d hari), maksimal 28 hari |
| `/mod untimeout`, `/mod kick`, `/mod ban`, `/mod unban` | Kick dan ban mengirim DM **sebelum** tindakan (setelah itu bot tidak bisa lagi). `ban` bisa menghapus pesan 0 sampai 7 hari. `unban` lewat ID |
| `/mod purge jumlah [member]` | Hapus 1 sampai 100 pesan terakhir di channel (yang lebih tua dari 14 hari tidak bisa) |
| `/mod slowmode`, `/mod lock`, `/mod unlock` | Slowmode, kunci channel (unlock mengembalikan izin persis seperti semula) |
| `/mod riwayat member`, `/mod kasus nomor` | Riwayat dan detail kasus. Ringkasannya juga ada di kartu **Data anggota** |
| `/mod hapus nomor`, `/mod catatan member isi` | Hapus peringatan, atau catatan internal (tidak dikirim ke member) |
| `/mod cek` | Cek izin bot dan posisi role bot (pengelola) |

**Siapa yang boleh.** Peringatan, DM, riwayat, catatan: izin **Timeout Members** atau pengelola bot. Timeout: Timeout Members. Kick: Kick Members. Ban: Ban Members. Purge: Manage Messages. Slowmode / lock: Manage Channels.
Moderator tidak bisa menindak diri sendiri, bot, pemilik server, atau member yang rolenya sama / lebih tinggi. Bot hanya bisa menindak member yang rolenya di bawah role bot
(naikkan role bot di Server Settings → Roles; `/mod cek` menunjukkan kalau ada yang kurang). Command `/warn`, `/dm`, `/mod` otomatis tersembunyi dari member biasa; atur ulang di Server Settings → Integrations kalau perlu.

## Auto-moderasi

Nyalakan **Auto-moderasi** di Fitur lainnya, lalu `/automod status` (pengelola) untuk menyalakan aturan satu per satu lewat tombol:
**Undangan server lain**, **Link** (hanya situs yang kamu izinkan), **Kata terlarang**, **Mention massal**, **Flood / spam** (pesan terlalu cepat atau pesan yang sama diulang), **Huruf kapital**.
Pesan yang melanggar dihapus, pelakunya dapat DM, dan (bawaan) dicatat sebagai peringatan sehingga eskalasi ikut jalan. Flood juga bisa langsung timeout beberapa menit.

Atur isinya: `/automod kata tambah|hapus|daftar`, `/automod link izinkan|cabut`, `/automod batas` (angka batas), `/automod abaikan-channel`, `/automod abaikan-role`.
Admin, pemilik, dan siapa pun yang punya izin Manage Messages / Timeout tidak pernah kena. Pendeteksi kata mengenali variasi seperti `4nj1ng` dan huruf yang diulang, tapi hanya kata utuh (tidak asal potongan kata).
Aturan undangan, link, kata, dan kapital butuh **Message Content Intent**; mention dan flood tidak.
Aturan undangan menghapus semua link undangan Discord dari member biasa, termasuk undangan ke server kamu sendiri (pengelola dan moderator tidak kena).

## Komunitas

Nyalakan **Komunitas** di Fitur lainnya. Dipakai semua member kecuali yang bertanda pengelola:

- `/poll pertanyaan opsi1 opsi2 ...` (sampai 5 pilihan, `durasi` opsional): voting lewat tombol, satu orang satu suara (boleh ganti), hasil bergerak langsung, berakhir otomatis atau ditutup pembuatnya.
- `/giveaway mulai` (pengelola): undian dengan tombol Ikut, syarat role opsional, pemenang dipilih acak dari yang masih ada di server, dikabari lewat DM. `akhiri`, `ulang` (pilih pemenang baru), `daftar`.
- `/ingatkan buat waktu pesan [dm]`, `daftar`, `batal`: pengingat pribadi yang tetap jalan walau bot restart.
- `/afk [alasan]`: kalau ada yang me-mention kamu, bot memberi tahu kamu sedang AFK. Hilang sendiri begitu kamu menulis lagi (bisa dimatikan lewat tombol **AFK**).
- `/info user | server | avatar | bot`.
- `/umumkan channel [mention]` (pengelola): kotak isian untuk pengumuman rapi (judul, isi, warna, gambar) ke channel pilihan.

**Sambutan** (nyalakan **Sambutan**, butuh Server Members Intent): pesan selamat datang di channel `selamat-datang` (atau hubungkan channel lain), opsional pesan perpisahan dan DM sambutan.
Teksnya diatur lewat **Atur sambutan**, boleh pakai `{user}` `{nama}` `{server}` `{jumlah}`. Di halaman itu juga ada pilihan **role otomatis** untuk member baru
(hanya role aman yang diterima: bukan role bot, di bawah role bot, tanpa izin admin / kelola / kick / ban / timeout / hapus pesan).

## Bursa harga Disnaker

Nyalakan **Bursa harga** di `/panel` → tombol **Bursa harga**. Isinya daftar harga Disnaker (Tambang Baru dan Depot, sudah terisi sesuai regulasi terbaru),
pencatatan penjualan, dan total penghasilan yang dihitung otomatis.

Member:
- `/harga` lihat daftar harga (`cari` untuk satu barang). Ada tombol **Catat penjualan** dan **Penghasilanku** di bawahnya.
- `/jual barang jumlah` catat jualan. Barang dicari lewat daftar yang muncul sendiri (salah ketik kecil tetap dikenali). Jumlah bawaan dihitung **paket**
  (`satuan: pcs` untuk eceran, dihitung sebanding; Berlian selalu per pcs). `/jual` tanpa isi membuka kotak isian buat banyak barang sekaligus, satu per baris:
  `kaca 3`, `botol 2 paket`, `plastik 150 pcs`, `berlian 5`. Hasilnya struk berisi total, plus jumlah hari ini dan minggu ini.
  Salah input? Tombol **Batalkan** di struk berlaku 30 menit; sesudahnya pengelola yang menghapus.
- `/penghasilan [periode]` hari ini / minggu ini / bulan ini / semua waktu, lengkap dengan rincian per barang dan penjualan terakhir.

Pengelola:
- **Perbarui harga** (di panel, atau `/bursa harga-baru`): tempel pengumuman Disnaker apa adanya. Judul, `TAMBANG BARU :`, `DEPOT :`, `$20.000 / Paket (100 pcs)`
  dibaca otomatis. Hasilnya menunjukkan harga yang berubah dan barang baru. Barang yang tidak disebut dibiarkan. Penjualan lama tidak ikut berubah,
  karena harga saat itu tersimpan di catatannya.
- `/bursa atur` tambah barang / ubah satu harga, `/bursa hapus`, `/bursa papan #channel` pasang papan harga yang ikut diperbarui sendiri tiap harga berubah.
- `/rekap [periode]` total semua orang: urutan per orang dan per barang. Tiap **Senin pagi (WIB)** rekap minggu lalu dikirim otomatis ke channel `logs-bursa`
  (kalau ada penjualan; bisa dimatikan lewat tombol **Rekap mingguan**).
- `/bursa riwayat`, `/bursa hapus-catatan nomor`, `/bursa ekspor` (CSV, buka di Excel).
- Di halaman Bursa harga ada pilihan **role yang boleh mencatat** (kosong = semua member) dan tombol **Log penjualan** (tiap jualan masuk ke channel log).

Data ada di `data/bursa.json` dan ikut dicadangkan oleh Backup. Hari dan minggu dihitung dalam WIB (minggu mulai Senin).

## Game & level

Nyalakan di `/panel` → tombol **Game & level**. **Level** dan **Game** punya tombol sendiri-sendiri dan sama-sama mati sampai kamu nyalakan.
Command-nya baru muncul di Discord setelah menyala.

**Level**
- XP dari chat: 15-25 per pesan, paling cepat sekali per 60 detik (spam tidak menaikkan level). XP dari voice: 5 per menit selama ada di voice bersama minimal satu orang lain
  (tidak deafen, bukan channel AFK). Semua angkanya diatur lewat tombol **Atur angka**. Channel yang tidak menghasilkan XP juga bisa dipilih di halaman itu.
- Rumus: level 1 butuh 100 XP, level 2 butuh 155 lagi, level 10 butuh 1.100 lagi (5n² + 50n + 100). Maksimal level 200.
- `/rank [member]` lihat level, bar XP, dan peringkat. `/top [level|koin]` 10 teratas.
- Naik level diumumkan di channel `level-up` (atau yang kamu hubungkan di halaman itu). Kalau channel itu tidak ada, diumumkan di channel tempat dia ngobrol.
  Naik level lewat voice tanpa channel pengumuman tidak diumumkan. Kalau Game menyala, naik level juga memberi bonus koin.
- **Hadiah role**: `/atur-game hadiah level role` (member yang mencapai level itu dapat rolenya), `/atur-game daftar-hadiah`, `/atur-game hapus-hadiah`.
  Member yang levelnya sudah lewat dibagikan lewat `/atur-game sinkron`. Hanya role aman yang diterima (bukan role bot, di bawah role bot, tanpa izin admin / kelola / kick / ban / timeout / hapus pesan). Maks 20 hadiah.

**Koin.** Semua orang mulai dengan 100 koin (angka di bot saja, bukan uang). Tambah lewat `/harian` (200 koin, ditambah 50 per hari beruntun sampai 7 hari; ganti hari pukul 00.00 WIB,
satu hari terlewat = beruntun mulai dari awal), menang game, dan naik level. `/koin` lihat saldo, `/beri` kirim ke member lain, `/top koin` peringkat.

**Game** (`/game` menampilkan daftar dan cara mainnya)

| Command | Cara main | Kembali |
|---|---|---|
| `/slot taruhan` | Tiga gulungan. Tiga gambar sama dibayar 5x (🍒) sampai 100x (💎). Dua sama = taruhan kembali | ±93% |
| `/dadu pilihan taruhan` | Tebak jumlah dua dadu: kecil (2-6) atau besar (8-12) dibayar 2x, tujuh dibayar 5x | ±83% |
| `/lempar pilihan [taruhan]` | Kepala atau ekor, dibayar 2x. Satu dari 50 lemparan koinnya menggelinding hilang (kalah) | 98% |
| `/suit pilihan [taruhan]` | Batu gunting kertas lawan bot. Menang 2x, seri kembali | 100% |
| `/xo lawan [taruhan]` | Dua pemain, papan 3x3 bertombol. Lawan menekan **Terima**. Taruhan dipotong dari keduanya, pemenang membawa semuanya, seri dikembalikan | - |
| `/kuis [kategori]` | Soal pilihan ganda 20 detik. Yang pertama menjawab benar dapat koin (bawaan 50). 70+ soal bawaan, plus soal buatan server | - |
| `/blackjack taruhan` | Tarik, tahan, atau gandakan. Bandar berhenti di 17, blackjack dibayar 3:2 | ±99% |

Taruhan dipotong di awal dan hasilnya dibayar di saat yang sama, jadi tombol yang ditekan berulang atau bersamaan tidak bisa menggandakan koin. Ada batas taruhan (bawaan 5.000, bisa diubah) dan jeda 3 detik antar putaran.
XO dan blackjack disimpan di file: tahan restart bot. XO yang tidak dijawab 5 menit dibatalkan; pemain XO yang diam 10 menit kalah; blackjack yang ditinggal 5 menit otomatis "tahan".
Mau game hanya di channel tertentu? Pilih channelnya di halaman Game & level (kosong = semua channel; pengelola tetap boleh di mana saja).

**Pengelola** `/atur-game`: `koin` (tambah / kurangi, angka minus = kurangi), `xp`, `level` (langsung ke level tertentu), `reset` (hapus data satu member, ada konfirmasi),
`hadiah` dan kawan-kawannya, `soal-tambah` (kotak isian: pertanyaan, jawaban benar, tiga pengecoh), `soal-daftar`, `soal-hapus`. Soal buatan sendiri dimainkan dengan `/kuis kategori:Soal server` dan ikut muncul di kuis campuran.

Data ada di `data/game.json` dan ikut dicadangkan oleh Backup.

## Nyala terus tanpa PC

PC Windows: klik **autostart.bat** supaya bot menyala sendiri tiap login. PC-nya tetap harus menyala.

Mau menyala sendiri lewat **Netlify** (Netlify Server, masih Early Access, belum kuuji di Netlify asli)? Baca **NETLIFY.md**.

Baca **HOSTING.md**. Ringkasnya: gratis dan benar-benar nyala terus ada di Oracle Cloud Always Free (butuh kartu verifikasi),
hosting kecil berbayar paling praktis, dan opsi gratis lain kebanyakan tidur atau tidak cocok.

## Menu

Ketik **/panel** buat menu pengelola (menunya tombol semua). Command musik (`/play` dll), moderasi (`/warn`, `/mod`), komunitas (`/poll`, `/giveaway`, dll), bursa harga (`/harga`, `/jual`, dll), level (`/rank`, `/top`), dan game (`/slot`, `/xo`, `/kuis`, dll) baru ada setelah fiturnya dinyalakan. Mau menu yang menetap? Pengaturan → **Taruh menu kontrol di channel ini**.

| Tombol | Fungsi |
|---|---|
| Posting ulang semua | Kirim semua panel (non-draft) ke channel yang cocok. Yang sudah terposting diedit, tidak dobel |
| Isi draft | Nulis panel draft satu per satu, terposting setelah disimpan |
| Tambah channel | Bikin channel baru + isinya |
| Logo & banner | Upload langsung (GIF boleh). Hanya memperbarui panel yang sudah terposting |
| Status bot | Uptime, ping, memori, versi, intent, backup terakhir |
| Take role | Pilih role yang boleh diambil member sendiri |
| Formulir | Member mengajukan, staff Terima / Tolak |
| Akses channel | Lihat permission channel dan atur arahan role |
| Daftar panel, Pengaturan | Status tiap panel, nyalakan / matikan fitur (termasuk **Musik**), pilih channel |
| Dropdown panel | Edit teks, posting ulang, hubungkan channel, atur role / hapus |
| Fitur lainnya | Nyalakan moderasi, auto-moderasi, sambutan, komunitas, atur eskalasi dan pesan sambutan, role otomatis |
| Bursa harga | Nyalakan, perbarui harga (tempel daftar), pasang papan harga, atur siapa boleh mencatat, rekap minggu ini |
| Game & level | Nyalakan Level dan Game, atur angka XP / koin / taruhan, batasi channel game, channel yang tidak dapat XP, hubungkan channel pengumuman naik level |
| Kasus moderasi | Kasus terbaru dan jumlahnya 7 hari terakhir |
| Dropdown anggota | Kartu data anggota. Atau klik kanan nama → Apps → **Data anggota** (ikut menampilkan peringatan) |

Yang boleh pakai: yang punya izin Manage Server, atau pemilik role pengelola yang kamu pilih di Pengaturan.

## Fitur

**Take role.** Pilih role yang boleh diambil, tombolnya muncul di bawah pesan panel (teks panel tidak berubah). Klik = ambil, klik lagi = copot.
Mode "bebas" atau "satu saja". Hanya role aman (bukan role bot, tanpa izin admin / kelola, di bawah role bot), dicek ulang tiap klik. Maks 25 role.

**Formulir pengajuan.** Tombol di panel (misalnya request-approach, report-anggota) membuka formulir yang isiannya kamu atur.
Pengajuan masuk ke channel peninjau dengan waktu WIB. Staff klik **Terima** (role bisa otomatis diberikan) atau **Tolak** (dengan alasan).
Member dikabari lewat DM. Satu orang satu pengajuan yang menunggu per formulir.

**Akses channel.** Pilih role: lihat channel apa saja yang dibuka role itu (per kategori). Pilih channel: lihat siapa yang bisa melihat dan menulis.
**Arahan:** kalau ada yang dapat role itu, otomatis diarahkan ke channel tujuan (dan pesan buatanmu). Lewat tombol take role arahannya ikut di balasan,
kalau role diberi staff dikirim lewat DM.

**Log join / leave** (`logs-anggota`): umur akun, masuk ke berapa kali, diundang siapa, lama di server, role terakhir, di-kick / di-ban oleh siapa,
perubahan role dan nickname, tanda akun baru, alarm lonjakan, tombol Kembalikan role.

**Log voice** (`logs-pesan`, kalau tidak ada dipakai `logs-anggota`): siapa masuk voice dan siapa keluar (+ lama di voice), lengkap dengan waktu WIB.
Pindah channel voice, mute, dan semua pesan (terkirim, diedit, dihapus) tidak dicatat. Bot lain tidak dicatat. Dikirim bergelombang supaya tidak kena batas Discord.
Versi lama menyimpan isi pesan di `data/msgcache.json`; file itu dihapus otomatis waktu bot menyala.

**Log share screen** (`video-recorder`): siapa mulai share screen (Go Live) di voice, di channel mana, dan berapa lama, ditulis ke channel `video-recorder`.
Nyalakan di Pengaturan → **Log share screen** (mati sampai kamu nyalakan), channel lain bisa dipilih lewat Hubungkan channel modul. Share yang kurang dari 5 detik tidak dicatat.
**Bot tidak merekam videonya.** Discord tidak memberi bot akses ke gambar dan suara share screen, dan sejak Maret 2026 panggilan video terenkripsi ujung ke ujung.
Cara yang tersisa dan tidak melanggar aturan Discord adalah perekaman di sisi orang yang share (OBS, atau Xbox Game Bar di Windows).

**Roster, aktivitas, data anggota.** `list-anggota` berisi daftar per role, `activity-anggota` berisi yang paling aktif dan yang tidak aktif.
Data tiap orang (riwayat masuk / keluar, role, nickname, pesan, voice) tercatat sendiri.

**Status & bio bot.** Di daftar anggota, bot menampilkan tulisan "Watching 12 online · 40 anggota" di bawah namanya, diperbarui tiap 5 menit.
Bio bot (About Me di profilnya) bisa ikut menampilkan jumlah online (nyalakan **Bio bot** di Pengaturan). Teksnya bebas lewat tombol **Teks status & bio**:
`{online}` `{anggota}` `{total}` `{server}` diganti angka terbaru. Jumlah online diambil dari hitungan perkiraan Discord (bisa selisih sedikit, tanpa intent tambahan).
`{anggota}` = jumlah orang yang punya role anggota (GodFather, Underboss, Moderator, Gangster). Bio diubah paling cepat tiap 30 menit dan hanya kalau teksnya berubah.

**Backup.** Pilih satu channel privat di Pengaturan, nyalakan Backup. Cadangan dibuat berkala dan setiap ada perubahan penting.
Bot yang dipindah ke hosting kosong memulihkan datanya sendiri (lihat `BACKUP_CHANNEL_ID` di HOSTING.md).

## Teks panel

Panel **draft** itu teks awal yang masih perlu kamu cek. Edit lewat form, atau langsung `data/content.json`. Di dalam teks boleh pakai
`{#rules-gangs}` (mention channel), `{@Nama Role}` (mention role), `{server}`. Satu panel boleh punya beberapa pesan, `fields`, `image`, `thumbnail`,
`color`, `buttons`. Setiap simpan lewat bot, versi sebelumnya dicadangkan di `data/content.bak.json`.

## settings.json

Nama channel tiap fitur, batas akun baru, batas lonjakan, hari tidak aktif, role roster, dan nama channel log voice ada di `data/settings.json`. Nyalakan / matikan fitur lewat menu Pengaturan dan Fitur lainnya.
Data kasus moderasi ada di `data/moderasi.json`, data poll / giveaway / pengingat / AFK di `data/komunitas.json`. Data bursa harga ada di `data/bursa.json`, data level dan game di `data/game.json`. Semuanya ikut dicadangkan oleh Backup.

## Kalau ada masalah

- Fitur anggota atau auto-moderasi yang membaca isi pesan mati: nyalakan intent-nya di Developer Portal lalu restart. Menu dan Status bot memberi tahu mana yang belum.
- Channel tidak ketemu: nama panel dicocokkan dengan ujung nama channel (emoji dan simbol diabaikan). Kalau beda, hubungkan manual lewat menu panel.
- Tombol "didn't respond in time": bot sedang mati. Lihat HOSTING.md.
- Jangan bagikan token bot ke siapa pun.
