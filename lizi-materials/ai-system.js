 
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { AlipaySdk, AlipayFormData } = require('alipay-sdk');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// AI模型定价（成本价，单位：人民币元）- zhizengzeng.com
// USD/CNY ≈ 7.25, 售价 = 成本 × 1.10
// 豆包模型已为人币定价，无需转换
const MODEL_PRICING = {
  // === OpenAI Images API 文生图/图生图 ===
  'dall-e-2': { '1024-1024': 0.145, '512-512': 0.131, '256-256': 0.116 },
  'dall-e-3': {
    'standard-1024': 0.290, 'standard-1792': 0.580,
    'hd-1024': 0.580, 'hd-1792': 0.870
  },
  'gpt-image-2': 1.00,
  'gpt-image-1.5': { 'low-1K': 0.080, 'low-2K': 0.116, 'medium-1K': 0.305, 'medium-2K': 0.457, 'high-1K': 1.211, 'high-2K': 1.813 },
  'chatgpt-image-latest': 1.00,
  'gpt-image-1': { 'low-1K': 0.080, 'low-2K': 0.116, 'medium-1K': 0.305, 'medium-2K': 0.457, 'high-1K': 1.211, 'high-2K': 1.813 },
  'gpt-image-1-mini': { 'low-1K': 0.036, 'low-2K': 0.044, 'medium-1K': 0.080, 'medium-2K': 0.109 },
  // === Google Gemini 对话式图像生成 ===
  'gemini-3.1-flash-image': 0.283,
  'gemini-3-pro-image': 0.283,
  'gemini-2.5-flash-image': 0.283,
  // === Google Imagen 专用图像生成 ===
  'imagen-4.0-generate-001': 0.290,
  'imagen-4.0-ultra-generate-001': 0.435,
  'imagen-4.0-fast-generate-001': 0.145,
  'imagen-4.0-generate-preview-06-06': 0.218,
  'imagen-4.0-ultra-generate-preview-06-06': 0.218,
  'imagen-3.0-generate-002': 0.218,
  // === xAI Grok 图像生成 ===
  'grok-imagine-image-pro': 0.508,
  'grok-imagine-image': 0.145,
  // === 字节豆包 Seedream / SeedEdit 文生图/图生图 (已为人民币) ===
  // [UNAVAILABLE] 'doubao-seedream-5-0-lite-250612': 0.22,
  // [UNAVAILABLE] 'doubao-seedream-5-0-250612': 0.22,
  'doubao-seedream-4-5-251128': 0.25,
  'doubao-seedream-4-0-250828': 0.20,
  'doubao-seededit-3-0-i2i-250628': 0.30,
  // [UNAVAILABLE] 'doubao-seedream-3-0-t2i-250415': 0.259,
  // === 视频生成模型 ===
  // Sora 2
  'sora-2': { '720p-4s': 2.90, '720p-8s': 5.80, '720p-12s': 8.70 },
  'sora-2-pro': {
    '720p-4s': 8.70, '720p-8s': 17.40, '720p-12s': 26.10,
    '1024p-4s': 14.50, '1024p-8s': 29.00, '1024p-12s': 43.50,
    '1080p-4s': 20.30, '1080p-8s': 40.60, '1080p-12s': 60.90
  },
  // Seedance 视频 (双价格)
  'seedance-2-0': {
    dualPrice: true,
    minRate: 28.84,
    maxRate: 47.38,
    tokensPerSecond: 37400,
    tiers: {
      '4s':  { minCost: 4.31, maxCost: 7.09 },
      '5s':  { minCost: 5.39, maxCost: 8.86 },
      '8s':  { minCost: 8.62, maxCost: 14.17 },
      '10s': { minCost: 10.78, maxCost: 17.71 },
      '15s': { minCost: 16.17, maxCost: 26.57 }
    }
  },
  'seedance-2-0-fast': {
    dualPrice: true,
    minRate: 22.66,
    maxRate: 38.11,
    tokensPerSecond: 37400,
    tiers: {
      '4s':  { minCost: 3.39, maxCost: 5.69 },
      '5s':  { minCost: 4.23, maxCost: 7.11 },
      '8s':  { minCost: 6.78, maxCost: 11.39 },
      '10s': { minCost: 8.47, maxCost: 14.25 },
      '15s': { minCost: 12.71, maxCost: 21.38 }
    }
  },
  'kling-v1-5': {
    dualPrice: true,
    tiers: {
      '5s':  { minCost: 6.50, maxCost: 6.50 },
      '10s': { minCost: 12.00, maxCost: 12.00 }
    }
  },
  'minimax-m2-5': {
    dualPrice: true,
    tiers: {
      '5s':  { minCost: 5.80, maxCost: 5.80 },
      '10s': { minCost: 10.50, maxCost: 10.50 }
    }
  },
};


// 根据模型+品质+分辨率获取成本价
function getModelCost(model, quality, resolution) {
  const pricing = MODEL_PRICING[model];
  // 处理双价格模型 (Seedance)
  if (pricing && pricing.dualPrice) {
    const duration = (quality || resolution || '5s').toLowerCase();
    const tier = pricing.tiers[duration];
    if (tier) return tier.maxCost; // 返回最高价作为预扣价
    return pricing.tiers[Object.keys(pricing.tiers)[0]].maxCost;
  }
  if (typeof pricing === 'number') return pricing;
  if (typeof pricing === 'object' && pricing !== null) {
    const q = (quality || 'medium').toLowerCase().replace('auto', 'medium');
    const r = resolution || '1K';
    const key = `${q}-${r}`;
    if (pricing[key] !== undefined) return pricing[key];
    // 回退：取第一个可用价格
    const firstKey = Object.keys(pricing)[0];
    return pricing[firstKey] || 0;
  }
  return 0;
}

