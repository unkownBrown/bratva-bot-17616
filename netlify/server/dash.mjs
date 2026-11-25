// Dashboard web bot (satu proses dengan bot di Netlify Server). Rute: /dash (halaman) dan /dash/api/*.
// Aman secara bawaan: tanpa DASH_USER, DASH_PASS (min 8 karakter), dan DASH_SECRET (min 16) dashboard menolak semua akses.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = (name) => require(`../../src/${name}`); // dimuat belakangan: DATA_DIR baru diisi index.mjs setelah semua import selesai
const WEEK = 7 * 86400e3;
const NAMA = {
  otomatis: 'Panel otomatis', logs: 'Log join/leave', roster: 'Roster', aktivitas: 'Aktivitas', backup: 'Backup', status: 'Status bot',
  musik: 'Musik', moderasi: 'Moderasi', automod: 'Auto-moderasi', sambutan: 'Sambutan', komunitas: 'Komunitas', bursa: 'Bursa harga',
  level: 'Level', game: 'Game', pesan: 'Log voice', layar: 'Share screen',
};
const COMMANDS = ['musik.aktif', 'moderasi.aktif', 'automod.aktif', 'komunitas.aktif', 'bursa.aktif', 'level.aktif', 'game.aktif'];

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

export function createDash({ host, env = process.env }) {
  const fails = new Map(); // ip -> { n, until }
  const ready = () => Boolean(env.DASH_USER && env.DASH_PASS?.length >= 8 && env.DASH_SECRET?.length >= 16);
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
  const sign = (s) => crypto.createHmac('sha256', env.DASH_SECRET).update(s).digest('base64url');
  const makeToken = (user) => {
    const p = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + WEEK })).toString('base64url');
    return `${p}.${sign(p)}`;
  };
  const sessionOf = (req) => {
    const m = /(?:^|;\s*)brv=([\w-]+)\.([\w-]+)/.exec(req.headers.get('cookie') ?? '');
    if (!m || !ready() || !same(m[2], sign(m[1]))) return null;
    try {
      const d = JSON.parse(Buffer.from(m[1], 'base64url'));
      return d.exp > Date.now() ? d.u : null;
    } catch {
      return null;
    }
  };

  function snapshot() {
    const bot = host.getBot();
    const client = bot?.getClient?.();
    const guild = client?.guilds.cache.first();
    const rt = lib('runtime');
    const out = {
      bot: { state: host.state(), paused: host.paused(), up: client?.isReady?.() ? client.uptime : 0, tag: client?.user?.tag ?? null },
      guild: null, toggles: [], members: [], presence: Boolean(rt.features.presence),
    };
    for (const [g, v] of Object.entries(lib('store').loadSettings())) {
      const items = Object.entries(v && typeof v === 'object' ? v : {}).filter(([, x]) => typeof x === 'boolean').map(([k, x]) => [`${g}.${k}`, k, x]);
      if (items.length) out.toggles.push({ group: NAMA[g] ?? g, items });
    }
    if (!guild) return out;
    const inVoice = [...guild.voiceStates.cache.values()].filter((s) => s.channelId && !s.member?.user.bot);
    out.guild = { name: guild.name, total: guild.memberCount, voice: inVoice.length };
    if (out.presence) {
      for (const p of guild.presences.cache.values()) {
        if (!p || p.status === 'offline' || p.status === 'invisible') continue;
        const m = guild.members.cache.get(p.userId);
        if (m?.user.bot) continue;
        out.members.push({
          name: m?.displayName ?? p.userId, status: p.status, game: p.activities.find((a) => a.type === 0)?.name ?? null,
          voice: m?.voice?.channel?.name ?? null, av: m?.displayAvatarURL({ size: 64, extension: 'png' }) ?? null,
        });
      }
    } else {
      for (const s of inVoice) {
        out.members.push({ name: s.member?.displayName ?? s.id, status: 'voice', game: null, voice: s.channel?.name ?? null, av: s.member?.displayAvatarURL({ size: 64, extension: 'png' }) ?? null });
      }
    }
    out.members = out.members.slice(0, 300);
    out.guild.online = out.presence ? out.members.length : null;
    return out;
  }

  function toggle(path) {
    const store = lib('store');
    const client = host.getBot()?.getClient?.();
    const guild = client?.guilds.cache.first();
    if (!guild) return json({ error: 'Bot belum menyala.' }, 409);
    const settings = store.loadSettings();
    const [g, k] = String(path).split('.');
    if (!Object.hasOwn(settings, g) || !Object.hasOwn(settings[g] ?? {}, k) || typeof settings[g][k] !== 'boolean') return json({ error: 'Pengaturan tidak dikenal.' }, 400);
    const on = !settings[g][k];
    if (on && path === 'backup.aktif' && !lib('panels').moduleChannel(guild, 'backup')) return json({ error: 'Pilih channel backup dulu lewat /panel di Discord.' }, 409);
    settings[g][k] = on;
    store.saveSettings(settings);
    const quiet = (p) => Promise.resolve(p).catch((err) => console.error(`[dash] ${err.message}`));
    try {
      if (COMMANDS.includes(path)) quiet(guild.commands.set(lib('interactions').commandJSON()));
      if (path === 'musik.aktif') on ? lib('musik').warmup() : quiet(lib('musik').stopAll());
      if (path === 'status.aktif') quiet(on ? lib('status').refresh(client) : lib('status').clear(client));
      if (path === 'status.bio' && on) quiet(lib('status').refresh(client, { forceBio: true }));
      if (on && (path === 'roster.aktif' || path === 'aktivitas.aktif')) quiet(lib('boards').refreshAll(guild));
      if (on && (path === 'logs.aktif' || path === 'logs.invite')) quiet(lib('logs').snapshotInvites(guild));
      quiet(lib('dashboard').refreshDashboard(guild));
    } catch (err) {
      console.error(`[dash] ${err.message}`);
    }
    return json({ ok: true, value: on });
  }

  async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, '');
    if (path === '/dash') {
      const nonce = crypto.randomBytes(16).toString('base64');
      return new Response(page(nonce, ready()), {
        headers: {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src https://cdn.discordapp.com data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        },
      });
    }
    if (!path.startsWith('/dash/api/')) return new Response('Tidak ada.', { status: 404 });
    if (!ready()) return json({ error: 'Dashboard belum diaktifkan di Netlify (DASH_USER, DASH_PASS, DASH_SECRET).' }, 503);

    const post = req.method === 'POST';
    let body = {};
    if (post) {
      if (!(req.headers.get('content-type') ?? '').includes('application/json')) return json({ error: 'Permintaan ditolak.' }, 415);
      const origin = req.headers.get('origin');
      const hosts = [req.headers.get('host'), req.headers.get('x-forwarded-host'), url.host];
      if (origin && !hosts.includes(new URL(origin).host)) return json({ error: 'Permintaan ditolak.' }, 403);
      body = await req.json().catch(() => ({}));
    }

    if (path === '/dash/api/login' && post) {
      const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '?';
      const f = fails.get(ip);
      if (f && f.n >= 5 && f.until > Date.now()) return json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' }, 429);
      const userOk = same(body.user ?? '', env.DASH_USER);
      const passOk = same(body.pass ?? '', env.DASH_PASS);
      if (!(userOk && passOk)) {
        fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60e3 });
        await new Promise((r) => setTimeout(r, 700));
        return json({ error: 'Username atau password salah.' }, 401);
      }
      fails.delete(ip);
      return json({ ok: true }, 200, { 'set-cookie': `brv=${makeToken(env.DASH_USER)}; Max-Age=${WEEK / 1000}; Path=/dash; HttpOnly; Secure; SameSite=Strict` });
    }
    if (path === '/dash/api/logout' && post) return json({ ok: true }, 200, { 'set-cookie': 'brv=; Max-Age=0; Path=/dash; HttpOnly; Secure; SameSite=Strict' });

    if (!sessionOf(req)) return json({ error: 'Belum login.' }, 401);
    if (path === '/dash/api/state') return json(snapshot());
    if (path === '/dash/api/toggle' && post) return toggle(body.path);
    if (path === '/dash/api/bot' && post) {
      if (body.action === 'stop') await host.stopBot();
      else if (body.action === 'start') await host.startBot();
      else if (body.action === 'restart') {
        await host.stopBot();
        await host.startBot();
      } else return json({ error: 'Aksi tidak dikenal.' }, 400);
      return json({ ok: true });
    }
    return json({ error: 'Tidak ada.' }, 404);
  }

  return { handle };
}

