const express = require('express');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// MuleRouter API configuration
const API_KEY = process.env.MULEROUTER_API_KEY || process.env.API_KEY || '';
const BASE_URL = process.env.MULEROUTER_BASE_URL || process.env.BASE_URL || 'https://api.mulerouter.ai';
const API_PATH = '/vendors/google/v1/nano-banana/edit';

// In-memory task store (ephemeral runtime, tasks persist within a single instance)
const tasks = new Map();

// Tencent Cloud COS configuration for persistent usage storage
const COS_BUCKET = process.env.COS_BUCKET || '';
const COS_REGION = process.env.COS_REGION || 'ap-hongkong';
const COS_ENDPOINT = process.env.COS_ENDPOINT || 'https://cos.ap-hongkong.myqcloud.com';
const COS_ACCESS_KEY_ID = process.env.COS_ACCESS_KEY_ID || '';
const COS_SECRET_ACCESS_KEY = process.env.COS_SECRET_ACCESS_KEY || '';
const USAGE_COS_KEY = 'multiview/usage.json';

// Check if COS is configured
const COS_ENABLED = !!(COS_BUCKET && COS_ACCESS_KEY_ID && COS_SECRET_ACCESS_KEY);

// Initialize COS client only if configured
let cosClient = null;
if (COS_ENABLED) {
  cosClient = new S3Client({
    region: COS_REGION,
    endpoint: COS_ENDPOINT,
    credentials: {
      accessKeyId: COS_ACCESS_KEY_ID,
      secretAccessKey: COS_SECRET_ACCESS_KEY
    }
  });
}

// Daily free usage tracking (20 uses per day per user)
const FREE_LIMIT = 20;
let usageData = {}; // { "YYYY-MM-DD": { "userId": count } }
let usageLoaded = false;

// Helper: get today's date in YYYY-MM-DD format
function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

// Load usage data from COS
async function loadUsageFromCOS() {
  if (usageLoaded) return;
  if (!COS_ENABLED) {
    console.log('[COS] Not configured, using in-memory storage');
    usageLoaded = true;
    return;
  }
  try {
    const command = new GetObjectCommand({
      Bucket: COS_BUCKET,
      Key: USAGE_COS_KEY
    });
    const response = await cosClient.send(command);
    const data = await response.Body.transformToString();
    usageData = JSON.parse(data);
    console.log('[COS] Usage data loaded:', Object.keys(usageData).length, 'days');
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.code === 'NoSuchKey') {
      console.log('[COS] No usage data found, starting fresh');
      usageData = {};
    } else {
      console.error('[COS] Failed to load usage data:', err.message);
      usageData = {};
    }
  }
  usageLoaded = true;
}

// Save usage data to COS
async function saveUsageToCOS() {
  if (!COS_ENABLED) return;
  try {
    const command = new PutObjectCommand({
      Bucket: COS_BUCKET,
      Key: USAGE_COS_KEY,
      Body: JSON.stringify(usageData),
      ContentType: 'application/json'
    });
    await cosClient.send(command);
    console.log('[COS] Usage data saved');
  } catch (err) {
    console.error('[COS] Failed to save usage data:', err.message);
  }
}

// Helper: get remaining uses for a user today
function getRemainingUses(userId) {
  const date = getTodayKey();
  const used = usageData[date]?.[userId] || 0;
  return Math.max(0, FREE_LIMIT - used);
}

// Helper: increment usage count
function incrementUsage(userId) {
  const date = getTodayKey();
  if (!usageData[date]) {
    usageData[date] = {};
  }
  const current = usageData[date][userId] || 0;
  usageData[date][userId] = current + 1;
  return current + 1;
}

// Cleanup old usage data (keep only today and yesterday)
function cleanupOldUsage() {
  const today = getTodayKey();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const datesToKeep = new Set([today, yesterday]);
  
  for (const date of Object.keys(usageData)) {
    if (!datesToKeep.has(date)) {
      delete usageData[date];
    }
  }
}