// 根据模型类型获取加价率（所有模型统一10%利润）
function getMarkupRate(model) {
  return 1.10;
}

// 判断模型是否允许使用免费次数（视频模型不允许，售价>¥0.30不允许）
function isFreeEligible(model) {
  if (!model) return true;
  if (model.startsWith('sora-2')) return false;
  if (model.startsWith('seedance')) return false;
  if (model.startsWith('kling')) return false;
  if (model.startsWith('minimax')) return false;
  // 获取模型成本价（取最低档）
  const pricing = MODEL_PRICING[model];
  if (!pricing) return true; // 免费模型或未知
  let cost = 0;
  if (typeof pricing === 'number') {
    cost = pricing;
  } else if (typeof pricing === 'object' && pricing !== null && !pricing.dualPrice) {
    // 取最低档价格
    const values = Object.values(pricing).filter(v => typeof v === 'number');
    cost = values.length > 0 ? Math.min(...values) : 0;
  }
  // 统一10%利润
  const sellPrice = cost * 1.10;
  return sellPrice <= 0.30;
}

// 每日免费次数：每天重置为1次
const DAILY_FREE_LIMIT = 3;

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// 检查并重置每日免费次数
function ensureDailyFreeReset(db, userId) {
  const today = getTodayKey();
  const user = db.prepare('SELECT free_credits, last_free_reset FROM ai_users WHERE id = ?').get(userId);
  if (!user) return 0;
  if (user.last_free_reset !== today) {
    db.prepare('UPDATE ai_users SET free_credits = ?, last_free_reset = ? WHERE id = ?')
      .run(DAILY_FREE_LIMIT, today, userId);
    return DAILY_FREE_LIMIT;
  }
  return user.free_credits;
}

// 售价（成本价 + 加价利润）
function getSellPrice(model, quality, resolution) {
  const cost = getModelCost(model, quality, resolution);
  const markup = getMarkupRate(model);
  return Math.ceil(cost * markup * 100) / 100;
}

// 获取模型的所有价格档位（用于前端展示）
function getModelPriceTiers(model) {
  const pricing = MODEL_PRICING[model];
  const markup = 1.10; // 统一10%利润
  
  // 双价格模型 (Seedance, Kling, Minimax)
  if (pricing && pricing.dualPrice) {
    const tiers = {};
    for (const [key, tier] of Object.entries(pricing.tiers)) {
      tiers[key] = { 
        minCost: tier.minCost, 
        maxCost: tier.maxCost, 
        minPrice: Math.ceil(tier.minCost * markup * 100) / 100, 
        maxPrice: Math.ceil(tier.maxCost * markup * 100) / 100 
      };
    }
    const allMin = Object.values(pricing.tiers).map(t => t.minCost);
    const allMax = Object.values(pricing.tiers).map(t => t.maxCost);
    return {
      tiers,
      minPrice: Math.ceil(Math.min(...allMin) * markup * 100) / 100,
      maxPrice: Math.ceil(Math.max(...allMax) * markup * 100) / 100,
      dualPrice: true,
      free: false
    };
  }
  if (typeof pricing === 'number') {
    return { price: Math.ceil(pricing * markup * 100) / 100, cost: pricing, free: pricing === 0 };
  }
  if (typeof pricing === 'object' && pricing !== null) {
    const tiers = {};
    for (const [key, cost] of Object.entries(pricing)) {
      tiers[key] = { cost, price: Math.ceil(cost * markup * 100) / 100 };
    }
    const prices = Object.values(pricing);
    return { tiers, minPrice: Math.ceil(Math.min(...prices) * markup * 100) / 100, maxPrice: Math.ceil(Math.max(...prices) * markup * 100) / 100, free: false };
  }
  return { price: 0, free: true };
}

// JWT密钥（从环境变量读取）
const JWT_SECRET = process.env.JWT_SECRET || 'chestnut-ai-secret-2024';

