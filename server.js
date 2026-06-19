/* =====================================================================
   ANESTEZİ NÖBET — ORTAK/CANLI sunucu (Utopya benzeri)
   ---------------------------------------------------------------------
   - Statik dosyaları (index.html, scheduler.js) sunar.
   - /api/state  GET  -> kayıtlı ortak durumu döndürür { cfg, grid, rev, savedAt, by }
                 POST -> ortak durumu kaydeder (gövdede cfg/grid). rev artar.
   - Depo: MongoDB (MONGODB_URI varsa) yoksa data/state.json dosyası.
   - İstemci ~2 sn'de bir poll eder; rev değişince (arkadaş kaydetti) güncellenir.
   - Aynı anda iki kişi çalışabilir; kayıt "son yazan" mantığıyla birleşir (rev ile çakışma görünür).
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'state.json');
const MONGODB_URI = process.env.MONGODB_URI;
const DOC_ID = 'anestezi_state';
// Kullanıcılar state.users içinde saklanır. İlk kurulumda yönetici tohumlanır:
//   kullanıcı adı: ADMIN_USER (vars. "admin"), şifre: APP_PASSWORD (vars. "anestezi2026").
// Render'da bu ikisini ortam değişkeniyle değiştirin. Yöneticiler "Ayarlar"dan kullanıcı yönetir.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.APP_PASSWORD || 'anestezi2026';
function findUser(st, u, p) { return (st.users || []).find(x => x.u === u && x.p === p) || null; }
// Her /api/* isteği X-User + X-Auth taşır; geçerli kullanıcıyı döndürür (yoksa null).
async function reqUser(req) { const st = await loadState(); return findUser(st, req.headers['x-user'] || '', req.headers['x-auth'] || ''); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function emptyState() { return { cfg: null, grid: null, rev: 0, savedAt: null, by: null, users: [] }; }

// ---- MongoDB (opsiyonel) ----
let _col = null, _mongoTried = false;
async function getCol() {
  if (!MONGODB_URI) return null;
  if (_col) return _col;
  if (_mongoTried && !_col) return null;
  _mongoTried = true;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    _col = client.db('anestezi').collection('state');
    console.log('[db] MongoDB bağlandı.');
    return _col;
  } catch (e) {
    console.error('[db] MongoDB bağlanamadı, dosya kullanılacak:', e.message);
    return null;
  }
}
async function loadState() {
  const col = await getCol();
  if (col) {
    try {
      const doc = await col.findOne({ _id: DOC_ID });
      if (!doc) return seed(emptyState());
      const { _id, ...rest } = doc; return seed(Object.assign(emptyState(), rest));
    } catch (e) { console.error('[db] load hata, dosya:', e.message); }
  }
  try { if (fs.existsSync(FILE)) return seed(Object.assign(emptyState(), JSON.parse(fs.readFileSync(FILE, 'utf8')))); }
  catch (e) { console.error('[db] dosya okuma hata:', e.message); }
  return seed(emptyState());
}
// Hiç kullanıcı yoksa yöneticiyi tohumla (kilitlenmeyi önler; admin asla yok olmaz).
function seed(st) { if (!st.users || !st.users.length) st.users = [{ u: ADMIN_USER, p: ADMIN_PASS, admin: true }]; return st; }
async function saveState(st) {
  const col = await getCol();
  if (col) {
    try { await col.replaceOne({ _id: DOC_ID }, Object.assign({ _id: DOC_ID }, st), { upsert: true }); return; }
    catch (e) { console.error('[db] save hata, dosya:', e.message); }
  }
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(st), 'utf8'); }
  catch (e) { console.error('[db] dosya yazma hata:', e.message); }
}

function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function pub(st) { const r = Object.assign({}, st); delete r.users; return r; }   // şifreleri istemciye gönderme

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  // ---- Giriş: kullanıcı adı + şifre ----
  if (u.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', async () => {
      try { const b = JSON.parse(body || '{}'); const st = await loadState();
        const usr = findUser(st, (b.username || '').trim(), b.password || '');
        if (usr) return sendJSON(res, 200, { ok: true, username: usr.u, admin: !!usr.admin });
        return sendJSON(res, 401, { ok: false, error: 'Kullanıcı adı veya şifre hatalı' });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    });
    return;
  }

  // ---- Şifre değiştir (giriş yapan kendi şifresini) ----
  if (u.pathname === '/api/changepw' && req.method === 'POST') {
    const me = await reqUser(req); if (!me) return sendJSON(res, 401, { error: 'Giriş gerekli' });
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', async () => { try {
      const np = ((JSON.parse(body || '{}').newPass) || '').trim();
      if (np.length < 3) return sendJSON(res, 400, { error: 'Şifre en az 3 karakter olmalı' });
      const st = await loadState(); const usr = st.users.find(x => x.u === me.u);
      if (usr) { usr.p = np; await saveState(st); }
      return sendJSON(res, 200, { ok: true, newPass: np });
    } catch (e) { sendJSON(res, 400, { error: e.message }); } });
    return;
  }

  // ---- Kullanıcı yönetimi (liste herkese; ekle/sil/şifre yalnız yönetici) ----
  if (u.pathname === '/api/users') {
    const me = await reqUser(req); if (!me) return sendJSON(res, 401, { error: 'Giriş gerekli' });
    if (req.method === 'GET') { const st = await loadState();
      return sendJSON(res, 200, { users: st.users.map(x => ({ u: x.u, admin: !!x.admin })), admin: !!me.admin, me: me.u }); }
    if (req.method === 'POST') {
      if (!me.admin) return sendJSON(res, 403, { error: 'Bu işlem için yönetici olmalısınız' });
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', async () => { try {
        const b = JSON.parse(body || '{}'); const st = await loadState(); const list = st.users;
        if (b.action === 'add') { const uu = (b.u || '').trim(), pp = (b.p || '').trim();
          if (!uu || !pp) return sendJSON(res, 400, { error: 'Kullanıcı adı ve şifre gerekli' });
          if (list.some(x => x.u === uu)) return sendJSON(res, 400, { error: 'Bu kullanıcı adı zaten var' });
          list.push({ u: uu, p: pp, admin: !!b.admin }); }
        else if (b.action === 'remove') { if (b.u === me.u) return sendJSON(res, 400, { error: 'Kendinizi silemezsiniz' });
          const i = list.findIndex(x => x.u === b.u); if (i >= 0) list.splice(i, 1); }
        else if (b.action === 'setpass') { const usr = list.find(x => x.u === b.u); if (usr && b.p) usr.p = b.p; }
        else return sendJSON(res, 400, { error: 'bilinmeyen işlem' });
        await saveState(st);
        return sendJSON(res, 200, { ok: true, users: list.map(x => ({ u: x.u, admin: !!x.admin })) });
      } catch (e) { sendJSON(res, 400, { error: e.message }); } });
      return;
    }
    return sendJSON(res, 405, { error: 'method' });
  }

  // ---- Ortak durum (giriş gerekli; yanıtta şifreler GİZLENİR) ----
  if (u.pathname === '/api/state') {
    const me = await reqUser(req); if (!me) return sendJSON(res, 401, { error: 'Giriş gerekli' });
    if (req.method === 'GET') { const st = await loadState(); return sendJSON(res, 200, pub(st)); }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const incoming = JSON.parse(body || '{}');
          const cur = await loadState();
          const next = Object.assign({}, cur, {
            cfg: incoming.cfg !== undefined ? incoming.cfg : cur.cfg,
            grid: incoming.grid !== undefined ? incoming.grid : cur.grid,
            rev: (cur.rev || 0) + 1, savedAt: new Date().toISOString(), by: incoming.by || me.u });
          await saveState(next);
          sendJSON(res, 200, pub(next));
        } catch (e) { sendJSON(res, 400, { error: e.message }); }
      });
      return;
    }
    return sendJSON(res, 405, { error: 'method' });
  }

  // ---- statik dosyalar ----
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const fp = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

// Sağlık ucu (uyumama ping'i buraya gelir, hafif).
// (statik handler '/healthz' yolunu dosya arar; aşağıdaki kısayolu eklemek için handler'da değil
//  burada basit tutuyoruz: '/' zaten index.html veriyor, ping '/' veya RENDER_EXTERNAL_URL'a gider.)

server.listen(PORT, () => console.log('Anestezi ortak sunucu: http://localhost:' + PORT + (MONGODB_URI ? ' (MongoDB)' : ' (dosya)')));

// ---- UYUMAMA: Render Free 15 dk hareketsizlikte uyur. Kendi genel adresimize ~13 dk'da bir
//      istek atarak uyanık tutarız (RENDER_EXTERNAL_URL'i Render otomatik verir). Bedava, ek servis yok.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL && typeof fetch === 'function') {
  setInterval(() => { fetch(SELF_URL).catch(() => {}); }, 13 * 60 * 1000);
  console.log('[keepalive] uyumama aktif:', SELF_URL);
}