// Run cleanup every hour
setInterval(cleanupOldUsage, 3600000);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Angle descriptions for prompt generation
const ANGLE_PROMPTS = {
  'low': 'low angle shot, looking up at the subject from below, worm\'s eye view, dramatic upward perspective',
  'high': 'high angle shot, looking down at the subject from above, bird\'s eye view, overhead perspective',
  'left': 'left side view, profile view from the left side, lateral perspective',
  'right': 'right side view, profile view from the right side, lateral perspective',
  'dutch': 'dutch angle, tilted camera angle, canted frame, diagonal composition, dynamic tilted perspective',
  'hero': 'hero shot, epic low angle, dramatic upward perspective with wide stance, powerful heroic composition',
  'close-up': 'close-up shot, tight framing, detailed facial features, intimate perspective',
  'full-body': 'full body shot, wide angle, showing entire figure from head to toe, full length portrait'
};

// Size to aspect ratio mapping
const SIZE_TO_ASPECT = {
  '1024x1024': '1:1',
  '1024x1536': '2:3',
  '1536x1024': '3:2',
  '2048x2048': '1:1',
  '2048x1152': '16:9',
  '1152x2048': '9:16'
};

// Helper: extract error message from API response (FIX for [object Object] bug)
function extractErrorMessage(err) {
  if (!err) return '未知錯誤';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    // Common error object patterns from APIs
    return err.detail || err.message || err.title || err.error || err.description || JSON.stringify(err);
  }
  return String(err);
}

