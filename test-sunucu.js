/* =====================================================================
   SUNUCU TESTLERİ — giriş, oturum, deneme freni, sürüm geçmişi
   Çalıştır: node test-sunucu.js
   Gerçek MongoDB yerine bellekte çalışan sahte bir koleksiyon kullanılır;
   uç noktaların (api/asistan/*.js) kendisi çağrılır.
   ===================================================================== */
'use strict';
process.env.MONGODB_URI = 'mongodb://sahte';
process.env.APP_PASSWORD = 'test-yonetici-sifresi';
delete process.env.VERCEL;

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

/* ---- bellek içi koleksiyon (kullanılan Mongo işlemleri kadar) ---- */
const docs = new Map();
const kopya = o => JSON.parse(JSON.stringify(o));
function eslesir(d, f) {
    return Object.keys(f).every(k => {
        const v = f[k];
        if (k === '_id' && v && v.$in) return v.$in.indexOf(d._id) >= 0;
        if (k === 'units' && v && v.$elemMatch) return (d.units || []).some(u => eslesir(u, v.$elemMatch));
        if (k === 'units.id') return (d.units || []).some(u => u.id === v);
        if (k === '$or') return v.some(alt => eslesir(d, alt));
        if (v && typeof v === 'object' && '$exists' in v) return (d[k] !== undefined) === v.$exists;
        return d[k] === v;
    });
}
function imlec(list) {
    let l = list.slice();
    return { sort(s) { const k = Object.keys(s)[0], y = s[k]; l.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * y); return this; },
        skip(n) { l = l.slice(n); return this; }, limit(n) { l = l.slice(0, n); return this; }, async toArray() { return kopya(l); } };
}
const col = {
    async findOne(f) { for (const d of docs.values()) if (eslesir(d, f)) return kopya(d); return null; },
    find(f) { return imlec([...docs.values()].filter(d => eslesir(d, f))); },
    async insertOne(d) { docs.set(d._id, kopya(d)); },
    async deleteOne(f) { for (const d of docs.values()) if (eslesir(d, f)) { docs.delete(d._id); return; } },
    async deleteMany(f) { for (const d of [...docs.values()]) if (eslesir(d, f)) docs.delete(d._id); },
    async replaceOne(f, d) { docs.set(f._id, kopya(d)); },
    async updateOne(f, u, o) {
        let d = null; for (const x of docs.values()) if (eslesir(x, f)) { d = x; break; }
        if (!d) { if (!(o && o.upsert)) return { matchedCount: 0 }; d = { _id: f._id }; docs.set(d._id, d); }
        const un = (d.units || []).find(x => eslesir(x, (f.units && f.units.$elemMatch) || { id: f['units.id'] }));
        if (u.$set) for (const k in u.$set) {
            if (k.indexOf('units.$.') === 0) un[k.slice(8)] = kopya(u.$set[k]);
            else d[k] = kopya(u.$set[k]);
        }
        return { matchedCount: 1 };
    },
};
globalThis.__anesteziCol = Promise.resolve(col);

const core = require('./lib/core');
const login = require('./api/asistan/login');
const unit = require('./api/asistan/unit');

function cagir(fn, { method = 'GET', body, query = {}, headers = {} } = {}) {
    return new Promise(resolve => {
        const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ status: this._c, body: o }); } };
        fn({ method, body, query, headers }, res);
    });
}