// 初始化数据库表
function initTables(db) {
  // AI用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 0,
      free_credits INTEGER DEFAULT 3,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // AI交易记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL, -- recharge, generate, free
      amount REAL,
      model TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ai_users(id)
    )
  `);

  // AI支付订单表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_no TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending', -- pending, paid, failed
      alipay_trade_no TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES ai_users(id)
    )
  `);

  // Add device_id column to existing databases
  try { db.exec('ALTER TABLE ai_users ADD COLUMN device_id TEXT'); } catch(e) {}

  // Add last_free_reset column for daily free credit reset
  try { db.exec('ALTER TABLE ai_users ADD COLUMN last_free_reset TEXT DEFAULT ""'); } catch(e) {}

  // AI生成记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      image_url TEXT,
      cost REAL,
      is_free INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ai_users(id)
    )
  `);
}

// JWT中间件
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期' });
  }
}

// 主站管理员自动登录
router.post('/admin-auto-login', async (req, res) => {
  try {
    const siteToken = req.headers['x-auth-token'];
    if (!siteToken) return res.status(401).json({ error: '未提供主站凭证' });

    const db = req.app.locals.db;
    const session = db.prepare('SELECT username FROM sessions WHERE token = ?').get(siteToken);
    if (!session) return res.status(401).json({ error: '主站登录已过期' });

    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(session.username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: '非管理员' });

    // Find admin AI user (is_admin=1)
    const aiUser = db.prepare('SELECT * FROM ai_users WHERE is_admin = 1 LIMIT 1').get();
    if (!aiUser) return res.status(404).json({ error: '未找到管理员AI账号' });

    const token = jwt.sign({ userId: aiUser.id }, JWT_SECRET, { expiresIn: '30d' });
    const freeCredits = ensureDailyFreeReset(db, aiUser.id);

    res.json({
      success: true,
      token,
      user: {
        id: aiUser.id,
        phone: aiUser.phone,
        balance: aiUser.balance,
        freeCredits: freeCredits,
        isAdmin: 1
      }
    });
  } catch (err) {
    console.error('Admin auto-login error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 注册
router.post('/register', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码不能为空' });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }
    if (!/[a-z]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含小写字母' });
    }
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含大写字母' });
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含特殊符号' });
    }

    const deviceId = req.body.deviceId;
    if (!deviceId) {
      return res.status(400).json({ error: '设备标识无效' });
    }

    const db = req.app.locals.db;
    const existing = db.prepare('SELECT id FROM ai_users WHERE phone = ?').get(phone);
    if (existing) {
      return res.status(400).json({ error: '该手机号已注册' });
    }

    // Check if device already has an account
    const existingDevice = db.prepare('SELECT id FROM ai_users WHERE device_id = ?').get(deviceId);
    if (existingDevice) {
      return res.status(400).json({ error: '每台设备仅允许注册一个账号' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const today = getTodayKey();
    const result = db.prepare(
      'INSERT INTO ai_users (phone, password, balance, free_credits, device_id, last_free_reset) VALUES (?, ?, 0, ?, ?, ?)'
    ).run(phone, hashedPassword, DAILY_FREE_LIMIT, deviceId, today);

    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      token,
      user: {
        id: result.lastInsertRowid,
        phone,
        balance: 0,
        freeCredits: DAILY_FREE_LIMIT,
        isAdmin: 0
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码不能为空' });
    }

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE phone = ?').get(phone);
    if (!user) {
      return res.status(400).json({ error: '用户不存在' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: '密码错误' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    // Reset daily free credits
    const freeCredits = ensureDailyFreeReset(req.app.locals.db, user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        balance: user.balance,
        freeCredits: freeCredits,
        isAdmin: user.is_admin || 0
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// 获取用户信息
router.get('/user/info', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const freeCredits = ensureDailyFreeReset(db, req.userId);
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      id: user.id,
      phone: user.phone,
      balance: user.balance,
      freeCredits: freeCredits,
      isAdmin: user.is_admin || 0
    });
  } catch (err) {
    console.error('Get user info error:', err);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// 修改密码
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请填写完整' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 验证旧密码
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
      return res.status(400).json({ error: '旧密码错误' });
    }

    // 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE ai_users SET password = ? WHERE id = ?').run(hashedPassword, req.userId);

    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: '修改密码失败' });
  }
});

// 获取模型价格列表
router.get('/pricing', (req, res) => {
  const pricing = {};
  for (const model of Object.keys(MODEL_PRICING)) {
    const tiers = getModelPriceTiers(model);
    pricing[model] = tiers;
  }
  res.json(pricing);
});

// 创建支付宝充值订单
router.post('/payment/create', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 1) {
      return res.status(400).json({ error: '充值金额至少1元' });
    }
    if (amount > 50) {
      return res.status(400).json({ error: '单笔充值最高¥50' });
    }

    const db = req.app.locals.db;

    // 全站每日收款限额检查（全站每天最多收款¥1000）
    const today = new Date().toISOString().slice(0, 10);
    const todayTotal = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM ai_payments
       WHERE status = 'paid'
         AND DATE(paid_at) = ?`
    ).get(today);

    if ((todayTotal?.total || 0) + amount > 1000) {
      const remaining = Math.max(0, 1000 - (todayTotal?.total || 0));
      return res.status(400).json({ error: `今日全站充值限额已达（每日¥1000），剩余可充¥${remaining.toFixed(2)}` });
    }

    const orderNo = 'AI' + Date.now() + Math.random().toString(36).substr(2, 6);

    // 创建订单记录
    db.prepare(
      'INSERT INTO ai_payments (user_id, order_no, amount, status) VALUES (?, ?, ?, ?)'
    ).run(req.userId, orderNo, amount, 'pending');

    // 初始化支付宝SDK
    // Format keys with proper PEM headers and 64-char line wrapping
    function wrapPemKey(key, header, footer) {
      if (key.startsWith("-----")) return key;
      const lines = [];
      for (let i = 0; i < key.length; i += 64) lines.push(key.substring(i, i + 64));
      return header + "\n" + lines.join("\n") + "\n" + footer;
    }
    const isSandbox = process.env.ALIPAY_SANDBOX === "true";
    const privateKey = wrapPemKey(process.env.ALIPAY_PRIVATE_KEY, "-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----");
    const publicKey = wrapPemKey(process.env.ALIPAY_PUBLIC_KEY, "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----");

    
    // Sandbox mode support
    const sdkAppId = isSandbox ? process.env.ALIPAY_SANDBOX_APP_ID : process.env.ALIPAY_APP_ID;
    const sdkPublicKey = isSandbox
      ? wrapPemKey(process.env.ALIPAY_SANDBOX_PUBLIC_KEY, "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----")
      : publicKey;
    const sdkEndpoint = isSandbox ? process.env.ALIPAY_SANDBOX_ENDPOINT : undefined;

