/* GET|POST /api/state — ESKİ anestezi ekranının ortak durumu (yanıtta şifreler gizlenir) */
'use strict';
const core = require('../lib/core');
const { json, ensureStorage } = require('../lib/http');

module.exports = async (req, res) => {
    if (!(await ensureStorage(res))) return;
    const me = await core.reqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });

    if (req.method === 'GET') {
        const st = await core.loadState();
        return json(res, 200, core.pub(st));
    }

    if (req.method === 'POST') {
        const incoming = req.body || {};
        const cur = await core.loadState();
        const next = Object.assign({}, cur, {
            cfg: incoming.cfg !== undefined ? incoming.cfg : cur.cfg,
            grid: incoming.grid !== undefined ? incoming.grid : cur.grid,
            rev: (cur.rev || 0) + 1,
            savedAt: new Date().toISOString(),
            by: incoming.by || me.u,
        });
        if (!(await core.saveState(next))) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
        return json(res, 200, core.pub(next));
    }

    return json(res, 405, { error: 'method' });
};