const page = (nonce, ready) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Dashboard Bot</title>
<style nonce="${nonce}">
:root{--bg:#0b0f17;--card:#131a26;--line:#222c3d;--tx:#e8edf5;--mut:#8b97ab;--ac:#5865f2;--ok:#22c55e;--bad:#ef4444;--warn:#f59e0b}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--tx);font:16px/1.4 system-ui,sans-serif;padding-bottom:84px}
main{max-width:720px;margin:auto;padding:16px}h1{font-size:20px}h2{font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin:20px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:12px}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}.pill{padding:4px 12px;border-radius:99px;font-size:13px;font-weight:600;background:#2a3346}
.ok{background:#14532d;color:#86efac}.bad{background:#7f1d1d;color:#fecaca}.warn{background:#78350f;color:#fde68a}
.mut{color:var(--mut);font-size:14px}input{width:100%;padding:14px;border-radius:12px;border:1px solid var(--line);background:#0e1420;color:var(--tx);font-size:16px;margin-top:10px}
button{font:inherit;border:0;border-radius:12px;padding:14px;font-weight:600;color:#fff;background:var(--ac);cursor:pointer;min-height:48px}button:disabled{opacity:.4}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.g{background:#2a3346}.r{background:var(--bad)}.s{background:var(--ok);color:#052e16}
.sw{display:flex;justify-content:space-between;align-items:center;padding:12px 2px;border-top:1px solid var(--line);min-height:48px}.sw:first-of-type{border-top:0}
.sw button{width:52px;height:30px;min-height:0;padding:0;border-radius:99px;background:#334155;position:relative;flex:none}.sw button:after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:.15s}
.sw button.on{background:var(--ok)}.sw button.on:after{left:25px}.m{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}.m:first-of-type{border-top:0}
.m img,.m i{width:36px;height:36px;border-radius:50%;background:#2a3346;flex:none}.m b{display:block;font-weight:600}.dot{width:10px;height:10px;border-radius:50%;margin-left:auto;flex:none}
nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:#0e1420;border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
nav button{flex:1;background:none;color:var(--mut);border-radius:0;min-height:56px}nav button.on{color:#fff;box-shadow:inset 0 3px var(--ac)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}.stats b{font-size:24px;display:block}
#toast{position:fixed;left:16px;right:16px;bottom:96px;max-width:560px;margin:auto;background:#7f1d1d;padding:12px 16px;border-radius:12px;display:none}
[hidden]{display:none!important}
</style></head><body>
<main id="login" hidden><h1>Dashboard Bot</h1><div class="card">${ready
    ? '<p class="mut">Masuk dengan akun dashboard.</p><input id="u" placeholder="Username" autocomplete="username" autocapitalize="none"><input id="p" type="password" placeholder="Password" autocomplete="current-password"><button id="go" style="width:100%;margin-top:12px">Masuk</button>'
    : '<p>Dashboard belum diaktifkan.</p><p class="mut" style="margin-top:8px">Isi <b>DASH_USER</b>, <b>DASH_PASS</b> (min 8 karakter), dan <b>DASH_SECRET</b> (min 16 karakter) di Netlify, lalu deploy ulang. Atau jalankan deploy-netlify.bat.</p>'}</div></main>
<main id="app" hidden>
<div class="top"><div><h1 id="tag">Bot</h1><div class="mut" id="sub"></div></div><span class="pill" id="pill">...</span></div>
<section id="t-bot"><h2>Kontrol bot</h2><div class="card"><div class="row"><button class="s" id="b-start">Nyalakan</button><button class="g" id="b-restart">Restart</button><button class="r" id="b-stop">Matikan</button></div>
<p class="mut" style="margin-top:10px" id="note"></p></div><button class="g" id="out" style="width:100%">Keluar</button></section>
<section id="t-fitur" hidden><h2>Fitur</h2><div id="fitur"></div></section>
<section id="t-anggota" hidden><div class="card stats"><div><b id="n-on">-</b><span class="mut">Online</span></div><div><b id="n-play">-</b><span class="mut">Lagi main</span></div><div><b id="n-voice">-</b><span class="mut">Di voice</span></div></div>
<p class="mut" id="hint" hidden>Presence Intent belum menyala, jadi yang tampil hanya anggota di voice. Nyalakan di Discord Developer Portal (Bot, Privileged Gateway Intents) lalu restart bot.</p>
<h2>Lagi main</h2><div class="card" id="play"></div><h2>Online</h2><div class="card" id="online"></div></section>
<nav><button data-t="bot" class="on">Bot</button><button data-t="fitur">Fitur</button><button data-t="anggota">Anggota</button></nav></main>
<div id="toast"></div>
<script nonce="${nonce}">
const $=(s)=>document.querySelector(s);
const h=(t,p={},...k)=>{const e=document.createElement(t);for(const[a,v]of Object.entries(p))a==='class'?e.className=v:a.startsWith('on')?e.addEventListener(a.slice(2),v):e.setAttribute(a,v);e.append(...k.flat().filter((x)=>x!=null&&x!==false));return e};
const toast=(m)=>{const t=$('#toast');t.textContent=m;t.style.display='block';setTimeout(()=>t.style.display='none',3500)};
const show=(w)=>{$('#login').hidden=w!=='login';$('#app').hidden=w!=='app'};
async function api(p,b){const r=await fetch('/dash/api/'+p,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{});
 const d=await r.json().catch(()=>({}));if(r.status===401&&p!=='login'){show('login');throw 0}if(!r.ok)throw new Error(d.error||'Gagal');return d}
const dur=(ms)=>{const m=Math.floor(ms/60000);return m>=60?Math.floor(m/60)+' jam '+(m%60)+' mnt':Math.max(m,1)+' mnt'};
const ST={running:['Nyala','ok'],starting:['Menyala...','warn'],failed:['Gagal','bad'],stopping:['Berhenti...','warn'],stopped:['Mati','bad'],idle:['Mati','bad']};
const DOT={online:'#22c55e',idle:'#f59e0b',dnd:'#ef4444',voice:'#5865f2'};
const person=(m,sub)=>h('div',{class:'m'},m.av?h('img',{src:m.av,alt:'',width:36,height:36}):h('i'),h('div',{},h('b',{},m.name),h('span',{class:'mut'},sub)),h('span',{class:'dot',style:'background:'+(DOT[m.status]||'#64748b')}));
function draw(d){
 const[st,cl]=ST[d.bot.state]||['?',''];const pill=$('#pill');pill.textContent=d.bot.paused?'Dimatikan':st;pill.className='pill '+(d.bot.paused?'bad':cl);
 $('#tag').textContent=d.bot.tag||'Bot';$('#sub').textContent=d.guild?d.guild.name+(d.bot.up?' - nyala '+dur(d.bot.up):''):'Belum tersambung';
 const run=d.bot.state==='running'||d.bot.state==='starting';$('#b-start').disabled=run;$('#b-stop').disabled=!run;$('#b-restart').disabled=!run;
 $('#note').textContent=d.bot.paused?'Bot dimatikan dari dashboard dan tidak akan dinyalakan penjaga otomatis. Kalau Netlify mengganti server (maks 8 jam), bot bisa menyala lagi sendiri.':'';
 const f=$('#fitur');f.replaceChildren(...d.toggles.map((g)=>h('div',{class:'card'},h('b',{},g.group),...g.items.map(([path,k,v])=>
  h('div',{class:'sw'},h('span',{},k==='aktif'?'Nyalakan':k.replace(/([A-Z])/g,' $1').toLowerCase()),
   h('button',{class:v?'on':'','aria-label':g.group+' '+k,onclick:async(e)=>{e.target.disabled=true;try{await api('toggle',{path});await load()}catch(x){toast(x.message)}e.target.disabled=false}}))))));
 const play=d.members.filter((m)=>m.game),on=d.members;
 $('#n-on').textContent=d.guild?.online??'-';$('#n-play').textContent=d.presence?play.length:'-';$('#n-voice').textContent=d.guild?.voice??'-';$('#hint').hidden=d.presence;
 $('#play').replaceChildren(...(play.length?play.map((m)=>person(m,m.game+(m.voice?' - '+m.voice:''))):[h('span',{class:'mut'},d.presence?'Tidak ada yang lagi main.':'Butuh Presence Intent.')]));
 $('#online').replaceChildren(...(on.length?on.map((m)=>person(m,m.voice?'Di voice: '+m.voice:m.status==='voice'?'Di voice':m.status)):[h('span',{class:'mut'},'Tidak ada data.')]));
}
async function load(){try{draw(await api('state'))}catch(x){if(x)toast(x.message)}}
async function bot(action){try{await api('bot',{action});await load()}catch(x){toast(x.message)}}
$('#b-start').onclick=()=>bot('start');$('#b-stop').onclick=()=>confirm('Matikan bot?')&&bot('stop');$('#b-restart').onclick=()=>bot('restart');
$('#out').onclick=async()=>{await api('logout',{});show('login')};
document.querySelectorAll('nav button').forEach((b)=>b.onclick=()=>{document.querySelectorAll('nav button').forEach((x)=>x.classList.toggle('on',x===b));for(const t of['bot','fitur','anggota'])$('#t-'+t).hidden=t!==b.dataset.t});
const go=$('#go');if(go){const run=async()=>{try{await api('login',{user:$('#u').value,pass:$('#p').value});show('app');load()}catch(x){toast(x.message)}};go.onclick=run;$('#p').onkeydown=(e)=>e.key==='Enter'&&run()}
fetch('/dash/api/state').then((r)=>r.ok?(show('app'),r.json().then(draw)):show('login')).catch(()=>show('login'));
setInterval(()=>{if(!$('#app').hidden&&!document.hidden)load()},15000);
</script></body></html>`;
