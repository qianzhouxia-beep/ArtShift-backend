"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_js_1 = require("@supabase/supabase-js");
const router = (0, express_1.Router)();
function getSupabase() {
    return (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}
// POST /api/auth/signup - 注册
router.post('/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        // 在 users 表中创建扩展信息
        if (data.user) {
            await supabase.from('users').insert({
                id: data.user.id,
                email: data.user.email,
            });
        }
        res.json({
            success: true,
            user: data.user,
            session: data.session,
        });
    }
    catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Signup failed', message: error.message });
    }
});
// POST /api/auth/login - 登录
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            return res.status(401).json({ error: error.message });
        }
        res.json({
            success: true,
            user: data.user,
            session: data.session,
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', message: error.message });
    }
});
// POST /api/auth/logout - 登出
router.post('/logout', async (_req, res) => {
    try {
        const supabase = getSupabase();
        const { error } = await supabase.auth.signOut();
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: 'Logout failed', message: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map