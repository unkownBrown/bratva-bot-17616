# Bot nyala sendiri lewat Netlify

Dengan ini bot menyala sendiri di Netlify tanpa PC kamu. Bot dibangunkan otomatis tiap 3 menit kalau sempat mati.

> **Status jujur: belum diuji di Netlify asli.** Aku tidak punya akun Netlify dan tidak bisa menjangkau Netlify dari tempatku bekerja.
> Yang sudah diuji: kode server dan penjaganya dijalankan dengan tiruan Netlify (bot menyala, dipertahankan, disimpan saat dimatikan,
> dan menyala lagi). Cara kerja Netlify-nya kubaca dari dokumentasi mereka (dicek 14 November 2026). **Netlify Server masih Early Access**
> (baru dibuka 10 November 2026), jadi aturan dan harganya bisa berubah. Kalau ada yang gagal, lihat bagian "Kalau gagal" di bawah.

## Cara kerjanya

- Netlify Server menjalankan proses Node yang berjalan terus, tidak seperti fungsi biasa yang mati setelah beberapa detik. Bot ikut jalan di dalamnya.
- Server berhenti sendiri kalau 5 menit tidak ada permintaan. Selama bot nyala, bot menitipkan pekerjaan ke Netlify (`waitUntil`) supaya server tidak dianggap diam.
- Server diganti Netlify paling lama tiap 8 jam, dan berhenti kalau ada deploy baru. Fungsi terjadwal `jaga-bot` membuka alamat `/status` tiap 3 menit.
  Kalau server mati, pembukaan itu menyalakannya lagi dan bot ikut menyala. Jadi mati paling lama sekitar 3 menit.
- Disk di Netlify hanya `/tmp` dan hilang tiap server diganti. Karena itu data bot (pengaturan, XP, koin, panel) dicadangkan ke channel Discord
  tiap 30 menit dan saat server dimatikan rapi, lalu dipulihkan otomatis waktu bot menyala lagi.

## Langkah pasang

1. **Cadangan sudah terpasang.** Channel cadangannya (ID `1562236596294647880`) sudah tertulis di `netlify/server/index.mjs`, dan di Netlify
   Backup menyala sendiri begitu bot mengenali channel itu. Kamu cukup memastikan bot boleh **Lihat Channel, Kirim Pesan, Lampirkan File, dan Baca Riwayat Pesan** di channel tersebut.
   Mau pakai channel lain: isi variabel `BACKUP_CHANNEL_ID` di langkah 4, nilainya menggantikan yang tertulis.
2. **Taruh folder bot di GitHub** (repo privat). Jangan ikut mengunggah `node_modules`, `.env`, dan `data/` (sudah ada di `.gitignore`).
   Token tidak boleh masuk repo.
3. Di Netlify: **Add new project → Import an existing project** → pilih repo itu. Pengaturan build sudah ada di `netlify.toml` (Node 24, folder terbit `netlify/publik`).
   Kalau Netlify tidak menampilkan Netlify Server, fitur itu mungkin perlu diaktifkan atau kamu perlu masuk daftar Early Access. Cek dokumentasi Netlify Server.
4. **Site configuration → Environment variables**, tambahkan:
   - `DISCORD_TOKEN` = token bot (wajib)
   - `BACKUP_CHANNEL_ID` = ID channel cadangan (opsional, hanya kalau mau channel yang beda dari langkah 1)
   - `BOT_URL` = alamat situsmu, misalnya `https://nama-situs.netlify.app` (opsional, buat berjaga-jaga kalau penjaga tidak tahu alamat situsnya)
   - Musik (opsional): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `YT_COOKIES` (lihat `.env.example`)
5. **Deploy.** Buka `https://nama-situs.netlify.app/status`. Kalau muncul `bratva-bot: nyala`, bot sudah online di Discord.
   Halaman itu juga bilang `sedang menyala` (tunggu semenit, lalu muat ulang) atau `gagal: ...` dengan alasannya.
6. **Cek penjaganya.** Netlify → Logs → Functions → `jaga-bot`: harus ada baris `[jaga-bot] 200 bratva-bot: nyala` tiap 3 menit.
   Fungsi terjadwal hanya jalan di deploy production.

## Update bot

Update lewat Discord (`/panel` → Status bot → Update bot) **dimatikan** di Netlify, karena file hilang waktu server diganti.
Cara update: ganti file di repo GitHub dengan versi baru lalu push. Netlify deploy sendiri dan bot menyala lagi.

## Batasan yang perlu kamu tahu

- **Musik belum tentu jalan.** Musik butuh koneksi UDP keluar ke server voice Discord. Dokumentasi Netlify tidak menyebut apakah itu diizinkan,
  dan aku tidak bisa mengujinya. Fitur lain (panel, level, game, moderasi, bursa, log) hanya butuh koneksi HTTPS dan WebSocket biasa.
  Kalau musik tidak tersambung, jalankan bot di Oracle (lihat `HOSTING.md`), atau terima musik tidak aktif di Netlify.
- **Pergantian server:** tiap maksimal 8 jam bot mati sebentar dan lagu yang sedang diputar berhenti.
  Sesaat saat pergantian, dua bot bisa menyala bersamaan, jadi ada kemungkinan satu dua balasan ganda.
- **Kalau pemulihan gagal** (misalnya Discord error saat bot baru nyala di disk kosong), bot menahan cadangan baru dan mencoba memulihkan lagi dulu,
  supaya data kosong tidak jadi cadangan terbaru dan menimpa cadangan yang bagus. Pesannya muncul di log: `Cadangan ditahan`.
- **Kalau server crash mendadak** (bukan dimatikan Netlify dengan rapi), data yang berubah setelah cadangan terakhir (paling lama 30 menit) hilang, misalnya XP dan koin.
- **Paket dan biaya:** Netlify Server tersedia di paket Netlify berbasis kredit (Free dan Personal ikut, dibatasi satu server yang jalan sekaligus) dan gratis selama Early Access.
  Setelah itu ditagih dengan kredit sesuai memori yang dipesan dan waktu CPU yang dipakai, tarifnya belum diumumkan. Bot yang nyala 24 jam berarti server yang nyala 24 jam,
  jadi cek tarifnya begitu diumumkan sebelum dibiarkan jalan lama.
- **Koneksi ke Discord:** Netlify menutup koneksi keluar yang 60 detik tidak ada data. Koneksi bot ke Discord mengirim detak jantung sekitar tiap 41 detik, jadi seharusnya aman. Ini juga belum kubuktikan di Netlify asli.
- Alamat `/` dan `/status` hanya menjawab satu baris status. Tidak ada rahasia di dalamnya.

## Kalau gagal

- `/status` bilang `gagal: DISCORD_TOKEN belum diisi`: isi variabel di langkah 4, lalu deploy ulang.
- `gagal login`: buka Netlify → Logs → Functions / Server dan cari baris `[netlify] bot gagal menyala`. Biasanya token salah atau Message Content Intent belum dinyalakan di Discord Developer Portal.
- Bot sering offline: lihat log `jaga-bot`. Kalau tidak ada barisnya, fungsi terjadwal belum jalan (belum deploy production).
- Server tidak mau naik sama sekali atau Netlify menolak proses yang berjalan lama: pakai `HOSTING.md` (Oracle Cloud Always Free paling pas buat bot ini).
