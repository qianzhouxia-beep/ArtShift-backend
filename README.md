# ArtShift Backend

ArtShift MVP 后端服务 - Express + TypeScript + Prisma + Supabase

## 快速开始

### 1. 环境准备

**你需要获取以下凭证：**

1. **Supabase 项目**
   - 访问 https://supabase.com 创建项目
   - 获取：
     - `DATABASE_URL`：Settings → Database → Connection string (URI)
     - `SUPABASE_URL`：项目 URL (https://xxx.supabase.co)
     - `SUPABASE_ANON_KEY`：Settings → API → anon public key
     - `SUPABASE_SERVICE_ROLE_KEY`：Settings → API → service_role key

2. **Stability AI API Key**
   - 访问 https://platform.stability.ai 获取 API Key
   - 新用户有免费额度 ($10)

### 2. 配置环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

填入你的凭证：

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.xxx.supabase.co:5432/postgres
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STABILITY_API_KEY=your-stability-api-key
```

### 3. 初始化数据库

```bash
npm run db:push
```

这会根据 `prisma/schema.prisma` 创建表结构。

### 4. 创建 Storage Bucket

在 Supabase Dashboard：
1. 进入 Storage
2. 创建名为 `generated-images` 的 bucket
3. 设置为 Public bucket

### 5. 启动开发服务器

```bash
npm run dev
```

服务器运行在 http://localhost:8080

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/generation/styles` | GET | 获取支持的风格列表 |
| `/api/generation/generate` | POST | AI 生图 |
| `/api/waitlist` | POST | 加入 Waitlist |
| `/api/waitlist/count` | GET | Waitlist 人数 |
| `/api/auth/signup` | POST | 注册 |
| `/api/auth/login` | POST | 登录 |
| `/api/auth/logout` | POST | 登出 |

### 示例请求

**AI 生图：**
```bash
curl -X POST http://localhost:8080/api/generation/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A cat sitting on a tree","style":"anime"}'
```

**加入 Waitlist：**
```bash
curl -X POST http://localhost:8080/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

## 部署到 Zeabur

1. 推送到 GitHub：
   ```bash
   git init
   git add .
   git commit -m "Initial backend setup"
   git remote add origin https://github.com/qianzhouxia-beep/ArtShift-backend.git
   git push -u origin main
   ```

2. 在 Zeabur 创建新服务，选择该仓库

3. 配置环境变量（填入 .env 内容）

4. 设置：
   - Root Directory: `/`
   - Build Command: `npm install && npm run build && npx prisma generate`
   - Start Command: `npm start`

5. 绑定域名（如 `api.artshift.api-tokenmaster.com`）

## 项目结构

```
ArtShift-backend/
├── prisma/
│   └── schema.prisma    # 数据库模型
├── src/
│   ├── index.ts         # 主入口
│   ├── routes/
│   │   ├── generation.ts # AI 生图路由
│   │   ├── waitlist.ts   # Waitlist 路由
│   │   └── auth.ts       # 认证路由
│   └── middleware/      # 中间件（预留）
├── .env.example         # 环境变量模板
├── package.json
└── tsconfig.json
```

## 下一步

1. ✅ 后端脚手架已搭建
2. ⏳ 配置 Supabase + Stability AI
3. ⏳ 本地测试 API
4. ⏳ 前端对接 API
5. ⏳ 部署上线