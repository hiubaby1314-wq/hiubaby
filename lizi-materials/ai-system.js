const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { AlipaySdk, AlipayFormData } = require('alipay-sdk');

// AI模型定价（成本价，单位：元）
const MODEL_PRICING = {
  'gpt-image-2': 0.36,
  'nano-banana-pro': 0.14,
  'nano-banana-2': 0.14,
  'nano-banana': 0.07,
  'midjourney': 0.22,
  'pollinations': 0,
  'pollinations-realism': 0,
  'pollinations-anime': 0,
  'pollinations-3d': 0,
  'pollinations-turbo': 0
};

// 售价（成本价 + 10%）
function getSellPrice(model) {
  const cost = MODEL_PRICING[model] || 0;
  return Math.ceil(cost * 1.1 * 100) / 100; // 向上取整到分
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
    const result = db.prepare(
      'INSERT INTO ai_users (phone, password, balance, free_credits, device_id) VALUES (?, ?, 0, 3, ?)'
    ).run(phone, hashedPassword, deviceId);

    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      token,
      user: {
        id: result.lastInsertRowid,
        phone,
        balance: 0,
        freeCredits: 3
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
    console.error('Login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// 获取用户信息
router.get('/user/info', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      id: user.id,
      phone: user.phone,
      balance: user.balance,
      freeCredits: user.free_credits
    });
  } catch (err) {
    console.error('Get user info error:', err);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// 获取模型价格列表
router.get('/pricing', (req, res) => {
  const pricing = {};
  for (const [model, cost] of Object.entries(MODEL_PRICING)) {
    pricing[model] = {
      cost,
      price: getSellPrice(model),
      free: cost === 0
    };
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

    const db = req.app.locals.db;
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
    const privateKey = wrapPemKey(process.env.ALIPAY_PRIVATE_KEY, "-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----");
    const publicKey = wrapPemKey(process.env.ALIPAY_PUBLIC_KEY, "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----");

    const alipaySdk = new AlipaySdk({
      appId: process.env.ALIPAY_APP_ID,
      privateKey: privateKey,
      alipayPublicKey: publicKey,
      signType: 'RSA2'
    });

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

    res.json({
      success: true,
      orderNo,
      payUrl: result
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

// 生成图片前检查余额并扣费
router.post('/generate/check', authMiddleware, (req, res) => {
  try {
    const { model } = req.body;
    const price = getSellPrice(model);
    const isFree = price === 0;

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);

    if (isFree) {
      return res.json({ allowed: true, cost: 0, free: true });
    }

    // 检查是否有免费次数
    if (user.free_credits > 0) {
      return res.json({
        allowed: true,
        cost: 0,
        free: true,
        freeCreditsLeft: user.free_credits - 1,
        message: `使用免费次数（剩余${user.free_credits - 1}次）`
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
      balance: user.balance - price
    });
  } catch (err) {
    console.error('Generate check error:', err);
    res.status(500).json({ error: '检查失败' });
  }
});

// 生成成功后扣费
router.post('/generate/deduct', authMiddleware, (req, res) => {
  try {
    const { model, prompt, imageUrl, isFree } = req.body;
    const price = getSellPrice(model);

    const db = req.app.locals.db;

    // 检查是否有免费次数
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    let actualCost = price;
    let usedFree = false;

    if (isFree || price === 0 || user.free_credits > 0) {
      actualCost = 0;
      usedFree = user.free_credits > 0;
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
    ).run(req.userId, model, prompt, imageUrl, actualCost, usedFree || price === 0 ? 1 : 0);

    // 记录交易
    if (actualCost > 0) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'generate', -actualCost, model, `生成图片: ${model}`);
    } else if (usedFree) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'free', 0, model, `免费生成: ${model}`);
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
    const testPhone = '13800000000'; // 管理员测试专用手机号
    
    let user = db.prepare('SELECT * FROM ai_users WHERE phone = ?').get(testPhone);
    
    if (!user) {
      // Create test account
      const hashedPassword = await bcrypt.hash('AdminTest123!', 10);
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

module.exports = { router, initTables };
