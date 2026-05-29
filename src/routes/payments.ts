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

// Credit pack config: PayPal product ID → credits
// Using custom order_id mapping (user selects pack → we create order with known credits)
const CREDIT_PACKS: Record<string, { credits: number; pack: string; price_usd: number }> = {
  // Starter Pack $5 / 10 credits
  'starter': { credits: 10, pack: 'starter', price_usd: 5 },
  // Popular Pack $15 / 35 credits
  'popular': { credits: 35, pack: 'popular', price_usd: 15 },
  // Pro Pack $30 / 80 credits
  'pro': { credits: 80, pack: 'pro', price_usd: 30 },
};

// POST /api/payments/create-order - Create PayPal order and return approval URL
router.post('/create-order', async (req: Request, res: Response) => {
  try {
    const { packId } = req.body;
    const pack = CREDIT_PACKS[packId];

    if (!pack) {
      return res.status(400).json({ error: 'Invalid pack ID' });
    }

    // Get PayPal access token
    const clientId = process.env.PAYPAL_CLIENT_ID!;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET!;
    const isSandbox = process.env.PAYPAL_MODE === 'sandbox';
    const baseUrl = isSandbox
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';

    // 1. Get access token
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[PayPal] Token error:', tokenRes.status, errText);
      return res.status(500).json({ error: 'Failed to authenticate with PayPal' });
    }

    const tokenData: any = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. Create order
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'PayPal-Request-Id': `artshift-${Date.now()}-${packId}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: packId,
          description: `ArtShift ${pack.pack} - ${pack.credits} AI image credits`,
          amount: {
            currency_code: 'USD',
            value: String(pack.price_usd),
          },
          custom_id: packId,
        }],
        application_context: {
          brand_name: 'ArtShift',//          landing_page: 'NO_PREFERENCE',
          user_action: 'PAY_NOW',
          return_url: `${process.env.FRONTEND_URL || 'https://artshift.api-tokenmaster.com'}/payment/success`,
          cancel_url: `${process.env.FRONTEND_URL || 'https://artshift.api-tokenmaster.com'}/payment/cancel`,
        },
      }),
    });

    if (!orderRes.ok) {
      const errText = await orderRes.text();
      console.error('[PayPal] Order error:', orderRes.status, errText);
      return res.status(500).json({ error: 'Failed to create PayPal order' });
    }

    const orderData: any = await orderRes.json();

    // Find the approval URL from the links
    const approvalLink = orderData.links?.find((l: any) => l.rel === 'approve');

    if (!approvalLink?.href) {
      console.error('[PayPal] No approval link in response:', orderData);
      return res.status(500).json({ error: 'No approval URL returned from PayPal' });
    }

    console.log(`[PayPal] Order created: ${orderData.id} for ${packId} ($${pack.price_usd})`);

    res.json({
      orderId: orderData.id,
      approvalUrl: approvalLink.href,
    });
  } catch (error: any) {
    console.error('[PayPal create-order] Error:', error);
    res.status(500).json({ error: 'Failed to create payment order', message: error.message });
  }
});

// GET /api/payments/debug-env - Debug environment variables (remove in prod)
router.get('/debug-env', (_req: Request, res: Response) => {
  res.json({
    hasClientId: !!process.env.PAYPAL_CLIENT_ID,
    clientIdPrefix: process.env.PAYPAL_CLIENT_ID?.substring(0, 10),
    hasSecret: !!process.env.PAYPAL_CLIENT_SECRET,
    secretPrefix: process.env.PAYPAL_CLIENT_SECRET?.substring(0, 5),
    mode: process.env.PAYPAL_MODE,
    frontendUrl: process.env.FRONTEND_URL,
  });
});

// GET /api/payments/health - 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), provider: 'paypal' });
});

// POST /api/payments/webhook - PayPal Webhook Handler
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // PayPal webhook verification
    const payload = req.body;
    console.log('[PayPal Webhook] Received event:', payload.event_type);

    // Verify PayPal webhook signature (optional but recommended)
    // For MVP, we accept the event and process it

    const eventType = payload.event_type;
    const resource = payload.resource;

    // Handle payment capture completed
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = resource?.id || resource?.supplementary_data?.related_ids?.order_id;
      const amount = parseFloat(resource?.amount?.value || '0');
      const currency = resource?.amount?.currency_code || 'USD';
      const payerEmail = resource?.payer?.email_address;
      const customId = resource?.custom_id; // user_id passed during order creation

      console.log(`[PayPal Webhook] Payment captured: $${amount} ${currency}, Order: ${orderId}`);

      // Match amount to credit pack
      let matchedPack: string | null = null;
      for (const [packId, pack] of Object.entries(CREDIT_PACKS)) {
        if (Math.abs(pack.price_usd - amount) < 0.01) {
          matchedPack = packId;
          break;
        }
      }

      if (!matchedPack) {
        console.log(`[PayPal Webhook] Unknown amount $${amount}, no matching pack`);
        return res.status(200).json({ received: true, reason: 'unknown_amount' });
      }

      const pack = CREDIT_PACKS[matchedPack];
      const userId = customId || null;

      if (!userId) {
        console.log(`[PayPal Webhook] No user_id in custom_id, storing order for later claim`);
        await supabaseFetch('orders', undefined, {
          method: 'POST',
          body: {
            id: orderId,
            product_id: matchedPack,
            order_type: pack.pack,
            credits: pack.credits,
            amount_cents: Math.round(amount * 100),
            status: 'completed',
            user_email: payerEmail,
            user_id: null,
          },
        });
        return res.status(200).json({ received: true, claimed: false });
      }

      // Add credits to user
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

      // Record order
      await supabaseFetch('orders', undefined, {
        method: 'POST',
        body: {
          id: orderId,
          product_id: matchedPack,
          order_type: pack.pack,
          credits: pack.credits,
          amount_cents: Math.round(amount * 100),
          status: 'completed',
          user_id: userId,
        },
      });

      console.log(`[PayPal Webhook] ✅ Added ${pack.credits} credits to user ${userId} for ${pack.pack} pack`);
    }

    // Handle refund
    if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      const orderId = resource?.id || resource?.supplementary_data?.related_ids?.order_id;
      const amount = parseFloat(resource?.amount?.value || '0');
      const customId = resource?.custom_id;

      let matchedPack: string | null = null;
      for (const [packId, pack] of Object.entries(CREDIT_PACKS)) {
        if (Math.abs(pack.price_usd - amount) < 0.01) {
          matchedPack = packId;
          break;
        }
      }

      if (matchedPack && customId) {
        const pack = CREDIT_PACKS[matchedPack];

        const existingUser = await supabaseFetch(
          `user_credits?user_id=eq.${encodeURIComponent(customId)}&select=user_id,credits`
        );
        const existing: any[] = existingUser.data as any[];

        if (existing && existing.length > 0) {
          await supabaseFetch(
            `user_credits?user_id=eq.${encodeURIComponent(customId)}`,
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
          `orders?id=eq.${encodeURIComponent(orderId)}`,
          undefined,
          {
            method: 'PATCH',
            body: { status: 'refunded' },
            patch: true,
          }
        );

        console.log(`[PayPal Webhook] 🔄 Refunded ${pack.credits} credits from user ${customId}`);
      }
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[PayPal Webhook] Error:', error);
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
