"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
// Direct REST calls to Supabase — more reliable than JS client in serverless
async function supabaseFetch(table, body) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
        method: body ? 'POST' : 'GET',
        headers: {
            'apikey': SB_KEY,
            'Authorization': `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
}
// POST /api/waitlist - 加入 Waitlist
router.post('/', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email is required' });
        }
        // 检查是否已存在
        const existingResult = await supabaseFetch(`waitlist?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
        const existing = existingResult.data;
        if (existing && existing.length > 0) {
            return res.json({ success: true, message: 'Already on waitlist', position: null });
        }
        // 插入新记录
        const insertRes = await supabaseFetch('waitlist', { email });
        if (!insertRes.ok) {
            console.error('Waitlist insert error:', insertRes.data);
            return res.status(500).json({ error: 'Failed to join waitlist', detail: insertRes.data });
        }
        // 获取当前排队位置
        const countRes = await supabaseFetch('waitlist?select=*');
        const count = Array.isArray(countRes.data) ? countRes.data.length : 0;
        res.json({
            success: true,
            message: 'Welcome to ArtShift waitlist!',
            position: count || 0,
        });
    }
    catch (error) {
        console.error('Waitlist error:', error);
        return res.status(500).json({ error: 'Failed to join waitlist', message: error.message });
    }
});
// GET /api/waitlist/count - 获取 Waitlist 人数（内部用）
router.get('/count', async (_req, res) => {
    try {
        const r = await supabaseFetch('waitlist?select=id');
        const count = Array.isArray(r.data) ? r.data.length : 0;
        res.json({ count });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get count', message: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=waitlist.js.map