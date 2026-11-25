# Biar bot nyala terus tanpa PC

Kalau bot mati, tombol di panel (take role, formulir) tidak dijawab dan Discord menampilkan
"didn't respond in time". Begitu bot nyala lagi, tombolnya langsung jalan lagi. Tidak perlu posting ulang.

Bot butuh "komputer yang nyala terus". Info di bawah dicek Oktober 2026. Syarat dan harga bisa berubah, cek lagi di situsnya.

## Kebutuhan bot

- Node.js 18 ke atas (20 ke atas kalau pakai musik, disarankan 22), perintah jalankan: `node index.js`
- Environment variable: `DISCORD_TOKEN` (wajib)
- RAM: 512 MB cukup tanpa musik. Dengan musik, ambil 1 GB (yt-dlp dan ffmpeg jalan di samping bot). Belum aku ukur langsung.
- Tidak butuh port terbuka. Kalau hostingnya minta port, bot membuka endpoint kecil di `PORT`.

## Pilihan

**1. Oracle Cloud Always Free (gratis, nyala terus beneran)**
Dapat VM sungguhan (sampai dua VM kecil 1 GB RAM, atau VM Arm yang lebih besar) yang gratis selamanya selama tidak melewati batas.
Daftarnya butuh nomor HP dan kartu debit / kredit untuk verifikasi. Kartu tidak ditagih kecuali kamu upgrade ke akun berbayar.
Pilih "home region" yang menyediakan VM-nya, dan cek dulu apakah kartumu diterima (kartu virtual / prepaid sering ditolak).
Kekurangan: kamu atur server Linux sendiri. Langkah singkatnya ada di bawah.

**2. Hosting kecil berbayar (paling praktis kalau tidak punya kartu)**
Ada hosting app yang paket kecilnya sekitar satu dua dolar per bulan, dan Railway Hobby $5 per bulan (bayar pakai kartu).
Upload zip lewat panel, isi `DISCORD_TOKEN`, nyalakan. Cek dulu metode pembayarannya (DANA / QRIS / kartu).

**3. Netlify Server (Early Access, belum diuji di Netlify asli)**
Netlify baru membuka server yang berjalan terus. Bot bisa dijalankan di sana dan dibangunkan otomatis oleh fungsi terjadwal.
Syarat dan tarif belum jelas, filesystem-nya hilang tiap pergantian server (paling lama 8 jam), dan belum ketahuan apakah musik (UDP) diizinkan. Langkahnya ada di **NETLIFY.md**.

**4. Gratis tapi tidak cocok buat bot ini**
- **Render (free)**: web service gratis dimatikan kalau 15 menit tanpa trafik masuk, filesystem-nya hilang tiap restart, dan Render bisa
  me-restart kapan saja. Memancingnya supaya tidak tidur dianggap pihak Render melawan "semangat" paket gratis, jadi bisa dihentikan sewaktu-waktu.
- **Koyeb (free)**: tidur setelah 1 jam tanpa trafik dan tidak bisa dimatikan, dan sekarang minta kartu.
- Hosting bot gratis 128 MB yang harus diperpanjang tiap 24 jam terlalu kecil.

**5. PC / HP bekas di rumah**
Jalankan `start.bat` dan biarkan nyala. Gratis, tapi mati kalau listrik atau internet mati.

## Pasang di Oracle (atau server Linux apa pun)

1. Buat VM Ubuntu "Always Free". Simpan kunci SSH yang diberikan.
2. Upload folder bot ke VM (tanpa `node_modules`), misalnya pakai WinSCP atau `scp`.
3. Masuk lewat SSH, `cd` ke folder bot, jalankan: `bash deploy/linux-service.sh`
4. Tempel token. Selesai: bot nyala dan hidup lagi sendiri setelah server restart.
   Log: `journalctl -u brv-panel-bot -f`. Update: timpa file baru lalu `sudo systemctl restart brv-panel-bot`.

## Update dan restart

Update lewat Discord membuat bot berhenti dengan kode 42 supaya dinyalakan lagi oleh penjaganya: `start.bat` (Windows), systemd
(`deploy/linux-service.sh` sudah memakai `Restart=always`), atau hosting yang otomatis menyalakan ulang. Di hosting yang filenya suka ke-reset,
update lewat Discord hilang saat redeploy. Di sana update lewat repo atau upload ulang.

## Data aman walau hosting reset

- Di VM seperti Oracle, filenya permanen. Di hosting yang filenya suka ke-reset (Render, Railway tanpa disk, dan sejenisnya), pakai backup.
- Buat satu channel privat khusus backup. Di bot: Pengaturan → Hubungkan channel modul → Backup, lalu nyalakan **Backup**.
- Isi environment variable `BACKUP_CHANNEL_ID` dengan ID channel itu (klik kanan channel → Copy Channel ID). Dengan itu bot yang baru
  dinyalakan di hosting kosong tahu harus mengambil cadangan dari mana, dan memulihkan teks panel, pengaturan, take role, formulir, arahan, dan data anggota sendiri.

## Take role tanpa bot (cadangan)

Discord punya fitur bawaan bernama Onboarding di Server Settings (butuh server dalam mode Community) yang bisa memberi role dan membuka channel
lewat pertanyaan buat anggota, tanpa bot. Bisa dipakai buat role dasar supaya tetap bisa diambil walau bot lagi mati.

## Musik di hosting

- Hosting harus mengizinkan bot membuka koneksi keluar ke github.com (unduh yt-dlp), YouTube, lrclib.net, dan koneksi UDP ke server voice Discord.
  Sebagian hosting bot gratis memblokir UDP, jadi musik tidak bisa tersambung di sana.
- Hosting yang filenya suka ke-reset: yt-dlp (folder `data/bin`) diunduh ulang sendiri setelah reset, tidak perlu diapa-apakan.
- IP hosting / VPS sering diminta verifikasi oleh YouTube. Kalau lagu gagal dengan pesan soal "bukan bot", pasang `cookies.txt` (lihat README bagian Musik).
- Di Docker, image sudah memasang sertifikat HTTPS yang dibutuhkan ffmpeg dan yt-dlp.
