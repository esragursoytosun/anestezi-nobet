/* POST /api/asistan/login — kullanıcı adı + şifre → imzalı oturum token'ı */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!(await ensureStorage(res))) return;
    const b = req.body || {};
    const st = await core.loadAsistan();
    const pass = b.password || '';
    const usr = core.aFindUser(st, (b.username || '').trim(), pass);
    if (!usr) return json(res, 401, { ok: false, error: 'Kullanıcı adı veya şifre hatalı' });
    // Eski düz-metin şifreyi ilk girişte hash'e yükselt.
    if (usr.role !== 'admin' && usr.p !== undefined && !usr.pw) {
        usr.pw = core.hashPw(pass); delete usr.p; await core.saveAsistan(st);
    }
    const token = core.makeToken(usr.u, usr.role, usr.unitId == null ? null : usr.unitId);
    return json(res, 200, {
        ok: true, username: usr.u, role: usr.role,
        unitId: usr.unitId == null ? null : usr.unitId, token: token,
    });
};