const alipaySdk = new AlipaySdk({
      appId: sdkAppId,
      privateKey: privateKey,
      alipayPublicKey: sdkPublicKey,
      signType: 'RSA2',
      keyType: 'PKCS8',
      ...(sdkEndpoint ? { endpoint: sdkEndpoint } : {})
    });
    console.log('[Alipay] Mode:', isSandbox ? 'SANDBOX' : 'PRODUCTION');

    const bizContent = {
      out_trade_no: orderNo,
      total_amount: amount.toFixed(2),
      subject: `栗子AI生图充值 ${amount}元`,
      product_code: 'FAST_INSTANT_TRADE_PAY'
    };

    const result = alipaySdk.pageExecute('alipay.trade.page.pay', 'GET', {
      bizContent,
      notifyUrl: 'https://lizisucaiwang.online/api/ai/payment/notify',
      returnUrl: 'https://lizisucaiwang.online/ai-image.html?payment=success'
    });
    // Replace gateway URL for sandbox mode
    const finalUrl = isSandbox ? result.replace('https://openapi.alipay.com/gateway.do', sdkEndpoint) : result;

    res.json({
      success: true,
      orderNo,
      payUrl: finalUrl
    });
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ error: '创建支付订单失败' });
  }
});

// 支付宝异步通知
router.post('/payment/notify', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { out_trade_no, trade_status, trade_no } = req.body;

    // 验证签名（简化版，生产环境需要完整验证）
    // TODO: 添加完整的签名验证

    if (trade_status === 'TRADE_SUCCESS' || trade_status === 'TRADE_FINISHED') {
      // 查找订单
      const payment = db.prepare('SELECT * FROM ai_payments WHERE order_no = ?').get(out_trade_no);
      if (payment && payment.status === 'pending') {
        // 更新订单状态
        db.prepare(
          'UPDATE ai_payments SET status = ?, alipay_trade_no = ?, paid_at = CURRENT_TIMESTAMP WHERE order_no = ?'
        ).run('paid', trade_no, out_trade_no);

        // 给用户加余额
        db.prepare(
          'UPDATE ai_users SET balance = balance + ? WHERE id = ?'
        ).run(payment.amount, payment.user_id);

        // 记录交易
        db.prepare(
          'INSERT INTO ai_transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)'
        ).run(payment.user_id, 'recharge', payment.amount, `支付宝充值 ${payment.amount}元`);

        console.log(`Payment success: order ${out_trade_no}, amount ${payment.amount}`);
      }
    }

    res.send('success');
  } catch (err) {
    console.error('Payment notify error:', err);
    res.send('fail');
  }
});

// 生成前检查余额（图像/视频通用）
router.post('/generate/check', authMiddleware, (req, res) => {
  try {
    const { model, quality, resolution } = req.body;
    
    // 判断是否为视频模型
    const isVideoModel = model && (
      model.startsWith('sora-2') || 
      model.startsWith('seedance') || 
      model.startsWith('kling') || 
      model.startsWith('minimax')
    );
    
    let price = 0;
    const pricing = MODEL_PRICING[model];
    
    if (isVideoModel) {
      // 视频模型：返回最高价格作为预扣参考
      if (pricing && pricing.dualPrice) {
        // 双价格模型 (Seedance, Kling, Minimax)
        const duration = resolution?.match(/(\d+)s$/)?.[1] || '5';
        const tier = pricing.tiers[duration + 's'] || pricing.tiers['5s'];
        if (tier) {
          price = Math.ceil(tier.maxCost * 1.10 * 100) / 100;
        }
      } else if (pricing && typeof pricing === 'object') {
        // Sora 系列
        if (pricing[resolution] !== undefined) {
          price = Math.ceil(pricing[resolution] * 1.10 * 100) / 100;
        } else {
          // 取最高档价格
          const prices = Object.values(pricing);
          price = Math.ceil(Math.max(...prices) * 1.10 * 100) / 100;
        }
      }
    } else {
      // 图像模型
      price = getSellPrice(model, quality, resolution);
    }
    
    const isFree = price === 0;

    const db = req.app.locals.db;
    const freeCredits = ensureDailyFreeReset(db, req.userId);
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);

    // 管理员不设限额：跳过余额与免费次数检查
    if (user && user.is_admin) {
      return res.json({
        allowed: true,
        cost: 0,
        free: true,
        admin: true,
        balance: user.balance,
        isVideo: isVideoModel,
        message: '管理员无限额'
      });
    }

    if (isFree) {
      return res.json({ allowed: true, cost: 0, free: true });
    }

    // 检查是否有免费次数（仅低价图像模型可用，视频模型除外）
    if (!isVideoModel && freeCredits > 0 && isFreeEligible(model)) {
      return res.json({
        allowed: true,
        cost: 0,
        free: true,
        freeCreditsLeft: freeCredits - 1,
        message: `今日免费次数（剩余${freeCredits - 1}次）`
      });
    }

    // 检查余额
    if (user.balance < price) {
      return res.json({
        allowed: false,
        cost: price,
        balance: user.balance,
        message: `余额不足，需要¥${price}，当前余额¥${user.balance.toFixed(2)}`
      });
    }

    res.json({
      allowed: true,
      cost: price,
      balance: user.balance - price,
      isVideo: isVideoModel
    });
  } catch (err) {
    console.error('Generate check error:', err);
    res.status(500).json({ error: '检查失败' });
  }
});

