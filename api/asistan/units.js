/* GET /api/asistan/units — erişebildiğin birimlerin listesi (admin: hepsi) */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

module.exports = async (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    if (!(await ensureStorage(res))) return;
    const me = await core.aReqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });
    const st = await core.loadAsistan();
    const mgr = uid => (st.users || []).filter(x => x.role === 'manager' && x.unitId === uid).map(x => x.u);
    let list = (st.units || []).map(un => ({ id: un.id, name: un.name, managers: mgr(un.id) }));
    if (me.role !== 'admin') list = list.filter(un => un.id === me.unitId);
    return json(res, 200, {
        units: list, role: me.role,
        unitId: me.unitId == null ? null : me.unitId, me: me.u,
    });
};
