// Server Netlify untuk bot Bratva (Netlify Server, Early Access). Panduan lengkap: NETLIFY.md di akar proyek.
// Berkas ini hanya merangkai; logikanya ada di host.mjs.
import os from 'node:os';
import path from 'node:path';
import { onShutdown } from '@netlify/server';
import { createHost } from './host.mjs';
import { createDash } from './dash.mjs';

// Bot tahu dia berjalan di dalam proses lain: tidak memanggil process.exit, tidak membuka port, update lewat Discord dimatikan.
process.env.BRV_EMBEDDED = '1';
// Di Netlify hanya /tmp yang bisa ditulis, dan isinya hilang saat instance diganti. Data dipulihkan dari channel panel-backup.
process.env.DATA_DIR ||= path.join(os.tmpdir(), 'brv-data');
// Channel tempat cadangan data disimpan (ID channel, bukan rahasia). Variabel BACKUP_CHANNEL_ID di Netlify, kalau diisi, menggantikan ini.
process.env.BACKUP_CHANNEL_ID ||= '1562236596294647880';

const host = createHost({
  loadBot: async () => {
    const mod = await import('../../index.js');
    return mod.default ?? mod;
  },
});

onShutdown(() => host.shutdown());
host.boot(); // nyalakan bot begitu instance hidup, tanpa menunggu permintaan pertama

const dash = createDash({ host, env: process.env });

// /dash dan /dash/api/* dilayani dashboard web; selain itu jalur lama (penjaga /status).
export default async (req, context) => {
  const { pathname } = new URL(req.url);
  if (pathname === '/dash' || pathname.startsWith('/dash/')) {
    host.touch(context);
    return dash.handle(req);
  }
  return host.handler(req, context);
};
