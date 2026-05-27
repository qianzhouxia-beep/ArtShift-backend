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

// Credit pack config: product variant ID → credits
const CREDIT_PACKS: Record<string, { credits: number; pack: string; price_cents: number }> = {
  // Starter Pack
  '410a3ac1-432f-4ec2-8f30-06ce699b2caa': { credits: 10, pack: 'starter', price_cents: 500 },
  // Popular Pack
  'f7ee516a-3320-4fbe-bb47-2845a7db9912': { credits: 35, pack: 'popular', price_cents: 1500 },
  // Pro Pack
  'd69356b8-1303-4c91-a39f-2f55cc598b6d': { credits: 80, pack: 'pro', price_cents: 3000 },
};

// GET /api/payments/health - 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /api/payments/webhook - Lemon Squeezy Webhook Handler
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-signature'] as string;
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    // HMAC-SHA256 验签
    if (!signature || !secret) {
      console.error('Missing signature or webhook secret');
      return res.status(400).json({ error: 'Missing signature' });
    }

    const rawBody = JSON.stringify(req.body);
    const crypto = await import('crypto');
    const expectedSig = crypto.createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSig) {
      console.error('Webhook signature mismatch');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const eventName = req.headers['x-event-name'] as string;
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

      const pack = CREDIT_PACKS[variantId as string];
      if (!pack) {
        console.log(`[Webhook] Unknown variant ${variantId}, skipping`);
        return res.json({ received: true, reason: 'unknown_variant' });
      }

      // 通过邮箱查找用户（需要用户已注册/登录）
      // 如果用户未登录，credits 记到订单关联的 anonymous_id
      const anonymousId = meta?.custom_data?.user_id || null;
      const userId = anonymousId as string | null;

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
      const existingUser = await supabaseFetch(
        `user_credits?user_id=eq.${encodeURIComponent(userId as string)}&select=user_id,credits`
      );
      const existing: any[] = existingUser.data as any[];

      if (existing && existing.length > 0) {
        // 累加 credits
        await supabaseFetch(
          `user_credits?user_id=eq.${encodeURIComponent(userId as string)}`,
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
      const pack = CREDIT_PACKS[variantId as string];
      const anonymousId = meta?.custom_data?.user_id || null;
      const userId = anonymousId;

      if (pack && userId && typeof userId === 'string') {
        // 查询当前 credits
        const existingUser = await supabaseFetch(
          `user_credits?user_id=eq.${encodeURIComponent(userId as string)}&select=user_id,credits`
        );
        const existing: any[] = existingUser.data as any[];

        if (existing && existing.length > 0) {
          await supabaseFetch(
            `user_credits?user_id=eq.${encodeURIComponent(userId as string)}`,
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

        // 更新订单状态
        await supabaseFetch(
          `orders?id=eq.${encodeURIComponent(orderId)}`,
          undefined,
          {
            method: 'PATCH',
            body: { status: 'refunded' },
            patch: true,
          }
        );

        console.log(`[Webhook] 🔄 Refunded ${pack.credits} credits from user ${userId}`);
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('[Webhook] Error:', error);
    res.status(500).json({ error: 'Webhook processing failed', message: error.message });
  }
});

// GET /api/payments/credits/:userId - 查询用户 credits
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