// 生成成功后扣费
router.post('/generate/deduct', authMiddleware, (req, res) => {
  try {
    const { model, prompt, imageUrl, isFree, quality, resolution } = req.body;
    const price = getSellPrice(model, quality, resolution);

    const db = req.app.locals.db;

    // 重置每日免费次数并检查
    const freeCredits = ensureDailyFreeReset(db, req.userId);
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    let actualCost = price;
    let usedFree = false;
    const isAdmin = !!(user && user.is_admin);

    if (isAdmin) {
      // 管理员不扣费、不消耗免费次数
      actualCost = 0;
      usedFree = false;
    } else if (isFree || price === 0 || (freeCredits > 0 && isFreeEligible(model))) {
      actualCost = 0;
      usedFree = freeCredits > 0;
      if (usedFree) {
        db.prepare('UPDATE ai_users SET free_credits = free_credits - 1 WHERE id = ?').run(req.userId);
      }
    } else {
      // 扣余额
      db.prepare('UPDATE ai_users SET balance = balance - ? WHERE id = ?').run(price, req.userId);
    }

    // 记录生成
    db.prepare(
      'INSERT INTO ai_generations (user_id, model, prompt, image_url, cost, is_free) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, model, prompt, imageUrl, actualCost, (isAdmin || usedFree || price === 0) ? 1 : 0);

    // 记录交易
    if (actualCost > 0) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'generate', -actualCost, model, `生成图片: ${model}`);
    } else if (isAdmin) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'admin', 0, model, `管理员生成: ${model}`);
    } else if (usedFree) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'free', 0, model, `今日免费生成: ${model}`);
    }

    const updatedUser = db.prepare('SELECT balance, free_credits FROM ai_users WHERE id = ?').get(req.userId);

    res.json({
      success: true,
      balance: updatedUser.balance,
      freeCredits: updatedUser.free_credits,
      cost: actualCost
    });
  } catch (err) {
    console.error('Generate deduct error:', err);
    res.status(500).json({ error: '扣费失败' });
  }
});

// === 视频生成：预扣最高价 ===
router.post('/generate/prededuct', authMiddleware, (req, res) => {
  try {
    const { model, duration, resolution } = req.body;
    const pricing = MODEL_PRICING[model];
    
    // 判断是否为视频模型
    const isVideoModel = model && (
      model.startsWith('sora-2') || 
      model.startsWith('seedance') || 
      model.startsWith('kling') || 
      model.startsWith('minimax')
    );
    
    if (!isVideoModel) {
      return res.status(400).json({ error: '该接口仅支持视频模型' });
    }

    let maxPrice = 0;
    let minPrice = 0;
    
    if (pricing && pricing.dualPrice) {
      // 双价格模型 (Seedance, Kling, Minimax)
      const tier = pricing.tiers[duration || '5s'];
      if (!tier) {
        return res.status(400).json({ error: '无效的时长选项' });
      }
      // 应用10%利润
      maxPrice = Math.ceil(tier.maxCost * 1.10 * 100) / 100;
      minPrice = Math.ceil(tier.minCost * 1.10 * 100) / 100;
    } else if (pricing && typeof pricing === 'object') {
      // Sora 系列 - 按分辨率+时长定价
      const key = resolution || '720p-5s';
      if (pricing[key] !== undefined) {
        maxPrice = Math.ceil(pricing[key] * 1.10 * 100) / 100;
        minPrice = maxPrice; // Sora 定价固定，无差异
      } else {
        // 取最高档作为预扣价
        const prices = Object.values(pricing);
        maxPrice = Math.ceil(Math.max(...prices) * 1.10 * 100) / 100;
        minPrice = maxPrice;
      }
    } else {
      return res.status(400).json({ error: '不支持的视频模型' });
    }

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);

    // 管理员不设限额：跳过预扣
    if (user && user.is_admin) {
      return res.json({
        allowed: true,
        preCharge: 0,
        minPrice,
        maxPrice,
        balance: user.balance,
        admin: true,
        message: '管理员无限额，无需预扣'
      });
    }

    // 视频模型不允许使用免费次数
    if (user.balance < maxPrice) {
      return res.json({
        allowed: false,
        minPrice,
        maxPrice,
        balance: user.balance,
        message: `余额不足，需预扣¥${maxPrice}，当前余额¥${user.balance.toFixed(2)}`
      });
    }

    // 预扣最高价
    db.prepare('UPDATE ai_users SET balance = balance - ? WHERE id = ?').run(maxPrice, req.userId);

    const updatedUser = db.prepare('SELECT balance FROM ai_users WHERE id = ?').get(req.userId);
    res.json({
      allowed: true,
      preCharge: maxPrice,
      minPrice,
      maxPrice,
      balance: updatedUser.balance,
      message: `已预扣¥${maxPrice}，生成后按实际费用结算`
    });
  } catch (err) {
    console.error('Pre-deduct error:', err);
    res.status(500).json({ error: '预扣失败' });
  }
});

