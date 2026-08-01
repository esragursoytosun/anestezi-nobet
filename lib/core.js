/* =====================================================================
   ORTAK ÇEKİRDEK — depo + kimlik + yetki
   ---------------------------------------------------------------------
   TEK KAYNAK: hem yerel Node sunucusu (server.js) hem Vercel serverless
   fonksiyonları (api/*.js) bu dosyayı kullanır. Kural bir kez burada
   değişir, iki yerde birden geçerli olur.

   Depo: MongoDB Atlas (MONGODB_URI). İki ayrı doküman tutulur:
     • anestezi_state  → eski anestezi ekranı (cfg/grid/users)
     • asistan_state   → Nöbet Planlama Asistanı (units/users/rev)
   Dosya yedeği YALNIZ yerel geliştirmede kullanılır; Vercel'de disk
   salt-okunur olduğu için orada Mongo zorunludur (yoksa istek 503 döner,
   sessizce veri kaybetmez).
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.APP_PASSWORD || 'anestezi2026';
// Oturum token'ı imzası. APP_PASSWORD ile aynı kalırsa mevcut oturumlar
// taşımadan sonra da geçerli olur (kimse yeniden giriş yapmak zorunda kalmaz).
const TOKEN_SECRET = process.env.SESSION_SECRET || ADMIN_PASS || 'asistan-secret';

const DOC_ID = 'anestezi_state';
const A_DOC = 'asistan_state';

// Vercel'de yazılabilir disk yok → dosya yedeği yalnız yerelde.
const USE_FILE = !process.env.VERCEL;
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'state.json');
const A_FILE = path.join(DATA_DIR, 'asistan.json');

/* ---------------- ŞİFRE HASH + OTURUM TOKEN'I ---------------- */
function hashPw(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    return 'scrypt$' + salt + '$' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function verifyPw(pw, stored) {
    const parts = String(stored || '').split('$');
    if (parts[0] !== 'scrypt' || parts.length !== 3) return false;
    const h = crypto.scryptSync(String(pw), parts[1], 32);
    const b = Buffer.from(parts[2], 'hex');
    return h.length === b.length && crypto.timingSafeEqual(h, b);
}
function makeToken(u, role, unitId) {
    const p = Buffer.from(JSON.stringify({ u: u, role: role, unitId: unitId == null ? null : unitId })).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest('base64url');
    return p + '.' + sig;
}
function verifyToken(t) {
    if (!t || String(t).indexOf('.') < 0) return null;
    const ix = t.indexOf('.'), p = t.slice(0, ix), sig = t.slice(ix + 1);
    const exp = crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest('base64url');
    try {
        if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
        return JSON.parse(Buffer.from(p, 'base64url').toString());
    } catch (e) { return null; }
}

/* ---------------- MongoDB (bağlantı örnekler arası yeniden kullanılır) ----------------
   Serverless'ta her istek yeni bir çağrı olabilir; bağlantıyı globalThis'te
   önbelleğe alırız ki sıcak örnekler yeniden bağlanmasın (Atlas'ta bağlantı
   sayısı sınırlıdır). Söz (promise) saklanır → eşzamanlı istekler tek bağlantı açar. */
async function getCol() {
    if (!MONGODB_URI) return null;
    if (!globalThis.__anesteziCol) {
        globalThis.__anesteziCol = (async () => {
            const { MongoClient } = require('mongodb');
            const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
            await client.connect();
            return client.db('anestezi').collection('state');
        })().catch(e => { globalThis.__anesteziCol = null; throw e; });
    }
    try { return await globalThis.__anesteziCol; }
    catch (e) { console.error('[db] MongoDB bağlanamadı:', e.message); return null; }
}

/** Mongo yoksa ve dosya yedeği de yoksa (Vercel) → çağıran 503 döndürmeli. */
function storageUnavailable(col) { return !col && !USE_FILE; }

/* ---------------- anestezi_state ---------------- */
function emptyState() { return { cfg: null, grid: null, rev: 0, savedAt: null, by: null, users: [] }; }
// Hiç kullanıcı yoksa yöneticiyi tohumla (kilitlenmeyi önler).
function seed(st) { if (!st.users || !st.users.length) st.users = [{ u: ADMIN_USER, p: ADMIN_PASS, admin: true }]; return st; }

async function loadState() {
    const col = await getCol();
    if (col) {
        try {
            const doc = await col.findOne({ _id: DOC_ID });
            if (!doc) return seed(emptyState());
            const { _id, ...rest } = doc; return seed(Object.assign(emptyState(), rest));
        } catch (e) { console.error('[db] load hata:', e.message); }
    }
    if (USE_FILE) {
        try { if (fs.existsSync(FILE)) return seed(Object.assign(emptyState(), JSON.parse(fs.readFileSync(FILE, 'utf8')))); }
        catch (e) { console.error('[db] dosya okuma hata:', e.message); }
    }
    return seed(emptyState());
}
async function saveState(st) {
    const col = await getCol();
    if (col) {
        try { await col.replaceOne({ _id: DOC_ID }, Object.assign({ _id: DOC_ID }, st), { upsert: true }); return true; }
        catch (e) { console.error('[db] save hata:', e.message); }
    }
    if (!USE_FILE) return false;   // Vercel: sessizce kaybetme, çağıran hata döndürsün
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(st), 'utf8'); return true;
    } catch (e) { console.error('[db] dosya yazma hata:', e.message); return false; }
}
function pub(st) { const r = Object.assign({}, st); delete r.users; return r; }  // şifreleri istemciye gönderme

