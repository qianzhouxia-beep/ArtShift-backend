import dotenv from 'dotenv';
dotenv.config(); // 必须在任何 import 之前加载环境变量

import express from 'express';
import cors from 'cors';

import generationRoutes from './routes/generation';
import waitlistRoutes from './routes/waitlist';
import authRoutes from './routes/auth';

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://artshift.api-tokenmaster.com',
  credentials: true
}));
app.use(express.json());

// 路由
app.use('/api/generation', generationRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/auth', authRoutes);

// 调试接口 - 查看运行时环境变量状态
app.get('/api/debug', (_req, res) => {
  const mask = (s: string | undefined) => s ? `${s.slice(0, 8)}...${s.slice(-6)}` : 'NOT SET';
  res.json({
    SUPABASE_URL: mask(process.env.SUPABASE_URL),
    SUPABASE_ANON_KEY: mask(process.env.SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: mask(process.env.SUPABASE_SERVICE_ROLE_KEY),
    PORT: process.env.PORT || 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'NOT SET',
  });
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 错误处理
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 ArtShift Backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});

export default app;