(async () => {
    docs.set('asistan_state', { _id: 'asistan_state', rev: 0, users: [{ u: 'yon1', pw: core.hashPw('dogru-sifre'), role: 'manager', unitId: 'b1' }],
        units: [{ id: 'b1', name: 'Birim', profile: { name: 'Birim' }, cfg: { months: {} }, rev: 0 }] });

    console.log('== Giriş ve oturum');
    let r = await cagir(login, { method: 'POST', body: { username: 'yon1', password: 'dogru-sifre' } });
    ok(r.status === 200 && r.body.token, 'doğru şifreyle giriş token vermeli');
    const tok = r.body.token;
    ok(!!core.verifyToken(tok), 'yeni token doğrulanmalı');
    const H = { 'x-user': 'yon1', 'x-auth': tok };
    ok((await cagir(unit, { query: { id: 'b1' }, headers: H })).status === 200, 'token ile birim okunmalı');
    ok((await cagir(unit, { query: { id: 'b1' }, headers: { 'x-user': 'yon1', 'x-auth': 'dogru-sifre' } })).status === 401, 'düz şifre başlıkta artık kabul edilmemeli');
    // süresi dolmuş token
    const crypto = require('crypto');
    const p = Buffer.from(JSON.stringify({ u: 'yon1', role: 'manager', unitId: 'b1', exp: Date.now() - 1000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', process.env.APP_PASSWORD).update(p).digest('base64url');
    ok(core.verifyToken(p + '.' + sig) === null, 'süresi dolmuş token reddedilmeli');
    const p2 = Buffer.from(JSON.stringify({ u: 'yon1', role: 'manager', unitId: 'b1' })).toString('base64url');
    ok(core.verifyToken(p2 + '.' + crypto.createHmac('sha256', process.env.APP_PASSWORD).update(p2).digest('base64url')) === null, 'süresiz eski token reddedilmeli');
    ok((await cagir(unit, { query: { id: 'b2' }, headers: H })).status === 403, 'yönetici başka birime erişememeli');
    r = await cagir(login, { method: 'POST', body: { username: 'admin', password: 'test-yonetici-sifresi' } });
    ok(r.status === 200 && r.body.role === 'admin', 'ortam şifresiyle yönetici girişi');
    r = await cagir(login, { method: 'POST', body: { username: 'admin', password: 'anestezi2026' } });
    ok(r.status === 401, 'koddaki eski varsayılan şifre ortam şifresi varken geçmemeli');

    console.log('== Deneme freni');
    for (let i = 0; i < 8; i++) await cagir(login, { method: 'POST', body: { username: 'yon1', password: 'yanlis' + i } });
    r = await cagir(login, { method: 'POST', body: { username: 'yon1', password: 'dogru-sifre' } });
    ok(r.status === 429, '8 hatalı denemeden sonra doğru şifre bile kilitli olmalı (çıkan ' + r.status + ')');
    docs.delete('giris:yon1');
    r = await cagir(login, { method: 'POST', body: { username: 'yon1', password: 'dogru-sifre' } });
    ok(r.status === 200, 'kilit kalkınca giriş çalışmalı');

    console.log('== Sürüm geçmişi');
    for (let i = 1; i <= 3; i++) {
        r = await cagir(unit, { method: 'POST', query: { id: 'b1' }, headers: H, body: { profile: { name: 'Birim', surum: i }, cfg: { months: {} }, rev: i - 1 } });
        ok(r.status === 200 && r.body.rev === i, i + '. kayıt başarılı olmalı');
    }
    r = await cagir(unit, { query: { id: 'b1', gecmis: 'liste' }, headers: H });
    const L = r.body.kayitlar || [];
    ok(L.length === 4, 'ilk kayıttan önceki hâl + 3 kayıt = 4 sürüm (çıkan ' + L.length + ')');
    const ilk = L[L.length - 1];
    r = await cagir(unit, { query: { id: 'b1', gecmis: ilk._id }, headers: H });
    ok(r.status === 200 && r.body.profile && r.body.profile.surum === undefined, 'en eski sürüm kayıt öncesi hâli vermeli');
    r = await cagir(unit, { query: { id: 'b1', gecmis: L[0]._id }, headers: H });
    ok(r.body.profile && r.body.profile.surum === 3, 'en yeni sürüm son kaydı vermeli');
    ok((await cagir(unit, { query: { id: 'b2', gecmis: 'liste' }, headers: H })).status === 403, 'başka birimin geçmişi okunamamalı');
    for (let i = 4; i <= 26; i++) await cagir(unit, { method: 'POST', query: { id: 'b1' }, headers: H, body: { profile: { surum: i }, rev: i - 1 } });
    ok((await core.gecmisListe('b1')).length === 20, 'birim başına en fazla 20 sürüm tutulmalı');

    console.log('== Şifre değiştirme');
    const admin = require('./api/asistan/admin');
    r = await cagir(admin, { method: 'POST', headers: H, body: { action: 'changeOwnPw', eski: 'yanlis', yeni: 'yeni-sifre-123' } });
    ok(r.status === 403, 'mevcut şifre yanlışsa değişmemeli');
    r = await cagir(admin, { method: 'POST', headers: H, body: { action: 'changeOwnPw', eski: 'dogru-sifre', yeni: 'kisa' } });
    ok(r.status === 400, '8 karakterden kısa şifre reddedilmeli');
    r = await cagir(admin, { method: 'POST', headers: H, body: { action: 'changeOwnPw', eski: 'dogru-sifre', yeni: 'yeni-sifre-123' } });
    ok(r.status === 200, 'doğru eski şifreyle değişmeli');
    ok((await cagir(login, { method: 'POST', body: { username: 'yon1', password: 'yeni-sifre-123' } })).status === 200, 'yeni şifreyle giriş');
    ok((await cagir(login, { method: 'POST', body: { username: 'yon1', password: 'dogru-sifre' } })).status === 401, 'eski şifre artık geçmemeli');
    r = await cagir(admin, { method: 'POST', headers: H, body: { action: 'delUnit', id: 'b1' } });
    ok(r.status === 403, 'yönetici birim silememeli');

    console.log('\nSONUÇ: ' + pass + ' geçti, ' + fail + ' düştü.');
    if (fail) process.exit(1);
})();