// === 视频生成：结算实际费用 ===
router.post('/generate/settle', authMiddleware, (req, res) => {
  try {
    const { model, duration, resolution, actualTokens, preCharge, prompt, videoUrl, actualCost: clientActualCost } = req.body;
    const pricing = MODEL_PRICING[model];

    // 判断是否为视频模型
    const isVideoModel = model && (
      model.startsWith('sora-2') || 
      model.startsWith('seedance') || 
      model.startsWith('kling') || 
      model.startsWith('minimax')
    );
    
    if (!isVideoModel) {
      return res.status(400).json({ error: '该接口仅支持视频模型' });
    }

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);

    // 管理员不设限额：跳过实际扣费，仅记录生成
    if (user && user.is_admin) {
      db.prepare(
        'INSERT INTO ai_generations (user_id, model, prompt, image_url, cost, is_free) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(req.userId, model, prompt, videoUrl, 0, 1);
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'admin', 0, model, `管理员生成视频: ${model} ${duration || ''}秒`);
      return res.json({
        success: true,
        preCharge: 0,
        actualCost: 0,
        actualTokens: actualTokens || 0,
        refundAmount: 0,
        balance: user.balance,
        freeCredits: user.free_credits,
        admin: true,
        message: '管理员无限额，无费用结算'
      });
    }

    let actualCost = 0;
    let refundAmount = 0;
    let finalCost = 0;

    if (pricing && pricing.dualPrice) {
      if (pricing.minRate !== undefined && pricing.maxRate !== undefined && actualTokens) {
        // 按 tokens 计费的双价格模型 (Seedance) - 应用10%利润
        const actualMinCost = Math.ceil((actualTokens / 1000000) * pricing.minRate * 1.10 * 100) / 100;
        const actualMaxCost = Math.ceil((actualTokens / 1000000) * pricing.maxRate * 1.10 * 100) / 100;
        // 实际费用取中间值（更公平）
        actualCost = Math.ceil((actualMinCost + actualMaxCost) / 2 * 100) / 100;
      } else {
        // 固定档位模型 (Kling, Minimax) - 按时长查表
        const rawDur = (duration || '5').toString().toLowerCase();
        const durKey = /^\d+s$/.test(rawDur) ? rawDur : `${parseInt(rawDur, 10) || 5}s`;
        const tier = pricing.tiers[durKey] || pricing.tiers[Object.keys(pricing.tiers)[0]];
        actualCost = Math.ceil(tier.maxCost * 1.10 * 100) / 100;
      }
    } else if (pricing && typeof pricing === 'object') {
      // Sora 系列 - 按分辨率+时长固定定价
      const key = resolution || '720p-' + (duration || '5') + 's';
      if (pricing[key] !== undefined) {
        actualCost = Math.ceil(pricing[key] * 1.10 * 100) / 100;
      } else {
        // 如果客户端提供了实际费用，使用客户端提供的值
        actualCost = clientActualCost || preCharge;
      }
    } else {
      actualCost = clientActualCost || preCharge;
    }

    // 计算退款金额
    refundAmount = Math.max(0, Math.ceil((preCharge - actualCost) * 100) / 100);
    finalCost = actualCost;

    // 退还差价
    if (refundAmount > 0) {
      db.prepare('UPDATE ai_users SET balance = balance + ? WHERE id = ?').run(refundAmount, req.userId);
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'refund', refundAmount, model, `退还差价: ${model} ${duration}秒`);
    }

    // 记录生成
    db.prepare(
      'INSERT INTO ai_generations (user_id, model, prompt, image_url, cost, is_free) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, model, prompt, videoUrl, finalCost, 0);

    // 记录交易
    if (finalCost > 0) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'generate', -finalCost, model, `生成视频: ${model} ${duration}秒 (预扣¥${preCharge}, 实付¥${finalCost})`);
    }

    const updatedUser = db.prepare('SELECT balance, free_credits FROM ai_users WHERE id = ?').get(req.userId);

    res.json({
      success: true,
      preCharge,
      actualCost,
      actualTokens: actualTokens || 0,
      refundAmount,
      balance: updatedUser.balance,
      freeCredits: updatedUser.free_credits,
      message: refundAmount > 0 ? `已退还¥${refundAmount}差价` : '费用已结算'
    });
  } catch (err) {
    console.error('Settle error:', err);
    res.status(500).json({ error: '结算失败' });
  }
});

// === 豆包 Seedance 视频代理 ===
const ZHIZENGZENG_API_KEY = process.env.ZHIZENGZENG_API_KEY || '';
const ZHIZENGZENG_BASE_URL = 'https://api2.aigcbest.top';

// 提交视频生成任务
router.post('/seedance/generate', authMiddleware, async (req, res) => {
  try {
    const { model, prompt, duration, ratio, image_url, resolution } = req.body;
    if (!model || !prompt) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 映射模型ID
    const modelMap = {
      'seedance-2-0': 'doubao-seedance-2-0-250612',
      'seedance-2-0-fast': 'doubao-seedance-2-0-fast-250612',
      'kling-v1-5': 'kling-v1-5',
      'minimax-m2-5': 'minimax-m2.5'
    };
    const apiModel = modelMap[model] || model;

    const contentArr = [{ type: 'text', text: prompt }];
    if (image_url) {
      contentArr.push({ type: 'image_url', image_url: { url: image_url } });
    }
    const body = {
      model: apiModel,
      content: contentArr,
      duration: parseInt(duration) || 5,
      ratio: ratio || 'adaptive',
      generate_audio: true
    };
    
    // Add resolution if provided (only for Seedance 2.0 and 1.5 pro)
    if (resolution && (apiModel.includes('seedance'))) {
      body.resolution = resolution;
    }
    
    // Add watermark false by default
    body.watermark = false;

    const resp = await fetch(`${ZHIZENGZENG_BASE_URL}/bytedance/api/v3/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZHIZENGZENG_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('Seedance generate error:', data);
      return res.status(resp.status).json({ error: data.message || data.error || '提交失败' });
    }
    res.json(data);
  } catch (err) {
    console.error('Seedance proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 查询视频生成状态
router.get('/seedance/status/:taskId', authMiddleware, async (req, res) => {
  try {
    const resp = await fetch(`${ZHIZENGZENG_BASE_URL}/bytedance/api/v3/contents/generations/tasks/${req.params.taskId}`, {
      headers: { 'Authorization': `Bearer ${ZHIZENGZENG_API_KEY}` }
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: data.message || '查询失败' });
    }
    res.json(data);
  } catch (err) {
    console.error('Seedance status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 下载视频内容
router.get('/seedance/download', authMiddleware, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: '缺少视频URL' });
    }

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${ZHIZENGZENG_API_KEY}` }
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: '下载失败' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Seedance download error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取交易记录
router.get('/transactions', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const limit = parseInt(req.query.limit) || 50;
    const transactions = db.prepare(
      'SELECT * FROM ai_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(req.userId, limit);

    res.json(transactions);
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: '获取交易记录失败' });
  }
});

