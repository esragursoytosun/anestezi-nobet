/* POST /api/login — ESKİ anestezi ekranının girişi (asistan /api/asistan/login kullanır) */
'use strict';
const core = require('../lib/core');
const { json, ensureStorage } = require('../lib/http');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!(await ensureStorage(res))) return;
    const b = req.body || {};
    const st = await core.loadState();
    const usr = core.findUser(st, (b.username || '').trim(), b.password || '');
    if (usr) return json(res, 200, { ok: true, username: usr.u, admin: !!usr.admin });
    return json(res, 401, { ok: false, error: 'Kullanıcı adı veya şifre hatalı' });
};
