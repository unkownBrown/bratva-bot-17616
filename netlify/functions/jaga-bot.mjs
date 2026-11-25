// Fungsi terjadwal: membangunkan server bot tiap 3 menit. Kalau server Netlify sudah berhenti (pergantian instance tiap maksimal 8 jam,
// deploy baru, atau crash), panggilan ini menyalakannya lagi dan bot ikut menyala. Kalau sudah nyala, panggilan ini tidak mengubah apa pun.
// Fungsi terjadwal hanya jalan di deploy production.
export default async (_req, context) => {
  const alamat = (process.env.BOT_URL || context?.site?.url || process.env.URL || '').replace(/\/$/, '');
  if (!alamat) {
    console.error('[jaga-bot] alamat situs tidak diketahui. Isi environment variable BOT_URL dengan alamat situsmu (https://...netlify.app).');
    return;
  }
  try {
    const res = await fetch(`${alamat}/status`, { headers: { 'user-agent': 'bratva-jaga-bot' }, signal: AbortSignal.timeout(25_000) });
    console.log(`[jaga-bot] ${res.status} ${(await res.text()).trim()}`);
  } catch (err) {
    console.error(`[jaga-bot] gagal menghubungi ${alamat}/status: ${err.message}`);
  }
};

export const config = { schedule: '*/3 * * * *' };
