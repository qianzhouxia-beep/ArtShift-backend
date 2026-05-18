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

// 健康检查
app.get('/health', (req, res) => {
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