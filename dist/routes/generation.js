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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_js_1 = require("@supabase/supabase-js");
const multer_1 = __importDefault(require("multer"));
const router = (0, express_1.Router)();
// Multer 配置：内存存储，限制 10MB
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});
// 延迟初始化 Supabase
function getSupabase() {
    return (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
// ─── 风格预设 ────────────────────────────────────────────
const STYLE_PRESETS = {
    'oil-painting': 'in the style of an oil painting, thick brushstrokes, rich colors, classical art',
    'pixel-art': 'pixel art style, 8-bit, retro game aesthetic, blocky pixels',
    'anime': 'anime style, Studio Ghibli inspired, cel shading, vibrant colors',
    'cyberpunk': 'cyberpunk style, neon lights, futuristic, dark atmosphere, holographic',
    'pencil-sketch': 'pencil sketch, graphite drawing, cross-hatching, monochrome, detailed lines',
    'watercolor': 'watercolor painting, soft washes, flowing colors, paper texture, delicate',
};
const QUALITY_TIERS = {
    standard: {
        model: 'stable-diffusion-xl-1024-v1-0',
        steps: 25,
        cfgScale: 7,
        resolution: 1024,
        credits: 0,
    },
    premium: {
        model: 'stable-diffusion-xl-1024-v1-0', // 未来可替换为 SD3/Ultra
        steps: 40,
        cfgScale: 8,
        resolution: 1024,
        credits: 1,
    },
};
// ─── GET /api/generation/styles ────────────────────────────
router.get('/styles', (_req, res) => {
    const styles = [
        { id: 'oil-painting', name: 'Oil Painting', desc: 'Van Gogh & Monet' },
        { id: 'pixel-art', name: 'Pixel Art', desc: '8-bit Retro' },
        { id: 'anime', name: 'Anime', desc: 'Studio Ghibli' },
        { id: 'cyberpunk', name: 'Cyberpunk', desc: 'Neon Futurism' },
        { id: 'pencil-sketch', name: 'Pencil Sketch', desc: 'Graphite Drawing' },
        { id: 'watercolor', name: 'Watercolor', desc: 'Soft & Ethereal' },
    ];
    res.json({ styles });
});
// ─── GET /api/generation/quality-tiers ─────────────────────
router.get('/quality-tiers', (_req, res) => {
    const tiers = [
        {
            id: 'standard',
            name: 'Standard',
            desc: 'Fast generation, good quality',
            credits: 0,
            badge: 'FREE',
        },
        {
            id: 'premium',
            name: 'Premium',
            desc: 'More steps, finer details, better coherence',
            credits: 1,
            badge: 'PRO',
        },
    ];
    res.json({ tiers });
});
// ─── POST /api/generation/text-to-image ────────────────────
router.post('/text-to-image', async (req, res) => {
    try {
        const { prompt, negativePrompt, style, quality, userId } = req.body;
        if (!prompt || !style) {
            return res.status(400).json({ error: 'prompt and style are required' });
        }
        const tier = QUALITY_TIERS[quality || 'standard'] || QUALITY_TIERS.standard;
        const enhancedPrompt = `${prompt}, ${STYLE_PRESETS[style] || style}`;
        const response = await fetch(`https://api.stability.ai/v1/generation/${tier.model}/text-to-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
                Accept: 'application/json',
            },
            body: JSON.stringify({
                text_prompts: [
                    { text: enhancedPrompt, weight: 1 },
                    ...(negativePrompt
                        ? [{ text: negativePrompt, weight: -1 }]
                        : []),
                ],
                cfg_scale: tier.cfgScale,
                height: tier.resolution,
                width: tier.resolution,
                steps: tier.steps,
                samples: 1,
            }),
        });
        if (!response.ok) {
            const error = await response.json();
            console.error('Stability AI text2img error:', error);
            return res
                .status(502)
                .json({ error: 'AI generation failed', details: error });
        }
        const result = await response.json();
        const imageUrl = await uploadToStorage(result.artifacts[0].base64, style, userId || null, prompt, negativePrompt || null, style, 'text-to-image');
        res.json({
            success: true,
            imageUrl,
            style,
            quality: quality || 'standard',
            prompt: enhancedPrompt,
        });
    }
    catch (error) {
        console.error('Text-to-image error:', error);
        res
            .status(500)
            .json({ error: 'Generation failed', message: error.message });
    }
});
// ─── POST /api/generation/image-to-image ───────────────────
router.post('/image-to-image', upload.single('image'), async (req, res) => {
    try {
        const { style, quality, userId, prompt, strength } = req.body;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'Image file is required' });
        }
        if (!style) {
            return res.status(400).json({ error: 'style is required' });
        }
        const tier = QUALITY_TIERS[quality || 'standard'] || QUALITY_TIERS.standard;
        const stylePrompt = STYLE_PRESETS[style] || style;
        const enhancedPrompt = prompt
            ? `${prompt}, ${stylePrompt}`
            : stylePrompt;
        const imageStrength = parseFloat(strength) || 0.55; // 0.3-0.7 range for style transfer
        // Stability AI img2img 接口使用 multipart/form-data
        const FormData = (await Promise.resolve().then(() => __importStar(require('form-data')))).default;
        const formData = new FormData();
        formData.append('init_image', file.buffer, {
            filename: 'init_image.png',
            contentType: file.mimetype || 'image/png',
        });
        formData.append('init_image_mode', 'IMAGE_STRENGTH' // 使用 image_strength 参数控制风格强度
        );
        formData.append('image_strength', String(1 - imageStrength)); // API 参数是"保留原图的程度"
        formData.append('text_prompts[0]', enhancedPrompt);
        formData.append('cfg_scale', String(tier.cfgScale));
        formData.append('steps', String(tier.steps));
        formData.append('samples', '1');
        const response = await fetch(`https://api.stability.ai/v1/generation/${tier.model}/image-to-image`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
                Accept: 'application/json',
                ...formData.getHeaders(),
            },
            body: formData,
        });
        if (!response.ok) {
            const error = await response.json();
            console.error('Stability AI img2img error:', error);
            return res
                .status(502)
                .json({ error: 'AI style transfer failed', details: error });
        }
        const result = await response.json();
        const imageUrl = await uploadToStorage(result.artifacts[0].base64, style, userId || null, enhancedPrompt, null, style, 'image-to-image');
        res.json({
            success: true,
            imageUrl,
            style,
            quality: quality || 'standard',
            prompt: enhancedPrompt,
            strength: imageStrength,
        });
    }
    catch (error) {
        console.error('Image-to-image error:', error);
        res
            .status(500)
            .json({ error: 'Style transfer failed', message: error.message });
    }
});
// ─── POST /api/generation/generate（兼容旧端点）──────────
router.post('/generate', async (req, res) => {
    try {
        const { prompt, negativePrompt, style, userId } = req.body;
        if (!prompt || !style) {
            return res.status(400).json({ error: 'prompt and style are required' });
        }
        const enhancedPrompt = `${prompt}, ${STYLE_PRESETS[style] || style}`;
        const response = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
                Accept: 'application/json',
            },
            body: JSON.stringify({
                text_prompts: [
                    { text: enhancedPrompt, weight: 1 },
                    ...(negativePrompt
                        ? [{ text: negativePrompt, weight: -1 }]
                        : []),
                ],
                cfg_scale: 7,
                height: 1024,
                width: 1024,
                steps: 30,
                samples: 1,
            }),
        });
        if (!response.ok) {
            const error = await response.json();
            console.error('Stability AI error:', error);
            return res
                .status(502)
                .json({ error: 'AI generation failed', details: error });
        }
        const result = await response.json();
        const imageUrl = await uploadToStorage(result.artifacts[0].base64, style, userId || null, prompt, negativePrompt || null, style, 'text-to-image');
        res.json({
            success: true,
            imageUrl,
            style,
            prompt: enhancedPrompt,
        });
    }
    catch (error) {
        console.error('Generation error:', error);
        res
            .status(500)
            .json({ error: 'Generation failed', message: error.message });
    }
});
// ─── 上传到 Supabase Storage + 保存记录 ────────────────────
async function uploadToStorage(base64Image, style, userId, prompt, negativePrompt, styleId, mode) {
    const supabase = getSupabase();
    const fileName = `gen_${Date.now()}_${style}.png`;
    const buffer = Buffer.from(base64Image, 'base64');
    const { error: uploadError } = await supabase.storage
        .from('generated-images')
        .upload(fileName, buffer, {
        contentType: 'image/png',
        upsert: false,
    });
    if (uploadError) {
        console.error('Storage upload error:', uploadError);
        throw new Error('Failed to save image');
    }
    const { data: urlData } = supabase.storage
        .from('generated-images')
        .getPublicUrl(fileName);
    const imageUrl = urlData.publicUrl;
    // 保存生成记录
    const { error: dbError } = await supabase.from('generations').insert({
        user_id: userId,
        prompt,
        negative_prompt: negativePrompt,
        style: styleId,
        image_url: imageUrl,
        mode,
    });
    if (dbError) {
        console.error('DB insert error:', dbError);
        // 不抛出错误，图片已生成
    }
    return imageUrl;
}
exports.default = router;
//# sourceMappingURL=generation.js.map