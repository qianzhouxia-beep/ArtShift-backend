-- ArtShift MVP - Database Schema (Supabase SQL Editor)
-- 复制全部内容到 https://supabase.com/dashboard/project/oheyqzqnkhpmmkrxavni/sql 执行

-- 1. Users 表（Supabase Auth 自动创建 auth.users，这里存扩展信息）
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Waitlist 表
CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  notified BOOLEAN DEFAULT false
);

-- 3. Generations 表（AI 生成记录）
CREATE TABLE IF NOT EXISTS public.generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  style TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Products 表
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_price REAL NOT NULL,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Orders 表（Phase 2 预留）
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  generation_id UUID,
  quantity INTEGER DEFAULT 1,
  total_price REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. 启用 RLS（Row Level Security）
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- 7. RLS 策略：Service Role 可以读写所有数据（后端用 service_role key）
CREATE POLICY "Service role full access" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.waitlist FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.generations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.orders FOR ALL USING (true) WITH CHECK (true);

-- 8. Waitlist 公开读取（前端可能需要显示人数）
CREATE POLICY "Public read waitlist count" ON public.waitlist FOR SELECT USING (true);

-- 9. 插入一些示例产品
INSERT INTO public.products (name, type, base_price, description) VALUES
  ('Classic T-Shirt', 'tshirt', 24.99, 'Premium cotton tee, perfect for AI art'),
  ('Coffee Mug', 'mug', 14.99, '11oz ceramic mug, dishwasher safe'),
  ('Art Print', 'poster', 19.99, 'High-quality matte print, multiple sizes'),
  ('Phone Case', 'phone-case', 29.99, 'Tough case for iPhone & Android')
ON CONFLICT DO NOTHING;

-- 10. 创建 Storage Bucket（通过 SQL 无法创建，需在 Dashboard 操作）
-- 请去 Storage 页面手动创建名为 "generated-images" 的 bucket，设置为 Public