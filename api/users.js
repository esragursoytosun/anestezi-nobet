/* GET|POST /api/users — ESKİ anestezi ekranı: kullanıcı listesi (herkes) / yönetim (yalnız yönetici) */
'use strict';
const core = require('../lib/core');
const { json, ensureStorage } = require('../lib/http');

module.exports = async (req, res) => {
    if (!(await ensureStorage(res))) return;
    const me = await core.reqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });

    if (req.method === 'GET') {
        const st = await core.loadState();
        return json(res, 200, {
            users: st.users.map(x => ({ u: x.u, admin: !!x.admin })),
            admin: !!me.admin, me: me.u,
        });
    }

    if (req.method === 'POST') {
        if (!me.admin) return json(res, 403, { error: 'Bu işlem için yönetici olmalısınız' });
        const b = req.body || {};
        const st = await core.loadState();
        const list = st.users;
        if (b.action === 'add') {
            const uu = (b.u || '').trim(), pp = (b.p || '').trim();
            if (!uu || !pp) return json(res, 400, { error: 'Kullanıcı adı ve şifre gerekli' });
            if (list.some(x => x.u === uu)) return json(res, 400, { error: 'Bu kullanıcı adı zaten var' });
            list.push({ u: uu, p: pp, admin: !!b.admin });
        } else if (b.action === 'remove') {
            if (b.u === me.u) return json(res, 400, { error: 'Kendinizi silemezsiniz' });
            const i = list.findIndex(x => x.u === b.u);
            if (i >= 0) list.splice(i, 1);
        } else if (b.action === 'setpass') {
            const usr = list.find(x => x.u === b.u);
            if (usr && b.p) usr.p = b.p;
        } else {
            return json(res, 400, { error: 'bilinmeyen işlem' });
        }
        if (!(await core.saveState(st))) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
        return json(res, 200, { ok: true, users: list.map(x => ({ u: x.u, admin: !!x.admin })) });
    }

    return json(res, 405, { error: 'method' });
};