function findUser(st, u, p) {
    // ANA YÖNETİCİ ANAHTARI: env ADMIN_USER+APP_PASSWORD her zaman geçerli (asla kilitlenme).
    if (u === ADMIN_USER && p === ADMIN_PASS) return { u: ADMIN_USER, p: ADMIN_PASS, admin: true };
    return (st.users || []).find(x => x.u === u && x.p === p) || null;
}
/** Her /api/* isteği X-User + X-Auth taşır; geçerli kullanıcıyı döndürür (yoksa null). */
async function reqUser(headers) {
    const st = await loadState();
    return findUser(st, headers['x-user'] || '', headers['x-auth'] || '');
}

/* ---------------- asistan_state (çok birimli) ---------------- */
function aEmpty() { return { units: [], users: [], rev: 0 }; }

async function loadAsistan() {
    const col = await getCol();
    if (col) {
        try {
            const d = await col.findOne({ _id: A_DOC });
            if (d) { const { _id, ...r } = d; return Object.assign(aEmpty(), r); }
            return aEmpty();
        } catch (e) { console.error('[db] asistan load hata:', e.message); }
    }
    if (USE_FILE) {
        try { if (fs.existsSync(A_FILE)) return Object.assign(aEmpty(), JSON.parse(fs.readFileSync(A_FILE, 'utf8'))); } catch (e) {}
    }
    return aEmpty();
}
async function saveAsistan(st) {
    const col = await getCol();
    if (col) {
        try { await col.replaceOne({ _id: A_DOC }, Object.assign({ _id: A_DOC }, st), { upsert: true }); return true; }
        catch (e) { console.error('[db] asistan save hata:', e.message); }
    }
    if (!USE_FILE) return false;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(A_FILE, JSON.stringify(st), 'utf8'); return true;
    } catch (e) { return false; }
}
function aFindUser(st, u, p) {
    if (u && u === ADMIN_USER && p === ADMIN_PASS) return { u: ADMIN_USER, role: 'admin', unitId: null };
    var usr = (st.users || []).find(x => x.u === u); if (!usr) return null;
    if (usr.pw) return verifyPw(p, usr.pw) ? usr : null;          // hash'li (yeni)
    if (usr.p !== undefined) return usr.p === p ? usr : null;      // eski düz metin (girişte yükseltilir)
    return null;
}
async function aReqUser(headers) {
    const u = headers['x-user'] || '', auth = headers['x-auth'] || '';
    const tk = verifyToken(auth);                                  // yeni oturum: imzalı token
    if (tk && tk.u === u) return tk;
    const st = await loadAsistan(); return aFindUser(st, u, auth);  // eski oturum: düz metin (geçiş)
}
function aCanAccess(me, unitId) { return me && (me.role === 'admin' || me.unitId === unitId); }

module.exports = {
    ADMIN_USER, ADMIN_PASS, USE_FILE,
    hashPw, verifyPw, makeToken, verifyToken,
    getCol, storageUnavailable,
    emptyState, seed, loadState, saveState, pub, findUser, reqUser,
    aEmpty, loadAsistan, saveAsistan, aFindUser, aReqUser, aCanAccess,
};
