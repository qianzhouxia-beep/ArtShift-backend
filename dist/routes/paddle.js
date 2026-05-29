"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Direct REST calls to Supabase
async function supabaseFetch(table, query, options) {
    const url = query ? `${SB_URL}/rest/v1/${table}?${query}` : `${SB_URL}/rest/v1/${table}`;
    const res = await fetch(url, {
        method: options?.patch ? 'PATCH' : (options?.body ? 'POST' : 'GET'),
        headers: {
            'apikey': SB_KEY,
            'Authorization': `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': options?.patch ? 'return=representation' : 'return=representation',
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
}
// Paddle Credit Pack Config（待填写 Price ID）
const PADDLE_PACKS = {
// 示例：Price ID 从 Paddle Dashboard 获取
// 'pri_01hxxxxx': { credits: 10, pack: 'starter', price_cents: 500 },
// 'pri_01hyyyyy': { credits: 35, pack: 'popular', price_cents: 1500 },
// 'pri_01hzzzzz': { credits: 80, pack: 'pro', price_cents: 3000 },
};
// GET /api/paddle/health - 健康检查
router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        paddle: 'configured'
    });
});
// POST /api/paddle/webhook - Paddle Webhook Handler
router.post('/webhook', async (req, res) => {
    try {
        const secret = process.env.PADDLE_WEBHOOK_SECRET;
        if (!secret) {
            console.error('[Paddle Webhook] Missing PADDLE_WEBHOOK_SECRET');
            return res.status(400).json({ error: 'Missing webhook secret' });
        }
        // Paddle 签名验证（官方 SDK 方式）
        // 参考：https://developer.paddle.com/webhook/verify-webhook-signature
        const signature = req.headers['paddle-signature'];
        if (!signature) {
            console.error('[Paddle Webhook] Missing signature header');
            return res.status(400).json({ error: 'Missing signature' });
        }
        // TODO: 实现签名验证逻辑
        // Paddle 使用 HMAC-SHA256，与 Lemon Squeezy 类似
        const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
        let rawBytes;
        if (Buffer.isBuffer(req.body)) {
            rawBytes = req.body.toString('utf8');
        }
        else if (typeof req.body === 'object') {
            rawBytes = JSON.stringify(req.body);
        }
        else {
            return res.status(400).json({ error: 'Invalid body type' });
        }
        const expectedSig = crypto.createHmac('sha256', secret)
            .update(rawBytes, 'utf8')
            .digest('hex');
        if (signature !== expectedSig) {
            console.error(`[Paddle Webhook] Signature mismatch`);
            return res.status(403).json({ error: 'Invalid signature' });
        }
        // 解析 Paddle Event
        const payload = req.body;
        const eventType = payload?.event_type;
        const eventData = payload?.data;
        console.log(`[Paddle Webhook] Event: ${eventType}`);
        // 处理 transaction.completed（支付成功）
        if (eventType === 'transaction.completed') {
            const transactionId = eventData?.id;
            const status = eventData?.status;
            const customData = eventData?.custom_data || {};
            const userId = customData.user_id;
            const priceId = eventData?.items?.[0]?.price?.id;
            if (status !== 'completed') {
                console.log(`[Paddle Webhook] Transaction ${transactionId} status=${status}, skipping`);
                return res.json({ received: true, reason: `status=${status}` });
            }
            const pack = PADDLE_PACKS[priceId];
            if (!pack) {
                console.log(`[Paddle Webhook] Unknown price ${priceId}, skipping`);
                return res.json({ received: true, reason: 'unknown_price' });
            }
            // 查找或创建用户 credits
            if (!userId) {
                console.log(`[Paddle Webhook] No user_id, storing order for later claim`);
                await supabaseFetch('orders', undefined, {
                    method: 'POST',
                    body: {
                        id: transactionId,
                        product_id: priceId,
                        order_type: pack.pack,
                        credits: pack.credits,
                        amount_cents: pack.price_cents,
                        status: 'completed',
                        user_id: null,
                    },
                });
                return res.json({ received: true, claimed: false });
            }
            // 累加 credits
            const existingUser = await supabaseFetch(`user_credits?user_id=eq.${encodeURIComponent(userId)}&select=user_id,credits`);
            const existing = existingUser.data;
            if (existing && existing.length > 0) {
                await supabaseFetch(`user_credits?user_id=eq.${encodeURIComponent(userId)}`, undefined, {
                    method: 'PATCH',
                    body: {
                        credits: existing[0].credits + pack.credits,
                        updated_at: new Date().toISOString(),
                    },
                    patch: true,
                });
            }
            else {
                await supabaseFetch('user_credits', undefined, {
                    method: 'POST',
                    body: {
                        user_id: userId,
                        credits: pack.credits,
                    },
                });
            }
            // 记录订单
            await supabaseFetch('orders', undefined, {
                method: 'POST',
                body: {
                    id: transactionId,
                    product_id: priceId,
                    order_type: pack.pack,
                    credits: pack.credits,
                    amount_cents: pack.price_cents,
                    status: 'completed',
                    user_id: userId,
                },
            });
            console.log(`[Paddle Webhook] ✅ Added ${pack.credits} credits to user ${userId}`);
        }
        // 处理 transaction.refunded
        if (eventType === 'transaction.refunded') {
            const transactionId = eventData?.id;
            const customData = eventData?.custom_data || {};
            const userId = customData.user_id;
            const priceId = eventData?.items?.[0]?.price?.id;
            const pack = PADDLE_PACKS[priceId];
            if (pack && userId) {
                const existingUser = await supabaseFetch(`user_credits?user_id=eq.${encodeURIComponent(userId)}&select=user_id,credits`);
                const existing = existingUser.data;
                if (existing && existing.length > 0) {
                    await supabaseFetch(`user_credits?user_id=eq.${encodeURIComponent(userId)}`, undefined, {
                        method: 'PATCH',
                        body: {
                            credits: Math.max(0, existing[0].credits - pack.credits),
                            updated_at: new Date().toISOString(),
                        },
                        patch: true,
                    });
                }
                await supabaseFetch(`orders?id=eq.${encodeURIComponent(transactionId)}`, undefined, {
                    method: 'PATCH',
                    body: { status: 'refunded' },
                    patch: true,
                });
                console.log(`[Paddle Webhook] 🔄 Refunded ${pack.credits} credits from user ${userId}`);
            }
        }
        res.json({ received: true });
    }
    catch (error) {
        console.error('[Paddle Webhook] Error:', error);
        res.status(500).json({ error: 'Webhook processing failed', message: error.message });
    }
});
// GET /api/paddle/credits/:userId - 查询用户 credits
router.get('/credits/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const result = await supabaseFetch(`user_credits?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
        const data = result.data;
        if (data && data.length > 0) {
            res.json({ user_id: userId, credits: data[0].credits });
        }
        else {
            res.json({ user_id: userId, credits: 0 });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get credits', message: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=paddle.js.map