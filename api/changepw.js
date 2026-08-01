/* POST /api/changepw — ESKİ anestezi ekranı: giriş yapan kendi şifresini değiştirir */
'use strict';
const core = require('../lib/core');
const { json, ensureStorage } = require('../lib/http');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!(await ensureStorage(res))) return;
    const me = await core.reqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });

    const np = (((req.body || {}).newPass) || '').trim();
    if (np.length < 3) return json(res, 400, { error: 'Şifre en az 3 karakter olmalı' });
    const st = await core.loadState();
    const usr = st.users.find(x => x.u === me.u);
    if (usr) {
        usr.p = np;
        if (!(await core.saveState(st))) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
    }
    return json(res, 200, { ok: true, newPass: np });
};
