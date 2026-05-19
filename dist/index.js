"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config(); // 必须在任何 import 之前加载环境变量
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const generation_1 = __importDefault(require("./routes/generation"));
const waitlist_1 = __importDefault(require("./routes/waitlist"));
const auth_1 = __importDefault(require("./routes/auth"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8080;
// 中间件
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'https://artshift.api-tokenmaster.com',
    credentials: true
}));
app.use(express_1.default.json());
// 路由
app.use('/api/generation', generation_1.default);
app.use('/api/waitlist', waitlist_1.default);
app.use('/api/auth', auth_1.default);
// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// 错误处理
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});
// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 ArtShift Backend running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
exports.default = app;
//# sourceMappingURL=index.js.map