// 管理员测试账号（自动创建或获取）
router.post('/admin/test-account', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const testPhone = '17121734984'; // 管理员测试专用手机号
    
    let user = db.prepare('SELECT * FROM ai_users WHERE phone = ?').get(testPhone);
    
    if (!user) {
      // Create test account
      const hashedPassword = await bcrypt.hash('bbshan12', 10);
      const result = db.prepare(
        'INSERT INTO ai_users (phone, password, balance, free_credits, device_id) VALUES (?, ?, 0, 99, ?)'
      ).run(testPhone, hashedPassword, 'admin_test_device');
      
      user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(result.lastInsertRowid);
      console.log('Created admin test account:', testPhone);
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        balance: user.balance,
        freeCredits: user.free_credits
      }
    });
  } catch (err) {
    console.error('Admin test account error:', err);
    res.status(500).json({ error: '创建测试账号失败' });
  }
});


// Admin: manually add balance to user (after QR code payment confirmation)
router.post('/admin/add-balance', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;

    // Check if requester is admin
    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ error: '权限不足' });
    }

    const { userId, amount } = req.body;
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: '参数错误' });
    }

    // Add balance
    db.prepare('UPDATE ai_users SET balance = balance + ? WHERE id = ?').run(amount, userId);

    // Record transaction
    db.prepare(
      'INSERT INTO ai_transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)'
    ).run(userId, 'recharge', amount, '管理员手动充值 ¥' + amount);

    const user = db.prepare('SELECT phone, balance FROM ai_users WHERE id = ?').get(userId);

    res.json({
      success: true,
      message: '已为用户 ' + user.phone + ' 充值 ¥' + amount,
      newBalance: user.balance
    });
  } catch (err) {
    console.error('Admin add balance error:', err);
    res.status(500).json({ error: '充值失败' });
  }
});

// Admin: list all users
router.get('/admin/users', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;

    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ error: '权限不足' });
    }

    const users = db.prepare(
      'SELECT id, phone, balance, free_credits, created_at FROM ai_users ORDER BY created_at DESC'
    ).all();

    res.json(users);
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});


// ===== Admin Image Moderation =====

