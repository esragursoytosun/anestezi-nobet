/* GET|POST /api/asistan/unit?id=... — bir birimin kural profili ve ay yapılandırması */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

module.exports = async (req, res) => {
    if (!(await ensureStorage(res))) return;
    const me = await core.aReqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });

    const id = (req.query && req.query.id) || null;
    if (!core.aCanAccess(me, id)) return json(res, 403, { error: 'Bu birime erişim yetkiniz yok' });

    if (req.method === 'GET') {
        const st = await core.loadAsistan();
        const un = (st.units || []).find(x => x.id === id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        return json(res, 200, { id: un.id, name: un.name, profile: un.profile || null, cfg: un.cfg || null });
    }

    if (req.method === 'POST') {
        const b = req.body || {};
        const st = await core.loadAsistan();
        const un = (st.units || []).find(x => x.id === id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        if (b.profile !== undefined) un.profile = b.profile;
        if (b.cfg !== undefined) un.cfg = b.cfg;
        if (b.name && me.role === 'admin') un.name = b.name;
        st.rev = (st.rev || 0) + 1;
        if (!(await core.saveAsistan(st))) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
        return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'method' });
};
