import { Router, Request, Response } from 'express';

const router = Router();

const SB_URL = process.env.SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Direct REST calls to Supabase
async function supabaseFetch(table: string, query?: string, options?: { method?: string; body?: object; patch?: boolean }) {
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
  const data: any = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// Paddle Credit Pack Config（待填写 Price ID）
const PADDLE_PACKS: Record<string, { credits: number; pack: string; price_cents: number }> = {
  // 示例：Price ID 从 Paddle Dashboard 获取
  // 'pri_01hxxxxx': { credits: 10, pack: 'starter', price_cents: 500 },
  // 'pri_01hyyyyy': { credits: 35, pack: 'popular', price_cents: 1500 },
  // 'pri_01hzzzzz': { credits: 80, pack: 'pro', price_cents: 3000 },
};

// GET /api/paddle/health - 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    paddle: 'configured'
  });
});

// POST /api/paddle/webhook - Paddle Webhook Handler
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    
    if (!secret) {
      console.error('[Paddle Webhook] Missing PADDLE_WEBHOOK_SECRET');
      return res.status(400).json({ error: 'Missing webhook secret' });
    }

    // Paddle 签名验证（官方 SDK 方式）
    // 参考：https://developer.paddle.com/webhook/verify-webhook-signature
    const signature = req.headers['paddle-signature'] as string;
    
    if (!signature) {
      console.error('[Paddle Webhook] Missing signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    // TODO: 实现签名验证逻辑
    // Paddle 使用 HMAC-SHA256，与 Lemon Squeezy 类似
    const crypto = await import('crypto');
    
    let rawBytes: string;
    if (Buffer.isBuffer(req.body)) {
      rawBytes = req.body.toString('utf8');
    } else if (typeof req.body === 'object') {
      rawBytes = JSON.stringify(req.body);
    } else {
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
      const existingUser = await supabaseFetch(
        `user_credits?user_id=eq.${encodeURIComponent(userId)}&select=user_id,credits`
      );
      const existing: any[] = existingUser.data as any[];

      if (existing && existing.length > 0) {
        await supabaseFetch(
          `user_credits?user_id=eq.${encodeURIComponent(userId)}`,
          undefined,
          {
            method: 'PATCH',
            body: {
              credits: existing[0].credits + pack.credits,
              updated_at: new Date().toISOString(),
            },
            patch: true,
          }
        );
      } else {
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
        const existingUser = await supabaseFetch(
          `user_credits?user_id=eq.${encodeURIComponent(userId)}&select=user_id,credits`
        );
        const existing: any[] = existingUser.data as any[];

        if (existing && existing.length > 0) {
          await supabaseFetch(
            `user_credits?user_id=eq.${encodeURIComponent(userId)}`,
            undefined,
            {
              method: 'PATCH',
              body: {
                credits: Math.max(0, existing[0].credits - pack.credits),
                updated_at: new Date().toISOString(),
              },
              patch: true,
            }
          );
        }

        await supabaseFetch(
          `orders?id=eq.${encodeURIComponent(transactionId)}`,
          undefined,
          {
            method: 'PATCH',
            body: { status: 'refunded' },
            patch: true,
          }
        );

        console.log(`[Paddle Webhook] 🔄 Refunded ${pack.credits} credits from user ${userId}`);
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('[Paddle Webhook] Error:', error);
    res.status(500).json({ error: 'Webhook processing failed', message: error.message });
  }
});

// GET /api/paddle/credits/:userId - 查询用户 credits
router.get('/credits/:userId', async (req: Request, res: Response) => {
  try {
    const userId: string = req.params.userId as string;

    const result = await supabaseFetch(
      `user_credits?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`
    );
    const data: any[] = result.data as any[];

    if (data && data.length > 0) {
      res.json({ user_id: userId, credits: data[0].credits });
    } else {
      res.json({ user_id: userId, credits: 0 });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get credits', message: error.message });
  }
});

export default router;
