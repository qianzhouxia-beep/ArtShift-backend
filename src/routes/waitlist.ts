import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/waitlist - 加入 Waitlist
router.post('/', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const supabase = getSupabase();

    // 检查是否已存在
    const { data: existing } = await supabase
      .from('waitlist')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.json({ success: true, message: 'Already on waitlist', position: null });
    }

    // 插入新记录
    const { error } = await supabase
      .from('waitlist')
      .insert({ email });

    if (error) {
      console.error('Waitlist insert error:', error);
      return res.status(500).json({ error: 'Failed to join waitlist' });
    }

    // 获取当前排队位置
    const { count } = await supabase
      .from('waitlist')
      .select('*', { count: 'exact', head: true });

    res.json({
      success: true,
      message: 'Welcome to ArtShift waitlist!',
      position: count || 0,
    });

  } catch (error: any) {
    console.error('Waitlist error:', error);
    res.status(500).json({ error: 'Failed to join waitlist', message: error.message });
  }
});

// GET /api/waitlist/count - 获取 Waitlist 人数（内部用）
router.get('/count', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabase();

    const { count } = await supabase
      .from('waitlist')
      .select('*', { count: 'exact', head: true });

    res.json({ count: count || 0 });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get count', message: error.message });
  }
});

export default router;