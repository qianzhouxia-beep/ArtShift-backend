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
// Credit pack config: product variant ID → credits
const CREDIT_PACKS = {
    // Starter Pack
    '410a3ac1-432f-4ec2-8f30-06ce699b2caa': { credits: 10, pack: 'starter', price_cents: 500 },
    // Popular Pack
    'f7ee516a-3320-4fbe-bb47-2845a7db9912': { credits: 35, pack: 'popular', price_cents: 1500 },
    // Pro Pack
    'd69356b8-1303-4c91-a39f-2f55cc598b6d': { credits: 80, pack: 'pro', price_cents: 3000 },
};
// GET /api/payments/health - 健康检查
router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// POST /api/payments/webhook - Lemon Squeezy Webhook Handler
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-signature'];
        const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
        // HMAC-SHA256 验签
        if (!signature || !secret) {
            console.error('Missing signature or webhook secret');
            return res.status(400).json({ error: 'Missing signature' });
        }
        const rawBody = JSON.stringify(req.body);
        const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
        const expectedSig = crypto.createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');
        if (signature !== expectedSig) {
            console.error('Webhook signature mismatch');
            return res.status(403).json({ error: 'Invalid signature' });
        }
        const eventName = req.headers['x-event-name'];
        const payload = req.body;
        const data = payload?.data;
        const meta = payload?.meta;
        console.log(`[Webhook] Event: ${eventName}, Order ID: ${data?.id}`);
        // 处理 order_created 事件
        if (eventName === 'order_created') {
            const variantId = data?.attributes?.first_order_item?.variant_id?.toString();
            const orderId = data?.id?.toString();
            const userEmail = data?.attributes?.user_email;
            const status = data?.attributes?.status;
            // 只处理已支付订单
            if (status !== 'paid') {
                console.log(`[Webhook] Order ${orderId} status=${status}, skipping`);
                return res.json({ received: true, reason: `status=${status}` });
            }
            const pack = CREDIT_PACKS[variantId];
            if (!pack) {
                console.log(`[Webhook] Unknown variant ${variantId}, skipping`);
                return res.json({ received: true, reason: 'unknown_variant' });
            }
            // 通过邮箱查找用户（需要用户已注册/登录）
            // 如果用户未登录，credits 记到订单关联的 anonymous_id
            const anonymousId = meta?.custom_data?.user_id || null;
            const userId = anonymousId;
            if (!userId) {
                console.log(`[Webhook] No user_id in custom_data, storing order for later claim`);
                // 存订单信息，用户下次登录时可以通过 order_id 认领
                await supabaseFetch('orders', undefined, {
                    method: 'POST',
                    body: {
                        id: orderId,
                        product_id: variantId,
                        order_type: pack.pack,
                        credits: pack.credits,
                        amount_cents: pack.price_cents,
                        status: 'completed',
                        user_email: userEmail,
                        user_id: null,
                    },
                });
                return res.json({ received: true, claimed: false });
            }
            // 插入或更新 user_credits
            const existingUser = await supabaseFetch(`user_credits?user_id=eq.${encodeURIComponent(userId)}&select=user_id,credits`);
            const existing = existingUser.data;
            if (existing && existing.length > 0) {
                // 累加 credits
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
                // 新建记录
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
                    id: orderId,
                    product_id: variantId,
                    order_type: pack.pack,
                    credits: pack.credits,
                    amount_cents: pack.price_cents,
                    status: 'completed',
                    user_id: userId,
                },
            });
            console.log(`[Webhook] ✅ Added ${pack.credits} credits to user ${userId} for ${pack.pack} pack`);
        }
        // 处理退款
        if (eventName === 'order_refunded') {
            const variantId = data?.attributes?.first_order_item?.variant_id?.toString();
            const orderId = data?.id?.toString();
            const pack = CREDIT_PACKS[variantId];
            const anonymousId = meta?.custom_data?.user_id || null;
            const userId = anonymousId;
            if (pack && userId && typeof userId === 'string') {
                // 查询当前 credits
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
                // 更新订单状态
                await supabaseFetch(`orders?id=eq.${encodeURIComponent(orderId)}`, undefined, {
                    method: 'PATCH',
                    body: { status: 'refunded' },
                    patch: true,
                });
                console.log(`[Webhook] 🔄 Refunded ${pack.credits} credits from user ${userId}`);
            }
        }
        res.json({ received: true });
    }
    catch (error) {
        console.error('[Webhook] Error:', error);
        res.status(500).json({ error: 'Webhook processing failed', message: error.message });
    }
});
// GET /api/payments/credits/:userId - 查询用户 credits
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
//# sourceMappingURL=payments.js.map