// POST /api/generate - Start image generation
app.post('/api/generate', async (req, res) => {
  try {
    // Load usage data from COS on first request
    await loadUsageFromCOS();
    
    const { images, angle, size, prompt, userId } = req.body;

    // Check daily free usage limit
    const effectiveUserId = userId || req.ip || 'anonymous';
    const remaining = getRemainingUses(effectiveUserId);
    if (remaining <= 0) {
      return res.status(429).json({
        error: '今日免費次數已用完（每天20次），明天再來吧',
        remaining: 0,
        limit: FREE_LIMIT
      });
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '請提供至少一張圖片' });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: 'API 金鑰未配置，請聯繫管理員' });
    }

    // Build prompt
    const anglePrompt = ANGLE_PROMPTS[angle] || ANGLE_PROMPTS['low'];
    const fullPrompt = prompt
      ? `${prompt}. ${anglePrompt}. Maintain the same subject, style, colors and details. High quality, detailed.`
      : `Redraw this image from a ${anglePrompt}. Keep the same subject, character, style, colors and all details exactly the same. Only change the camera angle/perspective. High quality, detailed rendering.`;

    const aspectRatio = SIZE_TO_ASPECT[size] || '1:1';

    // Pass images as-is — API accepts full data URIs or HTTP URLs
    const cleanImages = images;

    // Call MuleRouter API to create task
    const apiUrl = `${BASE_URL}${API_PATH}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        images: cleanImages,
        aspect_ratio: aspectRatio
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // FIX: Properly extract error message instead of stringifying object
      const errorMsg = extractErrorMessage(data.error || data.detail || data.message || data);
      console.error('[Generate] API error:', JSON.stringify(data));
      return res.status(response.status).json({ error: errorMsg });
    }

    // Extract task ID from response
    const taskInfo = data.task_info || data;
    const taskId = taskInfo.id || taskInfo.task_id || data.id || data.task_id;

    if (!taskId) {
      console.error('[Generate] No task ID in response:', JSON.stringify(data));
      return res.status(500).json({ error: 'API 未返回任務 ID' });
    }

    // Store task info
    tasks.set(taskId, {
      status: 'pending',
      createdAt: Date.now(),
      imageUrl: null,
      error: null,
      apiPath: API_PATH
    });

    // Increment usage count (only after successful task creation)
    const usedCount = incrementUsage(effectiveUserId);
    const newRemaining = FREE_LIMIT - usedCount;
    
    // Save to COS
    await saveUsageToCOS();

    console.log(`[Generate] Task created: ${taskId} | User: ${effectiveUserId} | Used: ${usedCount}/${FREE_LIMIT} | Remaining: ${newRemaining}`);
    res.json({ taskId, remaining: newRemaining, limit: FREE_LIMIT });

  } catch (err) {
    console.error('[Generate] Error:', err);
    // FIX: Properly extract error message
    const errorMsg = extractErrorMessage(err.message || err);
    res.status(500).json({ error: `生成請求失敗: ${errorMsg}` });
  }
});

// GET /api/usage - Check remaining daily uses for a user
app.get('/api/usage', async (req, res) => {
  try {
    // Load usage data from COS on first request
    await loadUsageFromCOS();
    
    const userId = req.query.userId || req.ip || 'anonymous';
    const date = getTodayKey();
    const used = usageData[date]?.[userId] || 0;
    const remaining = Math.max(0, FREE_LIMIT - used);

    res.json({
      remaining,
      used,
      limit: FREE_LIMIT,
      date
    });
  } catch (err) {
    console.error('[Usage] Error:', err);
    res.status(500).json({ error: '查詢使用次數失敗' });
  }
});

// GET /api/status/:taskId - Poll task status
app.get('/api/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = tasks.get(taskId);

    if (!task) {
      return res.status(404).json({ error: '任務不存在' });
    }

    // If already completed or failed, return cached result
    if (task.status === 'completed') {
      return res.json({ status: 'completed', imageUrl: task.imageUrl });
    }
    if (task.status === 'failed') {
      return res.json({ status: 'failed', error: task.error });
    }

    // Poll MuleRouter API for status
    const apiUrl = `${BASE_URL}${API_PATH}/${taskId}`;
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    if (!response.ok) {
      // For 404, task might not exist yet (just created)
      if (response.status === 404) {
        return res.json({ status: 'pending' });
      }
      const errData = await response.json().catch(() => ({}));
      const errorMsg = extractErrorMessage(errData.error || errData.detail || errData.message || errData);
      console.error(`[Status] API error for task ${taskId}:`, JSON.stringify(errData));
      return res.status(response.status).json({ error: errorMsg });
    }

    const data = await response.json();
    const taskInfo = data.task_info || {};
    const status = taskInfo.status || 'pending';

    // Map API status to our status
    if (status === 'completed' || status === 'succeeded') {
      // Get image URL from response
      const images = data.images || data.results || data.output?.images || [];
      const imageUrl = Array.isArray(images) && images.length > 0 ? images[0] : null;

      if (imageUrl) {
        task.status = 'completed';
        task.imageUrl = imageUrl;
        console.log(`[Status] Task ${taskId} completed: ${imageUrl.substring(0, 80)}...`);
        return res.json({ status: 'completed', imageUrl });
      } else {
        task.status = 'failed';
        task.error = '生成完成但未返回圖片 URL';
        return res.json({ status: 'failed', error: task.error });
      }
    } else if (status === 'failed') {
      // FIX: Properly extract error from task_info.error (which is an object)
      const errorInfo = taskInfo.error || {};
      const errorMsg = extractErrorMessage(errorInfo);
      task.status = 'failed';
      task.error = errorMsg;
      console.error(`[Status] Task ${taskId} failed:`, JSON.stringify(errorInfo));
      return res.json({ status: 'failed', error: errorMsg });
    } else {
      // Still processing
      return res.json({ status: 'processing' });
    }

  } catch (err) {
    console.error('[Status] Error:', err);
    const errorMsg = extractErrorMessage(err.message || err);
    res.status(500).json({ error: `查詢狀態失敗: ${errorMsg}` });
  }
});

// GET /api/download - Proxy download for cross-origin images
app.get('/api/download', async (req, res) => {
  try {
    const { url, name } = req.query;

    if (!url) {
      return res.status(400).json({ error: '缺少 URL 參數' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Fetch the image
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: '下載失敗' });
    }

    // Set headers for download
    const filename = name || 'generated-image.png';
    const contentType = response.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the response
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);

  } catch (err) {
    console.error('[Download] Error:', err);
    res.status(500).json({ error: '下載失敗' });
  }
});

// Clean up old tasks periodically (every 30 minutes)
setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 30 * 60 * 1000; // 30 minutes
  for (const [taskId, task] of tasks.entries()) {
    if (now - task.createdAt > MAX_AGE) {
      tasks.delete(taskId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Perspective Shifter server running on port ${PORT}`);
  console.log(`API: ${BASE_URL}${API_PATH}`);
  console.log(`API Key: ${API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`COS Storage: ${COS_ENABLED ? `${COS_BUCKET} in ${COS_REGION}` : 'NOT CONFIGURED (using in-memory storage)'}`);
});