// List all AI generations with user info
router.get('/admin/generations', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ error: '权限不足' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const generations = db.prepare(`
      SELECT g.id, g.model, g.prompt, g.image_url, g.cost, g.is_free, g.created_at,
             u.phone as user_phone, u.id as user_id
      FROM ai_generations g
      LEFT JOIN ai_users u ON g.user_id = u.id
      ORDER BY g.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM ai_generations').get();

    res.json({
      generations,
      total: total.count,
      page,
      limit,
      totalPages: Math.ceil(total.count / limit)
    });
  } catch (err) {
    console.error('Admin list generations error:', err);
    res.status(500).json({ error: '获取生成记录失败' });
  }
});

// Delete a specific generation
router.delete('/admin/generations/:id', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ error: '权限不足' });
    }

    const generationId = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM ai_generations WHERE id = ?').run(generationId);

    if (result.changes === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }

    res.json({ success: true, message: '已删除' });
  } catch (err) {
    console.error('Admin delete generation error:', err);
    res.status(500).json({ error: '删除失败' });
  }
});




// === 智增增 API 代理（Gemini 专用，保留原有配置）===
const ZZ_API_KEY = process.env.ZZ_API_KEY || '';
const ZZ_BASE_URL = 'https://api2.aigcbest.top';

// === api2.aigcbest.top 代理（图像生成，OpenAI 兼容格式）===
const AIGCBEST_API_KEY = process.env.AIGCBEST_API_KEY || '';
const AIGCBEST_BASE_URL = 'https://api2.aigcbest.top';

// 图像生成代理：转发到 api2.aigcbest.top（OpenAI /v1/images/generations 兼容格式）
// API Key 存在服务器，前端不直接接触，保障安全
router.all('/proxy/zz/openai', authMiddleware, async (req, res) => {
  try {
    const targetPath = req.query.path || '/v1/images/generations';
    const url = `${AIGCBEST_BASE_URL}${targetPath}`;

    const headers = {
      'Authorization': `Bearer ${AIGCBEST_API_KEY}`,
      'Content-Type': 'application/json'
    };

    const options = {
      method: req.method,
      headers
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      options.body = JSON.stringify(req.body);
    }

    console.log('[AIGCBEST] Proxy ->', targetPath, 'model:', req.body?.model || 'unknown');

    const resp = await fetch(url, options);
    const data = await resp.json();

    if (data.error) {
      console.error('[AIGCBEST] API error:', JSON.stringify(data.error).substring(0, 300));
    }

    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[AIGCBEST] proxy error:', err.message);
    res.status(502).json({ error: { message: '代理请求失败: ' + err.message } });
  }
});

// Proxy for Gemini models (uses Google native API format: https://api.zhizengzeng.com/google)
router.all('/proxy/zz/gemini', authMiddleware, async (req, res) => {
  try {
    const model = req.query.model || 'gemini-2.5-flash-image';
    const action = req.query.action || 'generateContent';
    const url = `${ZZ_BASE_URL}/google/v1beta/models/${model}:${action}`;
    
    const headers = {
      'X-goog-api-key': ZZ_API_KEY,
      'Content-Type': 'application/json'
    };
    
    const options = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      options.body = JSON.stringify(req.body);
    }
    
    const resp = await fetch(url, options);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('Gemini proxy error:', err.message);
    res.status(502).json({ error: '代理请求失败: ' + err.message });
  }
});

// 智增增余额查询
router.get('/zhizengzeng/balance', async (req, res) => {
  try {
    const resp = await fetch(`${ZZ_BASE_URL}/v1/dashboard/billing/credit_grants`, {
      method: 'POST',
      headers: { 
        'Authorization': 'Bearer ' + ZZ_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('ZZ balance error:', err.message);
    res.status(502).json({ error: '查询失败' });
  }
});

// === 字节豆包视频生成代理（火山引擎，通过智增增转发）===
// 官方文档: https://doc.zhizengzeng.com/doc-7974572
// 创建任务: POST /bytedance/api/v3/contents/generations/tasks
// 查询任务: GET  /bytedance/api/v3/contents/generations/tasks/{id}

// 创建字节豆包视频生成任务
router.post('/proxy/bytedance/video', authMiddleware, async (req, res) => {
  try {
    const url = `${ZZ_BASE_URL}/bytedance/api/v3/contents/generations/tasks`;

    const headers = {
      'Authorization': `Bearer ${ZZ_API_KEY}`,
      'Content-Type': 'application/json'
    };

    console.log('[BYTEDANCE-VIDEO] Create task, body:', JSON.stringify(req.body).substring(0, 300));

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body)
    });
    const data = await resp.json();

    if (!resp.ok) {
      console.error('[BYTEDANCE-VIDEO] API error:', JSON.stringify(data).substring(0, 400));
    } else {
      console.log('[BYTEDANCE-VIDEO] Task created, id:', data.id || data.task_id || 'unknown');
    }

    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[BYTEDANCE-VIDEO] create error:', err.message);
    res.status(502).json({ error: '请求失败: ' + err.message });
  }
});

// 查询字节豆包视频生成任务状态
router.get('/proxy/bytedance/video/:id', authMiddleware, async (req, res) => {
  try {
    const url = `${ZZ_BASE_URL}/bytedance/api/v3/contents/generations/tasks/${req.params.id}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ZZ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await resp.json();

    if (!resp.ok) {
      console.error('[BYTEDANCE-VIDEO] status error:', JSON.stringify(data).substring(0, 300));
    }

    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[BYTEDANCE-VIDEO] status error:', err.message);
    res.status(502).json({ error: '查询失败: ' + err.message });
  }
});

// === Suno 音乐生成代理 ===
// 提交音乐生成任务
router.post('/proxy/aigcbest/suno/submit', authMiddleware, async (req, res) => {
  try {
    const url = `${AIGCBEST_BASE_URL}/suno/submit/music`;
    console.log('[SUNO] Submit music, body:', JSON.stringify(req.body).substring(0, 300));

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIGCBEST_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    const data = await resp.json();

    if (!resp.ok || data.code !== 'success') {
      console.error('[SUNO] API error:', JSON.stringify(data).substring(0, 400));
    } else {
      console.log('[SUNO] Task submitted, id:', data.data);
    }

    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[SUNO] submit error:', err.message);
    res.status(502).json({ error: '请求失败: ' + err.message });
  }
});

// 查询音乐生成结果
router.get('/proxy/aigcbest/suno/feed/:id', authMiddleware, async (req, res) => {
  try {
    const url = `${AIGCBEST_BASE_URL}/suno/feed/${req.params.id}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIGCBEST_API_KEY}`,
        'Accept': 'application/json'
      }
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[SUNO] feed error:', err.message);
    res.status(502).json({ error: '查询失败: ' + err.message });
  }
});

// === TTS 文本转语音代理 ===
router.post('/proxy/aigcbest/tts', authMiddleware, async (req, res) => {
  try {
    const url = `${AIGCBEST_BASE_URL}/v1/audio/speech`;
    console.log('[TTS] Request, model:', req.body?.model, 'voice:', req.body?.voice);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIGCBEST_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[TTS] API error:', errText.substring(0, 300));
      res.status(resp.status).json({ error: JSON.parse(errText).error || 'TTS 请求失败' });
      return;
    }

    // Return audio binary directly
    const contentType = resp.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('[TTS] error:', err.message);
    res.status(502).json({ error: 'TTS 请求失败: ' + err.message });
  }
});

// === STT 语音转文字代理 ===
router.post('/proxy/aigcbest/stt', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const url = `${AIGCBEST_BASE_URL}/v1/audio/transcriptions`;
    console.log('[STT] Request received');

    // Forward multipart form data
    const formData = new FormData();
    if (req.file) {
      formData.append('file', new Blob([req.file.buffer]), req.file.originalname);
    }
    if (req.body.model) formData.append('model', req.body.model);
    if (req.body.language) formData.append('language', req.body.language);
    if (req.body.response_format) formData.append('response_format', req.body.response_format);
    if (req.body.prompt) formData.append('prompt', req.body.prompt);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIGCBEST_API_KEY}`
      },
      body: formData
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[STT] error:', err.message);
    res.status(502).json({ error: 'STT 请求失败: ' + err.message });
  }
});

module.exports = { router, initTables };
