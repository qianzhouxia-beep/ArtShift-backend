import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/generation/styles - 获取支持的风格列表
router.get('/styles', (_req: Request, res: Response) => {
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

// POST /api/generation/generate - AI 生图
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, negativePrompt, style, userId } = req.body;

    // 参数验证
    if (!prompt || !style) {
      return res.status(400).json({ error: 'prompt and style are required' });
    }

    // 构建风格增强 prompt
    const stylePresets: Record<string, string> = {
      'oil-painting': 'in the style of an oil painting, thick brushstrokes, rich colors, classical art',
      'pixel-art': 'pixel art style, 8-bit, retro game aesthetic, blocky pixels',
      'anime': 'anime style, Studio Ghibli inspired, cel shading, vibrant colors',
      'cyberpunk': 'cyberpunk style, neon lights, futuristic, dark atmosphere, holographic',
      'pencil-sketch': 'pencil sketch, graphite drawing, cross-hatching, monochrome, detailed lines',
      'watercolor': 'watercolor painting, soft washes, flowing colors, paper texture, delicate',
    };

    const enhancedPrompt = `${prompt}, ${stylePresets[style] || style}`;

    // 调用 Stability AI API
    const response = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        text_prompts: [
          { text: enhancedPrompt, weight: 1 },
          ...(negativePrompt ? [{ text: negativePrompt, weight: -1 }] : []),
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
      return res.status(502).json({ error: 'AI generation failed', details: error });
    }

    const result: any = await response.json();
    const base64Image = result.artifacts[0].base64;

    // 上传到 Supabase Storage
    const fileName = `gen_${Date.now()}_${style}.png`;
    const buffer = Buffer.from(base64Image, 'base64');

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-images')
      .upload(fileName, buffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to save image' });
    }

    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from('generated-images')
      .getPublicUrl(fileName);

    const imageUrl = urlData.publicUrl;

    // 保存生成记录到数据库
    const { error: dbError } = await supabase
      .from('generations')
      .insert({
        user_id: userId || null,
        prompt,
        negative_prompt: negativePrompt || null,
        style,
        image_url: imageUrl,
      });

    if (dbError) {
      console.error('DB insert error:', dbError);
      // 不返回错误，图片已生成，记录失败不影响用户
    }

    res.json({
      success: true,
      imageUrl,
      style,
      prompt: enhancedPrompt,
    });

  } catch (error: any) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Generation failed', message: error.message });
  }
});

export default router;