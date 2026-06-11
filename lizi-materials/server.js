
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { router: aiRouter, initTables: initAITables } = require('./ai-system');
const cors = require('cors');
const { applyWatermark } = require('./watermark');

// Traditional → Simplified Chinese converter
const OpenCC = require('opencc-js');
const t2sConverter = OpenCC.Converter({ from: 'tw', to: 'cn' });
function toSimplified(text) {
  if (!text || typeof text !== 'string') return text;
  return t2sConverter(text);
}

const helmet = require('helmet');
const app = express();
app.set("trust proxy", "loopback"); // Trust only local Nginx proxy
app.use(helmet({ contentSecurityPolicy: false }));
// Advanced Hardening: Logging
app.use(morgan('combined'));

// Advanced Hardening: Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { ok: false, error: '请求過於頻繁，請稍後再試' },
  validate: { trustProxy: false } // We trust our local Nginx proxy
});
app.use('/api/', limiter); // Apply rate limit to all API routes
 // Disable CSP to avoid breaking existing frontend inline scripts
const PORT = process.env.PORT || 3000;

// === 本地檔案存儲 ===
async function saveToLocal(key, buffer) {
  const filePath = path.join(__dirname, 'data', key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return '/data/' + key.replace(/\\/g, '/');
}

async function deleteFromLocal(filePath) {
  if (!filePath || !filePath.startsWith('/data/')) return;
  const fullPath = path.join(__dirname, filePath);
  try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch(e) {}
}

async function readFromLocal(filePath) {
  if (!filePath || !filePath.startsWith('/data/')) return null;
  const fullPath = path.join(__dirname, filePath);
  try { return fs.existsSync(fullPath) ? fs.createReadStream(fullPath) : null; } catch(e) { return null; }
}

const DB_PATH = path.join(__dirname, 'data', 'lizi.db');
let db;
let dbReady = true; // false during db close/reopen windows

// === Database ===
async function initDB() {
  const CompatDB = require('./lib/sqlite-compat');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new CompatDB(null, DB_PATH);
  db.pragma('journal_mode = WAL');

  // Materials table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      force_pwd_change INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cat TEXT NOT NULL DEFAULT '表情包',
      badges TEXT DEFAULT '["版权","new"]',
      gradient INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS material_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      mime TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT DEFAULT '匿名',
      content TEXT NOT NULL,
      contact TEXT DEFAULT '',
      images TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_account TEXT NOT NULL,
      bind_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      from_user TEXT DEFAULT '系统',
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      time DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS device_lock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      device_id TEXT NOT NULL,
      is_mobile INTEGER DEFAULT 0,
      locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Site settings table (key-value store)
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Default: AI maintenance OFF (open)
  const aiMaintRow = db.prepare("SELECT key FROM site_settings WHERE key = ?").get("ai_maintenance");
  if (!aiMaintRow) {
    db.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)").run("ai_maintenance", "false");
  }

  // Add missing columns if needed
  try { db.exec('ALTER TABLE materials ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN downloads INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN gradient INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN badges TEXT DEFAULT \'["版权","new"]\''); } catch(e) {}

  // Create admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, ?)')
      .run('admin', crypto.createHash('md5').update(process.env.ADMIN_PWD || 'admin123').digest('hex'), 'admin', 0);
  }
}

// === R2 Storage ===

// === Snapshot: manual save/restore ===
const SNAPSHOT_PATH = path.join(__dirname, 'data', 'materials-snapshot.json');

// Save current materials to snapshot (manual trigger only)
async function saveSnapshot() {
  try {
    const materials = db.prepare('SELECT * FROM materials ORDER BY sort_order, id DESC').all();
    const snapshot = materials.map(m => {
      const files = db.prepare('SELECT name, path, ext, size, mime FROM material_files WHERE material_id = ? ORDER BY id').all(m.id);
      return {
        name: m.name,
        cat: m.cat,
        badges: JSON.parse(m.badges || '["版权","new"]'),
        gradient: m.gradient,
        sort_order: m.sort_order,
        downloads: m.downloads,
        files: files.map(f => ({ name: f.name, path: f.path, ext: f.ext, size: f.size, mime: f.mime }))
      };
    });

    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

        console.log(`Snapshot saved: ${snapshot.length} materials`);
    return snapshot.length;
  } catch (e) {
    console.error('Snapshot save failed:', e.message);
    throw e;
  }
}

// Restore materials from snapshot (manual trigger only)
async function restoreSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error('No snapshot found');
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  
  // Collect all file paths from snapshot to identify orphans
  const snapshotPaths = new Set();
  for (const item of snapshot) {
    for (const f of (item.files || [])) {
      if (f.path) snapshotPaths.add(f.path);
    }
  }
  
  // Get all current file paths from DB
  const currentFiles = db.prepare('SELECT path FROM material_files').all();
  const currentPaths = currentFiles.map(f => f.path);
  
    
  // Clear all materials
  db.exec('DELETE FROM material_files');
  db.exec('DELETE FROM materials');
  
  const insertMat = db.prepare(`
    INSERT INTO materials (name, cat, badges, gradient, sort_order, downloads)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFile = db.prepare(`
    INSERT INTO material_files (material_id, name, path, ext, size, mime)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const item of snapshot) {
    const result = insertMat.run(
      item.name, item.cat,
      JSON.stringify(item.badges || ['版权', 'new']),
      item.gradient ?? 0,
      item.sort_order ?? 0,
      item.downloads ?? 0
    );
    const matId = result.lastInsertRowid;
    for (const f of (item.files || [])) {
      insertFile.run(matId, f.name, f.path, f.ext, f.size || 0, f.mime || '');
    }
  }
  console.log(`Snapshot restored: ${snapshot.length} materials`);
  return snapshot.length;
}

// === SEO Config ===
function getSiteURL(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return 'https://lizisucaiwang.online';
}

// === CORS ===
const ALLOWED_ORIGINS = [
  'https://herng9d2.mule.page',
  'https://lizisucaiwang.online',
  'http://43.161.253.21',
  'https://43.161.253.21',
  'http://localhost',
  'http://127.0.0.1'
];
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (server-side, curl, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    // Also allow any IP-based origin (for direct IP access)
    if (/^https?:\/\/\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true
}));

// === Middleware ===
app.use((req, res, next) => {
  if (!dbReady) return res.status(503).json({ ok: false, error: '服务正在维护，请稍后再试' });
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cache headers for static assets
// Cache headers for static assets
// Protect /ai/ from direct URL access
app.use('/ai', (req, res, next) => {
  const referer = req.get('referer') || '';
  if (referer.includes('lizisucaiwang.online') || referer.includes('43.161.253.21') || referer.includes('localhost') || referer.includes('127.0.0.1')) {
    return next();
  }
  res.redirect('/');
});

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '7d', immutable: true }));
app.use('/data/uploads', express.static(path.join(__dirname, 'data', 'uploads')));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath) || filePath.endsWith('manifest.json') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Category pages - serve index.html for client-side routing
app.get("/cat/:name", function(req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// === Reverse Proxy: /voice/* → voice-app (port 3003) ===
const httpVoice = require('http');
function proxyToVoice(req, res, stripPrefix) {
  let targetPath = req.url;
  if (stripPrefix) {
    targetPath = targetPath.replace(/^\/voice/, '') || '/';
  }
  const bodyChunks = [];
  req.on('data', chunk => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = bodyChunks.length ? Buffer.concat(bodyChunks) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: 3003,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:3003' }
    };
    if (body) opts.headers['content-length'] = body.length;
    const proxyReq = httpVoice.request(opts, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', err => {
      console.error('[Voice Proxy Error]', err.message);
      if (!res.headersSent) res.status(502).json({ error: '配音服务不可用' });
    });
    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

// Proxy voice static pages: /voice/* → port 3003
app.all('/voice/{*splat}', (req, res) => proxyToVoice(req, res, true));
app.all('/voice', (req, res) => proxyToVoice(req, res, true));

// Proxy voice API endpoints → port 3003
app.all('/api/tts', (req, res) => proxyToVoice(req, res, false));
app.all('/api/merge', (req, res) => proxyToVoice(req, res, false));
app.all('/api/voice-clone', (req, res) => proxyToVoice(req, res, false));
app.all('/api/voice-status', (req, res) => proxyToVoice(req, res, false));
app.all('/api/system-voices', (req, res) => proxyToVoice(req, res, false));
app.all('/api/voice-list', (req, res) => proxyToVoice(req, res, false));
app.all('/api/voice-delete', (req, res) => proxyToVoice(req, res, false));
app.all('/api/chat', (req, res) => proxyToVoice(req, res, false));
app.all('/api/chat/models', (req, res) => proxyToVoice(req, res, false));

// AI image page - only accessible via iframe inside main site
// Direct /ai URL access is disabled, redirects to homepage
app.get("/ai", function(req, res) {
  res.redirect('/');
});

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

function hashPwd(p) { return crypto.createHash('md5').update(p).digest('hex'); }

// Rewrite old R2 bucket URLs to the current

// === DB Sync Helper ===

// === Helper: get material with files ===
function getMaterialWithFiles(id) {
  const mat = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!mat) return null;
  const files = db.prepare('SELECT * FROM material_files WHERE material_id = ? ORDER BY id').all(id);
  return {
    ...mat,
    badges: JSON.parse(mat.badges || '["版权","new"]'),
    uploadedFiles: files.map(f => ({ name: f.name, path: f.path, ext: f.ext, size: f.size, mime: f.mime }))
  };
}

function getAllMaterials() {
  const materials = db.prepare('SELECT * FROM materials ORDER BY id DESC').all();
  return materials.map(m => {
    const files = db.prepare('SELECT * FROM material_files WHERE material_id = ? ORDER BY id').all(m.id);
    return {
      ...m,
      badges: JSON.parse(m.badges || '["版权","new"]'),
      uploadedFiles: files.map(f => ({ id: f.id, name: f.name, path: f.path, ext: f.ext, size: f.size, mime: f.mime }))
    };
  });
}

// === API Routes ===

// Login
app.post('/api/login', async (req, res) => {
  const { username, password, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  if (!username || !password) return res.json({ ok: false, error: '请输入用户名和密码' });
  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
    return res.json({ ok: false, error: '设备标识无效' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(password)) return res.json({ ok: false, error: '用户名或密码错误' });

  // Device lock check - only enforce for admin
  const isAdminLogin = user.role === 'admin';
  if (isAdminLogin) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock && lock.device_id !== deviceId) {
      return res.json({ ok: false, error: '管理员账号已锁定到指定设备，无法在此设备登录' });
    }
  }

  // Generate session token for admin auto-login
  const sessionToken = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (username, device_id, token) VALUES (?, ?, ?)').run(user.username, deviceId, sessionToken);
  // Clean up old sessions for this user+device (keep only last 5)
  db.prepare('DELETE FROM sessions WHERE username = ? AND device_id = ? AND id NOT IN (SELECT id FROM sessions WHERE username = ? AND device_id = ? ORDER BY id DESC LIMIT 20)').run(user.username, deviceId, user.username, deviceId);

  res.json({ ok: true, user: { username: user.username, role: user.role }, token: sessionToken, forcePwdChange: !!user.force_pwd_change });
});

// Change password
app.post('/api/changePwd', async (req, res) => {
  const { username, oldPwd, newPwd } = req.body;
  if (!oldPwd || !newPwd || newPwd.length < 4) return res.json({ ok: false, error: '新密码至少4位' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(oldPwd)) return res.json({ ok: false, error: '当前密码错误' });
  db.prepare('UPDATE users SET password = ?, force_pwd_change = 0 WHERE username = ?').run(hashPwd(newPwd), username);
  res.json({ ok: true });
});

// === Session verify ===
app.post('/api/me', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token) return res.json({ ok: false, error: '未登入' });
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ ok: false, error: '登录已過期，請重新登录' });
  const user = db.prepare('SELECT username, role FROM users WHERE username = ?').get(session.username);
  if (!user) return res.status(401).json({ ok: false, error: '登录已過期，請重新登录' });
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

// === Users ===
app.get('/api/users', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.query.username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  const users = db.prepare('SELECT username, role, created_at FROM users ORDER BY created_at DESC').all();
  // Attach bindings and voice clone info to each user
  for (const u of users) {
    u.bindings = db.prepare('SELECT platform, platform_account FROM bindings WHERE username = ?').all(u.username);
    // Get voice clone info
    const voiceClone = db.prepare('SELECT demo_url, status FROM voice_clones WHERE username = ? ORDER BY created_at DESC LIMIT 1').get(u.username);
    if (voiceClone && voiceClone.status === 'ready') {
      u.voice_demo_url = voiceClone.demo_url;
    }
  }
  res.json({ ok: true, users });
});

app.post('/api/users', async (req, res) => {
  const { adminUsername, username, role } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (!username || username.length < 2) return res.json({ ok: false, error: '用户名至少2个字符' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.json({ ok: false, error: '用户名已存在' });
  const tempPassword = '123456';
  db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, 1)').run(username, hashPwd(tempPassword), role || 'user');
  res.json({ ok: true, tempPassword });
});

app.delete('/api/users/:username', async (req, res) => {
  const { adminUsername } = req.body;
  const targetUsername = req.params.username;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (targetUsername === 'admin') return res.json({ ok: false, error: '不能删除管理员' });
  db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
  res.json({ ok: true });
});

// Change user role
app.put('/api/users/:username/role', (req, res) => {
  const { adminUsername, role } = req.body;
  const targetUsername = req.params.username;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (targetUsername === 'admin') return res.json({ ok: false, error: '不能修改主管理員角色' });
  const validRoles = ['user', 'vip', 'promo', 'admin'];
  if (!validRoles.includes(role)) return res.json({ ok: false, error: '無效角色' });
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(targetUsername);
  if (!target) return res.json({ ok: false, error: '用戶不存在' });
  db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, targetUsername);
  res.json({ ok: true });
});

// === Device Lock Management ===
app.get('/api/device-locks', (req, res) => {
  const adminUsername = req.query.username;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  const locks = db.prepare('SELECT * FROM device_lock ORDER BY locked_at DESC').all();
  res.json({ ok: true, locks });
});

app.post('/api/admin/lock-device', (req, res) => {
  const { adminUsername, deviceId } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '權限不足' });
  if (!deviceId) return res.json({ ok: false, error: 'deviceId 缺失' });
  // Upsert device lock for admin
  const existing = db.prepare('SELECT id FROM device_lock WHERE username = ?').get(adminUsername);
  if (existing) {
    db.prepare('UPDATE device_lock SET device_id = ?, is_mobile = 0, locked_at = CURRENT_TIMESTAMP WHERE username = ?').run(deviceId, adminUsername);
  } else {
    db.prepare('INSERT INTO device_lock (username, device_id, is_mobile) VALUES (?, ?, 0)').run(adminUsername, deviceId);
  }
  res.json({ ok: true, deviceId });
});

app.delete('/api/device-locks/:username', (req, res) => {
  const adminUsername = req.body.adminUsername;
  const targetUsername = req.params.username;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  db.prepare('DELETE FROM device_lock WHERE username = ?').run(targetUsername);
  res.json({ ok: true });
});

// === Materials ===
app.get('/api/materials', (req, res) => {
  res.json({ ok: true, materials: getAllMaterials() });
});

// Add material with file uploads
app.post('/api/materials', upload.array('files', 20), async (req, res) => {
  const { username, cat, badges, gradient } = req.body;
  const name = toSimplified(req.body.name);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  if (!name) return res.json({ ok: false, error: '请输入名称' });

  // Auto-overwrite if same name exists
  const existing = db.prepare('SELECT * FROM materials WHERE name = ?').get(name);
  if (existing) {
    const oldFiles = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(existing.id);
    await Promise.all(oldFiles.map(f => f.path && f.path && !f.path.startsWith('/data/') ? deleteFromLocal(f.path) : Promise.resolve()));
    db.prepare('DELETE FROM material_files WHERE material_id = ?').run(existing.id);
    db.prepare('DELETE FROM materials WHERE id = ?').run(existing.id);
    console.log(`Auto-overwrote existing material: ${name}`);
  }

  const matBadges = badges ? badges.split(',').map(s => s.trim()) : ['版权', 'new'];
  const grad = gradient !== undefined ? parseInt(gradient) : Math.floor(Math.random() * 25);

  const result = db.prepare('INSERT INTO materials (name, cat, badges, gradient) VALUES (?, ?, ?, ?)')
    .run(name, cat || '表情包', JSON.stringify(matBadges), grad);
  const materialId = result.lastInsertRowid;

  // Upload files
  const files = req.files || [];
  console.log(`[Upload] Material "${name}" (id pending): received ${files.length} files from multer`);
  if (files.length > 0) {
    files.forEach((f, i) => console.log(`  file[${i}]: ${f.originalname} (${f.size} bytes, ${f.mimetype})`));
  }

  // Reject if no files were received
  if (files.length === 0) {
    console.warn(`[Upload] WARNING: No files received for material "${name}". Deleting record.`);
    try { db.prepare('DELETE FROM materials WHERE id = ?').run(materialId); } catch(e) {}
    return res.json({ ok: false, error: '未收到任何文件，请重新选择文件后上传' });
  }

  let uploadedCount = 0;
  let uploadErrors = [];
  for (const f of files) {
    try {
      const ext = path.extname(f.originalname);
      const key = `uploads/${crypto.randomUUID()}${ext}`;
      // Apply watermark to image files
      let fileBuffer = f.buffer;
      if (f.mimetype && f.mimetype.startsWith('image/') && !['.gif', '.svg', '.fla', '.swf'].includes(ext.toLowerCase())) {
        try {
          fileBuffer = await applyWatermark(f.buffer, f.mimetype);
          console.log(`  Watermark applied: ${f.originalname} (${f.buffer.length} -> ${fileBuffer.length} bytes)`);
        } catch (wmErr) {
          console.error(`  Watermark failed for ${f.originalname}: ${wmErr.message}`);
        }
      }
      const url = await saveToLocal(key, fileBuffer, f.mimetype);
      db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
        .run(materialId, f.originalname, url, ext, f.size, f.mimetype);
      uploadedCount++;
      console.log(`  Uploaded: ${f.originalname} -> ${url}`);
    } catch (uploadErr) {
      console.error(`[Upload] FAILED: ${f.originalname} - ${uploadErr.message}`);
      uploadErrors.push(`${f.originalname}: ${uploadErr.message}`);
    }
  }

  // If ALL files failed, delete the material record
  if (uploadedCount === 0) {
    console.error(`[Upload] All files failed for "${name}". Deleting material record.`);
    db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);
    return res.json({ ok: false, error: '文件上传失败：' + uploadErrors.join('; ') });
  }

  // Check if only one file uploaded (should be FLA + PNG/GIF)
  const fileCount = uploadedCount;
  const hasFla = files.some(f => path.extname(f.originalname).toLowerCase() === '.fla');
  const hasImage = files.some(f => ['.png', '.gif', '.jpg', '.jpeg'].includes(path.extname(f.originalname).toLowerCase()));
  let warning = '';
  if (fileCount === 1) {
    warning = hasFla ? '只上传了 FLA 文件，缺少 PNG/GIF 图片' : '只上传了图片文件，缺少 FLA 源文件';
  } else if (fileCount >= 2 && (!hasFla || !hasImage)) {
    warning = !hasFla ? '缺少 FLA 源文件' : '缺少 PNG/GIF 图片文件';
  }
  if (uploadErrors.length > 0) {
    warning += (warning ? '\n' : '') + '部分文件上传失败：' + uploadErrors.join('; ');
  }
  res.json({ ok: true, materials: getAllMaterials(), warning });
});

// Upload files to existing material
app.post('/api/materials/:id/upload', upload.array('files', 20), async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = parseInt(req.params.id, 10);
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${crypto.randomUUID()}${ext}`;
    // Apply watermark to image files
    let fileBuffer = f.buffer;
    if (f.mimetype && f.mimetype.startsWith('image/') && !['.gif', '.svg', '.fla', '.swf'].includes(ext.toLowerCase())) {
      try {
        fileBuffer = await applyWatermark(f.buffer, f.mimetype);
        console.log(`  Watermark applied: ${f.originalname} (${f.buffer.length} -> ${fileBuffer.length} bytes)`);
      } catch (wmErr) {
        console.error(`  Watermark failed for ${f.originalname}: ${wmErr.message}`);
      }
    }
    const url = await saveToLocal(key, fileBuffer, f.mimetype);
    db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
      .run(materialId, f.originalname, url, ext, f.size, f.mimetype);
  }
  res.json({ ok: true, material: getMaterialWithFiles(materialId) });
});

// Update material
app.put('/api/materials/:id', async (req, res) => {
  const { username, cat, badges, gradient } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = parseInt(req.params.id, 10);
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const updates = {};
  if (req.body.name) updates.name = toSimplified(req.body.name);
  if (cat) updates.cat = cat;
  if (badges) updates.badges = JSON.stringify(Array.isArray(badges) ? badges : badges.split(',').map(s => s.trim()));
  if (gradient !== undefined) updates.gradient = parseInt(gradient);

  if (Object.keys(updates).length > 0) {
    const sets = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), materialId];
    db.prepare(`UPDATE materials SET ${sets} WHERE id = ?`).run(...vals);
  }
  res.json({ ok: true, materials: getAllMaterials() });
});

// Delete material
app.delete('/api/materials/:id', async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = parseInt(req.params.id, 10);

  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (material) {
    const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(materialId);
    // Wait for all R2 deletions to complete
    await Promise.all(files.map(f => {
      if (f.path && f.path && !f.path.startsWith('/data/')) return deleteFromLocal(f.path);
    }));
    db.prepare('DELETE FROM material_files WHERE material_id = ?').run(materialId);
    db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);
    // Real-time backup
  }

  res.json({ ok: true, materials: getAllMaterials() });
});

// Reorder materials
app.post('/api/materials/reorder', async (req, res) => {
  const { username, order } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const stmt = db.prepare('UPDATE materials SET sort_order = ? WHERE id = ?');
  const materials = getAllMaterials();
  order.forEach((idx, i) => {
    if (materials[idx]) stmt.run(i, materials[idx].id);
  });
  res.json({ ok: true, materials: getAllMaterials() });
});

// === Download ===
app.post('/api/download', async (req, res) => {
  const { username, materialIndex, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ ok: false, error: '请先登录' });

  // Check device lock (skip for mobile)
  if (!isMobile) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.status(403).json({ ok: false, error: '设备不匹配，无法下载' });
      }
      if (lock.is_mobile) {
        return res.status(403).json({ ok: false, error: '手机设备仅支持预览，无法下载' });
      }
    }
  }

  const materials = getAllMaterials();
  const material = materials[materialIndex];
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip' ||
    (role === 'user' && material.cat === '表情包') ||
    (role === 'promo' && material.cat === '限时优惠');

  if (!canDl) return res.json({ ok: false, error: '权限不足，无法下载此素材' });

  // Increment download count
  db.prepare('UPDATE materials SET downloads = downloads + 1 WHERE id = ?').run(material.id);
  res.json({ ok: true, material: getMaterialWithFiles(material.id) });
});

// Track download (lightweight, no file data returned)
app.post('/api/download/track', async (req, res) => {
  const { username, materialId } = req.body;
  if (!username || !materialId) return res.json({ ok: false });
  db.prepare('UPDATE materials SET downloads = downloads + 1 WHERE id = ?').run(materialId);
  res.json({ ok: true });
});

// Download individual file by ID
app.get('/api/file/download/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  const file = db.prepare('SELECT * FROM material_files WHERE id = ?').get(fileId);
  if (!file) return res.status(404).json({ ok: false, error: '文件不存在' });
  
  const fs = require('fs');
  const path = require('path');
  
  // Convert relative path to absolute path
  const fullPath = path.join(__dirname, file.path);
  
  // Check if file exists on disk
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ ok: false, error: '文件不存在于服务器' });
  }
  
  // Set headers for file download
  const fileName = encodeURIComponent(file.name);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
  res.setHeader('Content-Type', file.mime || 'application/octet-stream');
  res.setHeader('Content-Length', file.size);
  
  // Send file
  const fileStream = fs.createReadStream(fullPath);
  fileStream.pipe(res);
});

// Download all materials as zip
app.post('/api/download-all', async (req, res) => {
  const { username, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ ok: false, error: '请先登录' });

  // Check device lock (skip for mobile)
  if (!isMobile) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.status(403).json({ ok: false, error: '设备不匹配，无法下载' });
      }
      if (lock.is_mobile) {
        return res.status(403).json({ ok: false, error: '手机设备仅支持预览，无法下载' });
      }
    }
  }

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip';
  if (!canDl) return res.status(403).json({ ok: false, error: '权限不足，仅管理员或VIP可下载全部素材' });

  const archiver = require('archiver');
  const archive = archiver("zip", { zlib: { level: 1 } });

  archive.on('error', (err) => {
    console.error('Archive error (all):', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: '打包失败: ' + err.message });
    } else {
      res.end();
    }
  });

  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''lizi-materials-all.zip");
    archive.pipe(res);
    
    const materials = db.prepare('SELECT * FROM materials ORDER BY id DESC').all();
    
    for (const mat of materials) {
      const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(mat.id);
      
      for (const file of files) {
        try {
          const fileStream = await readFromLocal(file.path);
          console.log('DEBUG fileStream:', typeof fileStream, fileStream?.constructor?.name, 'path:', file.path);
          if (fileStream) {
            const folder = toSimplified(mat.cat) || '未分类';
            const baseName = toSimplified(mat.name) || `material_${mat.id}`;
            const fileName = (file.name && /[\u4e00-\u9fa5]/.test(file.name)) ? toSimplified(file.name) : `file_${file.id}${file.ext}`;
            archive.append(fileStream, { name: `${folder}/${baseName}/${fileName}` });
          }
        } catch (e) {
          console.error(`Failed to add file ${file.name}:`, e.message);
        }
      }
    }
    
    await archive.finalize();
  } catch (e) {
    console.error('Download all error:', e);
    if (!res.headersSent) {
      res.json({ ok: false, error: '打包失败: ' + e.message });
    }
  }
});
// === Download Category ===
app.post('/api/download-category', async (req, res) => {
  const { username, deviceId, category } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ ok: false, error: '请先登录' });

  // Check device lock (skip for mobile)
  if (!isMobile) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.status(403).json({ ok: false, error: '设备不匹配，无法下载' });
      }
      if (lock.is_mobile) {
        return res.status(403).json({ ok: false, error: '手机设备仅支持预览，无法下载' });
      }
    }
  }

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip';
  if (!canDl) return res.status(403).json({ ok: false, error: '权限不足，仅管理员或VIP可下载素材' });

  if (!category) return res.status(400).json({ ok: false, error: '请指定分类' });

  const archiver = require('archiver');
  const archive = archiver("zip", { zlib: { level: 1 } });

  archive.on('error', (err) => {
    console.error('Archive error (category):', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: '打包失败: ' + err.message });
    } else {
      res.end();
    }
  });

  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''lizi-materials-${encodeURIComponent(category)}.zip`);
    archive.pipe(res);
    
    const materials = db.prepare('SELECT * FROM materials WHERE cat = ? ORDER BY id DESC').all(category);
    
    for (const mat of materials) {
      const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(mat.id);
      
      for (const file of files) {
        try {
          const fileStream = await readFromLocal(file.path);
          console.log('DEBUG fileStream:', typeof fileStream, fileStream?.constructor?.name, 'path:', file.path);
          if (fileStream) {
            const baseName = toSimplified(mat.name) || `material_${mat.id}`;
            const fileName = (file.name && /[\u4e00-\u9fa5]/.test(file.name)) ? toSimplified(file.name) : `file_${file.id}${file.ext}`;
            archive.append(fileStream, { name: `${baseName}/${fileName}` });
          }
        } catch (e) {
          console.error(`Failed to add file ${file.name}:`, e.message);
        }
      }
    }
    
    await archive.finalize();
  } catch (e) {
    console.error('Download category error:', e);
    if (!res.headersSent) {
      res.json({ ok: false, error: '打包失败: ' + e.message });
    }
  }
});

// === Requests ===
app.post('/api/requests', upload.array('images', 5), async (req, res) => {
  const { username, content, contact } = req.body;
  if (!content) return res.json({ ok: false, error: '请填写需求描述' });

  const imgPaths = [];
  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${crypto.randomUUID()}${ext}`;
    imgPaths.push(await saveToLocal(key, f.buffer, f.mimetype));
  }

  db.prepare('INSERT INTO requests (user, content, contact, images) VALUES (?, ?, ?, ?)')
    .run(username || '匿名', content, contact || '', JSON.stringify(imgPaths));

  // Notify admin
  const admins = db.prepare('SELECT username FROM users WHERE role = ?').all('admin');
  for (const admin of admins) {
    db.prepare('INSERT INTO notifications (user, from_user, message) VALUES (?, ?, ?)')
      .run(admin.username, username || '匿名', `收到新的素材需求: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
  }
  res.json({ ok: true });
});

app.get('/api/requests', (req, res) => {
  const requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  res.json({ ok: true, requests: requests.map(r => ({
    ...r,
    images: JSON.parse(r.images || '[]')
  }))});
});

app.delete('/api/requests/:id', async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!user) return res.json({ ok: false, error: '权限不足' });
  db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// === Notifications ===
app.get('/api/notifications', (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE user = ? ORDER BY time DESC').all(req.query.username);
  const unread = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user = ? AND is_read = 0').get(req.query.username).cnt;
  res.json({ ok: true, notifications: notifs, unread });
});

app.post('/api/notifications/read', async (req, res) => {
  const { username } = req.body;
  // Verify user exists
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '用户不存在' });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user = ?').run(username);
  res.json({ ok: true });
});

// === Bindings ===
app.post('/api/bindings', async (req, res) => {
  const { username, platform, platformAccount } = req.body;
  if (!platform || !platformAccount) return res.json({ ok: false, error: '请填写完整信息' });
  const existing = db.prepare('SELECT id FROM bindings WHERE username = ? AND platform = ?').get(username, platform);
  if (existing) {
    db.prepare('UPDATE bindings SET platform_account = ? WHERE username = ? AND platform = ?').run(platformAccount, username, platform);
  } else {
    db.prepare('INSERT INTO bindings (username, platform, platform_account) VALUES (?, ?, ?)').run(username, platform, platformAccount);
  }
  res.json({ ok: true });
});

app.get('/api/bindings', (req, res) => {
  const bindings = db.prepare('SELECT * FROM bindings WHERE username = ? ORDER BY bind_time DESC').all(req.query.username);
  res.json({ ok: true, bindings });
});

app.delete('/api/bindings/:platform', async (req, res) => {
  const { username } = req.body;
  db.prepare('DELETE FROM bindings WHERE username = ? AND platform = ?').run(username, req.params.platform);
  res.json({ ok: true });
});

app.get('/api/bindings/all', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.query.username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  const users = db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all();
  const usersWithBindings = users.map(u => {
    const bindings = db.prepare('SELECT * FROM bindings WHERE username = ?').all(u.username);
    return { ...u, bindings };
  });
  res.json({ ok: true, users: usersWithBindings });
});

// === Save Current Version to lizi-new ===
app.post('/api/save-version', async (req, res) => {
  const { username } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足，仅管理员可操作' });
  
  const fs = require('fs');
  const path = require('path');
  const execSync = require('child_process').execSync;
  
  const srcBase = '/opt/hiubaby/lizi-materials';
  const destBase = '/opt/hiubaby/lizi-new';
  
  // Files to copy (relative paths)
  const filesToCopy = [
    'server.js',
    'public/index.html',
    'public/style.css',
    'public/ai-image.html',
    'public/app.js'
  ];
  
  const copiedFiles = [];
  const errors = [];
  
  for (const file of filesToCopy) {
    const src = path.join(srcBase, file);
    const dest = path.join(destBase, file);
    try {
      if (!fs.existsSync(src)) {
        errors.push(file + ' (来源不存在)');
        continue;
      }
      // Create dest dir if needed
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      // Backup existing file in dest
      if (fs.existsSync(dest)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = dest + '.bak.' + timestamp;
        fs.copyFileSync(dest, backupPath);
      }
      fs.copyFileSync(src, dest);
      copiedFiles.push(file);
    } catch(e) {
      errors.push(file + ': ' + e.message);
    }
  }
  
  console.log(`Save version: copied ${copiedFiles.length} files to lizi-new`);
  if (errors.length) console.log('Errors:', errors);
  
  res.json({ 
    ok: errors.length === 0, 
    files: copiedFiles,
    errors: errors.length > 0 ? errors : undefined
  });
});
// === Snapshot Save/Restore (manual only) ===
app.post('/api/snapshot/save', async (req, res) => {
  const { username } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足，仅管理员可操作' });
  
  try {
    const count = await saveSnapshot();
    res.json({ ok: true, message: `已保存 ${count} 个素材到快照`, materialCount: count });
  } catch (e) {
    res.json({ ok: false, error: '保存快照失败: ' + e.message });
  }
});

app.post('/api/snapshot/restore', async (req, res) => {
  const { username } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足，仅管理员可操作' });
  
  try {
    const count = await restoreSnapshot();
    res.json({ ok: true, message: `已从快照恢复 ${count} 个素材`, materialCount: count, materials: getAllMaterials() });
  } catch (e) {
    res.json({ ok: false, error: '恢复快照失败: ' + e.message });
  }
});

// === Audio Transcription (local whisper.cpp) ===
const { execFile } = require('child_process');
const os = require('os');

const WHISPER_BIN = '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-tiny.bin';

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, error: 'No audio file provided' });

  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inputFile = path.join(tmpDir, `audio_${id}.webm`);
  const wavFile = path.join(tmpDir, `audio_${id}.wav`);

  try {
    // Save uploaded audio to temp file
    fs.writeFileSync(inputFile, req.file.buffer);

    // Convert to 16kHz mono WAV using ffmpeg
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-i', inputFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavFile],
        { timeout: 30000 }, (err) => err ? reject(err) : resolve());
    });

    // Run whisper.cpp
    const output = await new Promise((resolve, reject) => {
      execFile(WHISPER_BIN, [
        '-m', WHISPER_MODEL,
        '-f', wavFile,
        '-l', 'zh',
        '-oj',  // output JSON with segments
        '-of', path.join(tmpDir, `whisper_${id}`)
      ], { timeout: 120000 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Read whisper JSON output
    const jsonFile = path.join(tmpDir, `whisper_${id}.json`);
    let data;
    if (fs.existsSync(jsonFile)) {
      data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    } else {
      // Fallback: run again with text output
      const textOutput = await new Promise((resolve, reject) => {
        execFile(WHISPER_BIN, [
          '-m', WHISPER_MODEL, '-f', wavFile, '-l', 'zh', '--no-timestamps'
        ], { timeout: 120000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
      });
      data = { text: textOutput, segments: [] };
    }

    // Parse segments
    const segments = (data.transcription || data.segments || []).map(seg => ({
      time: seg.offsets ? seg.offsets.from / 1000 : (seg.start || 0),
      text: (seg.text || '').trim()
    })).filter(s => s.text);

    const fullText = data.text || segments.map(s => s.text).join('');

    // Cleanup temp files
    [inputFile, wavFile, jsonFile].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    res.json({ ok: true, text: fullText, segments });
  } catch (e) {
    console.error('[Transcribe] Error:', e.message);
    // Cleanup
    [inputFile, wavFile].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.json({ ok: false, error: e.message });
  }
});

// === SEO: sitemap & robots.txt ===

app.get('/robots.txt', (req, res) => {
  const baseUrl = getSiteURL(req);
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${baseUrl}/sitemap.xml`
  ].join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = getSiteURL(req);
  let materials = [];
  try {
    materials = db.prepare('SELECT id, cat, name, created_at FROM materials ORDER BY sort_order DESC, id DESC').all();
  } catch (e) {}

  const now = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: baseUrl + '/', changefreq: 'daily', priority: '1.0', lastmod: now },
    { loc: baseUrl + '/cat/%E4%BA%BA%E7%89%A9', changefreq: 'daily', priority: '0.9', lastmod: now },
    { loc: baseUrl + '/cat/%E8%A1%A8%E6%83%85%E5%8C%85', changefreq: 'daily', priority: '0.8', lastmod: now },
    { loc: baseUrl + '/cat/%E7%94%BB%E5%B8%88%E5%AF%84%E5%94%AE', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E8%83%8C%E6%99%AF%E5%9B%BE', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E9%81%93%E5%85%B7%E6%A0%8F', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E7%89%B9%E6%95%88', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E9%99%90%E6%97%B6%E4%BC%98%E6%83%A0', changefreq: 'weekly', priority: '0.6', lastmod: now },
  ];

  materials.forEach(m => {
    urls.push({
      loc: `${baseUrl}/cat/${encodeURIComponent(m.cat)}?id=${m.id}`,
      changefreq: 'monthly',
      priority: '0.5',
      lastmod: (m.created_at || now).split(' ')[0]
    });
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`),
    '</urlset>'
  ].join('\n');

  res.type('application/xml');
  res.send(xml);
});

// === Diagnostic Endpoint (test R2 upload/download) ===

// === Multer Error Handler (must be after all routes) ===
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error(`[Multer Error] code=${err.code} message="${err.message}" field=${err.field || 'N/A'}`);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: `文件过大（最大允许 100MB）` });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({ ok: false, error: `文件数量过多（最多 20 个）` });
    }
    return res.status(400).json({ ok: false, error: `文件上传错误：${err.message}` });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

// === Start ===
async function setupDBSync() {
  await initDB();
  
  // Migration: fix category names
  const migrations = [
    { from: '背景', to: '背景图' },
    { from: '道具', to: '道具栏' }
  ];

  // Clean up stale is_snapshot column from old DB versions
  try {
    db.prepare('UPDATE materials SET is_snapshot = 0 WHERE is_snapshot = 1').run();
  } catch (e) {}

  for (const m of migrations) {
    const result = db.prepare('UPDATE materials SET cat = ? WHERE cat = ?').run(m.to, m.from);
    if (result.changes > 0) {
      console.log(`Migration: ${result.changes} materials updated from "${m.from}" to "${m.to}"`);
    }
  }
  
  console.log('DB setup complete');
}

// === AI Maintenance Settings API ===
app.get("/api/settings/ai-maintenance", (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM site_settings WHERE key = ?").get("ai_maintenance");
    res.json({ maintenance: row ? row.value === "true" : false });
  } catch (err) {
    console.error("Get AI maintenance setting error:", err);
    res.status(500).json({ error: "获取设置失败" });
  }
});

app.put("/api/settings/ai-maintenance", (req, res) => {
  try {
    const { username, enabled } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = ?").get(username, "admin");
    if (!user) return res.status(403).json({ error: "权限不足" });
    const val = enabled ? "true" : "false";
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run("ai_maintenance", val);
    console.log("[Settings] AI maintenance set to:", val, "by", username);
    res.json({ success: true, maintenance: enabled });
  } catch (err) {
    console.error("Set AI maintenance error:", err);
    res.status(500).json({ error: "设置失败" });
  }
});

// === Voice Maintenance Mode ===
app.get("/api/settings/voice-maintenance", (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM site_settings WHERE key = ?").get("voice_maintenance");
    res.json({ maintenance: row ? row.value === "true" : false });
  } catch (err) {
    console.error("Get voice maintenance setting error:", err);
    res.status(500).json({ error: "获取设置失败" });
  }
});

app.put("/api/settings/voice-maintenance", (req, res) => {
  try {
    const { username, enabled } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = ?").get(username, "admin");
    if (!user) return res.status(403).json({ error: "权限不足" });
    const val = enabled ? "true" : "false";
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run("voice_maintenance", val);
    console.log("[Settings] Voice maintenance set to:", val, "by", username);
    res.json({ success: true, maintenance: enabled });
  } catch (err) {
    console.error("Set voice maintenance error:", err);
    res.status(500).json({ error: "设置失败" });
  }
});

// === Multiview maintenance mode ===
app.get("/api/settings/multiview-maintenance", (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM site_settings WHERE key = ?").get("multiview_maintenance");
    const maintenance = row ? row.value === "true" : false;
    res.json({ maintenance });
  } catch (err) {
    console.error("Get multiview maintenance error:", err);
    res.json({ maintenance: false });
  }
});

app.put("/api/settings/multiview-maintenance", (req, res) => {
  try {
    const { username, enabled } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = ?").get(username, "admin");
    if (!user) return res.status(403).json({ error: "权限不足" });
    const val = enabled ? "true" : "false";
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run("multiview_maintenance", val);
    console.log("[Settings] Multiview maintenance set to:", val, "by", username);
    res.json({ success: true, maintenance: enabled });
  } catch (err) {
    console.error("Set multiview maintenance error:", err);
    res.status(500).json({ error: "设置失败" });
  }
});

// === WAN local file serving ===
app.use('/wan-files', express.static(path.join(__dirname, 'data', 'wan-uploads'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));
// 参考图片静态路由
app.use('/data/wan-ref', express.static(path.join(__dirname, 'data', 'wan-ref'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));
// 输出图片静态路由
app.use('/data/wan-output', express.static(path.join(__dirname, 'data', 'wan-output'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));
// 素材上傳檔案静态路由
app.use('/data/uploads', express.static(path.join(__dirname, 'data', 'uploads'), {
  maxAge: '30d',
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));
// === 多模型圖片生成 (智增增API) ===
let ZHIZENGENG_API_KEY = process.env.ZHIZENGENG_API_KEY;
const ZHIZENGENG_BASE_URL = process.env.ZHIZENGENG_BASE_URL || 'https://api.zhizengzeng.com';
const WAN_USAGE_PATH = path.join(__dirname, 'data', 'wan_usage.json');
const DAILY_FREE_CALLS = 10;  // 每天免費次數 10 次（所有模型共享）

// 模型配置：
//   type: 'openai' = 同步 OpenAI 兼容格式 (images/generations 或 images/edits)
//   type: 'alibaba' = 異步阿里千問格式 (需輪詢)
//   supportsI2I: 是否支持圖生圖
const IMAGE_MODELS = {
  // === OpenAI GPT Image 系列 (預設 16:9) ===
  'gpt-image-1': {
    type: 'openai',
    apiPath: '/v1/images/generations',
    editPath: '/v1/images/edits',
    priceCny: 0.29,
    label: 'GPT-Image (標準)',
    sizeParam: 'size',
    defaultSize: '1536x1024',
    sizeMap: { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' },
    supportsI2I: true
  },
  'gpt-image-1.5': {
    type: 'openai',
    apiPath: '/v1/images/generations',
    editPath: '/v1/images/edits',
    priceCny: 0.29,
    label: 'GPT-Image 1.5',
    sizeParam: 'size',
    defaultSize: '1536x1024',
    sizeMap: { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' },
    supportsI2I: true
  },
  // === WAN 2.6 (< 0.30 CNY/image) ===
  "gpt-image-2": {
    type: "openai",
    apiPath: "/v1/images/generations",
    editPath: "/v1/images/edits",
    priceCny: 1.30,
    label: "GPT-Image 2 (旗艦)",
    sizeParam: "size",
    defaultSize: "1536x1024",
    sizeMap: { "1:1": "1024x1024", "16:9": "1536x1024", "9:16": "1024x1536" },
    supportsI2I: true
  },
  "wan2.6-image": {
    type: "alibaba",
    apiPath: "/alibaba/api/v1/services/aigc/multimodal-generation/generation",
    priceCny: 0.14,
    label: "Wan2.6 Image",
    sizeParam: "size",
    defaultSize: "1024*1024",
    sizeMap: { "1:1": "1024*1024", "16:9": "1280*720", "9:16": "720*1280" },
    supportsI2I: true,
    imageInContent: true
  },
};

function loadWanUsage() {
  try {
    if (fs.existsSync(WAN_USAGE_PATH)) {
      return JSON.parse(fs.readFileSync(WAN_USAGE_PATH, 'utf-8'));
    }
  } catch (e) { console.error('loadWanUsage error:', e.message); }
  return {};
}

function saveWanUsage(data) {
  fs.writeFileSync(WAN_USAGE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// 获取用戶今日用量数据，自动初始化/重置
function getUserUsage(username) {
  const today = new Date().toISOString().slice(0, 10);
  const allUsage = loadWanUsage();
  let userData = allUsage[username];
  if (!userData || userData.date !== today) {
    userData = { date: today, calls: 0, models: {} };
    allUsage[username] = userData;
    saveWanUsage(allUsage);
  }
  // 兼容旧格式（遷移 spent 到 calls）
  if (typeof userData.calls !== 'number') {
    let totalCalls = 0;
    for (const count of Object.values(userData.models || {})) {
      totalCalls += count;
    }
    userData.calls = totalCalls;
    delete userData.spent;
    allUsage[username] = userData;
    saveWanUsage(allUsage);
  }
  return { allUsage, userData, today };
}

// 检查用户是否还能用某模型（返回剩余预算和次数）

// 检查用户是否为管理员
function isAdmin(username) {
  try {
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username);
    return user && user.role === 'admin';
  } catch (e) {
    return false;
  }
}

function getUsageInfo(username, modelKey) {
  const { userData } = getUserUsage(username);
  const model = IMAGE_MODELS[modelKey];
  if (!model) return null;
  const isAdminUser = isAdmin(username);
  const remaining = Math.max(0, DAILY_FREE_CALLS - userData.calls);
  const canUse = isAdminUser || remaining > 0;
  const maxCalls = isAdminUser ? 9999 : remaining;
  const used = userData.models[modelKey] || 0;
  return {
    label: model.label,
    priceCny: model.priceCny,
    used: used,
    canUse: canUse,
    maxCalls: maxCalls,
    calls: userData.calls,
    freeCalls: DAILY_FREE_CALLS,
    remaining: remaining,
    isAdmin: isAdminUser
  };
}

// 构建所有模型的用量概览
function buildModelsOverview(username) {
  const { userData } = getUserUsage(username);
  const calls = userData.calls || 0;
  const remaining = Math.max(0, DAILY_FREE_CALLS - calls);
  const isAdminUser = isAdmin(username);
  const models = {};
  for (const [key, model] of Object.entries(IMAGE_MODELS)) {
    const used = userData.models[key] || 0;
    models[key] = {
      label: model.label,
      priceCny: model.priceCny,
      used: used,
      maxCalls: isAdminUser ? 9999 : remaining,
      canUse: isAdminUser || remaining > 0
    };
  }
  return {
    date: userData.date,
    calls: calls,
    freeCalls: DAILY_FREE_CALLS,
    remaining: remaining,
    models,
    isAdmin: isAdminUser
  };
}

// GET /api/ai/wan/usage - 返回用量概览（共享预算）
app.get('/api/ai/wan/usage', (req, res) => {
  const username = req.headers['x-username'];
  if (!username) return res.status(401).json({ error: '请先登录' });
  res.json(buildModelsOverview(username));
});

// GET /api/ai/wan/models - 返回可用模型列表
app.get('/api/ai/wan/models', (req, res) => {
  const models = {};
  for (const [key, model] of Object.entries(IMAGE_MODELS)) {
    models[key] = {
      label: model.label,
      priceCny: model.priceCny
    };
  }
  res.json(models);
});

// POST /api/ai/host-image - Upload reference image to COS
app.post('/api/ai/host-image', upload.single('image'), async (req, res) => {
  const username = req.headers['x-username'];
  if (!username) return res.status(401).json({ error: '请先登录' });
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  
  try {
    const ext = path.extname(req.file.originalname) || '.png';
    const filename = crypto.randomUUID() + ext;
    
    // Try R2 first, fallback to local storage
    let url;
    try {
      const key = 'wan-ref/' + filename;
      url = await saveToLocal(key, req.file.buffer, req.file.mimetype);
      console.log('[IMG] Hosted image uploaded to R2:', url);
    } catch (r2Err) {
      // R2 not configured, use local storage
      const localDir = path.join(__dirname, 'public', 'uploads', 'ai-ref');
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      const localPath = path.join(localDir, filename);
      fs.writeFileSync(localPath, req.file.buffer);
      url = '/uploads/ai-ref/' + filename;
      console.log('[IMG] Hosted image saved locally:', url);
    }
    
    res.json({ url });
  } catch (e) {
    console.error('[IMG] Host image error:', e.message);
    res.status(500).json({ error: '上传失败: ' + e.message });
  }
});

// POST /api/ai/wan/generate - 多模型生成（支持同步OpenAI和异步阿里两种格式）
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 辅助：下载图片URL转为Buffer
function resolveImageUrl(url) {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
  // Relative path - prepend site base URL
  const base = process.env.SITE_URL || "https://lizisucaiwang.online";
  return base + (url.startsWith("/") ? "" : "/") + url;
}

async function downloadImageBuffer(url) {
  const resolvedUrl = resolveImageUrl(url);
  try {
    const resp = await fetch(resolvedUrl);
    if (!resp.ok) {
      console.error('[IMG] Download failed:', resolvedUrl.substring(0, 100), 'Status:', resp.status);
      throw new Error('下载图片失败: ' + resp.status);
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.error('[IMG] Download error:', err.message, 'URL:', resolvedUrl.substring(0, 100));
    throw err;
  }
}

// 辅助：保存图片Buffer到存储，返回永久URL
async function saveImageToStorage(imgBuffer) {
  try {
    const key = 'wan-output/' + crypto.randomUUID() + '.png';
    const permanentUrl = await saveToLocal(key, imgBuffer, 'image/png');
    return permanentUrl;
  } catch (e) {
    // 本地存储 fallback
    const localDir = path.join(__dirname, 'public', 'uploads', 'ai-output');
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    const filename = crypto.randomUUID() + '.png';
    fs.writeFileSync(path.join(localDir, filename), imgBuffer);
    return '/uploads/ai-output/' + filename;
  }
}

// === OpenAI 同步模式 ===
async function generateOpenAI(modelKey, modelConfig, prompt, image_url, size) {
  let images = [];
  
  if (image_url && modelConfig.supportsI2I && modelConfig.editPath) {
    // 图生图 - 使用 images/edits (需要 FormData)
    const imgBuffer = await downloadImageBuffer(image_url);
    const formData = new FormData();
    formData.append('model', modelKey);
    formData.append('prompt', prompt);
    formData.append('n', '1');
    let i2iSize = modelConfig.defaultSize;
    if (size) {
      if (modelConfig.sizeMap && modelConfig.sizeMap[size]) i2iSize = modelConfig.sizeMap[size];
      else if (/^\d+x\d+$/.test(size)) i2iSize = size;
    }
    formData.append('size', i2iSize);
    // 创建Blob并附加
    const blob = new Blob([imgBuffer], { type: 'image/png' });
    formData.append('image', blob, 'input.png');
    
    console.log('[IMG] OpenAI i2i request for', modelKey);
    const apiResp = await fetch(ZHIZENGENG_BASE_URL + modelConfig.editPath, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ZHIZENGENG_API_KEY },
      body: formData
    });
    
    const data = await apiResp.json();
    if (!apiResp.ok || data.error) {
      throw new Error(data.error?.message || data.error || '图片编辑失败');
    }
    // OpenAI返回base64或url
    if (data.data) {
      for (const item of data.data) {
        if (item.b64_json) {
          images.push(Buffer.from(item.b64_json, 'base64'));
        } else if (item.url) {
          images.push(await downloadImageBuffer(item.url));
        }
      }
    }
  } else {
    // 文生图 - 使用 images/generations (JSON)
    // 映射尺寸：前端可能发送 '16:9' 等比例格式，需要转换为API支持的尺寸
    let actualSize = modelConfig.defaultSize;
    if (size) {
      if (modelConfig.sizeMap && modelConfig.sizeMap[size]) {
        actualSize = modelConfig.sizeMap[size];
      } else if (/^\d+x\d+$/.test(size)) {
        actualSize = size; // 已经是 WxH 格式
      }
      // 其他格式（如 '16:9'）使用默认尺寸
    }
    const requestBody = { model: modelKey, prompt, n: 1, size: actualSize };
    
    console.log('[IMG] OpenAI t2i request for', modelKey, '- prompt:', prompt.substring(0, 50));
    const apiResp = await fetch(ZHIZENGENG_BASE_URL + modelConfig.apiPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ZHIZENGENG_API_KEY
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await apiResp.json();
    if (!apiResp.ok || data.error) {
      throw new Error(data.error?.message || data.error || '图片生成失败');
    }
    if (data.data && data.data.length > 0) {
      for (const item of data.data) {
        if (item.b64_json) {
          images.push(Buffer.from(item.b64_json, 'base64'));
        } else if (item.url) {
          images.push(await downloadImageBuffer(item.url));
        }
      }
    }
  }
  
  return images; // 返回图片Buffer数组
}

// === 阿里千問同步模式 ===
async function generateAlibaba(modelKey, modelConfig, prompt, image_url, size) {
  // 构建阿里千问 API 请求体
  const requestBody = {
    model: modelKey,
    input: {
      messages: [
        {
          role: "user",
          content: [{ text: prompt }]
        }
      ]
    },
    parameters: {
      n: 1
    }
  };
  
  // 添加尺寸参数
  let actualSize = modelConfig.defaultSize;
  if (size) {
    if (modelConfig.sizeMap && modelConfig.sizeMap[size]) {
      actualSize = modelConfig.sizeMap[size];
    } else if (/^\d+\*\d+$/.test(size)) {
      actualSize = size;
    }
  }
  requestBody.parameters.size = actualSize;
  
  // 如果有参考图片：转换为 base64 格式
  if (image_url && modelConfig.supportsI2I) {
    try {
      const imgBuffer = await downloadImageBuffer(image_url);
      const base64Image = 'data:image/png;base64,' + imgBuffer.toString('base64');
      if (modelConfig.imageInContent) {
        requestBody.input.messages[0].content.unshift({ image: base64Image });
      } else {
        requestBody.parameters.ref_image_url = base64Image;
      }
      console.log('[IMG] Alibaba i2i: converted image to base64, size:', imgBuffer.length);
    } catch (e) {
      console.error('[IMG] Alibaba i2i: failed to convert image to base64:', e.message);
      throw new Error('無法處理參考圖片: ' + e.message);
    }
  }
  
  console.log('[IMG] Alibaba sync request for', modelKey, '- prompt:', prompt.substring(0, 50));
  
  const apiResp = await fetch(ZHIZENGENG_BASE_URL + modelConfig.apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ZHIZENGENG_API_KEY
    },
    body: JSON.stringify(requestBody)
  });
  
  const result = await apiResp.json();
  
  console.log('[IMG] Alibaba API response:', JSON.stringify(result).substring(0, 500));
  
  if (!apiResp.ok) {
    console.error('[IMG] Alibaba API error:', JSON.stringify(result).substring(0, 500));
    throw new Error(result.message || result.error?.message || '阿里 API 调用失败');
  }
  
  // 提取图片 URL
  const images = [];
  if (result.output?.choices) {
    for (const choice of result.output.choices) {
      if (choice.message?.content) {
        for (const item of choice.message.content) {
          if (item.image) {
            images.push(await downloadImageBuffer(item.image));
          }
        }
      }
    }
  }
  
  if (images.length === 0) {
    throw new Error('阿里 API 未返回图片');
  }
  
  return images;
}


// === Google Gemini 模式 ===
async function generateGemini(modelKey, modelConfig, prompt, image_url, size) {
  // 構建 Gemini API 請求
  const parts = [{ text: prompt }];
  
  // 如果有參考圖片，加入 inline_data
  if (image_url && modelConfig.supportsI2I) {
    const imgBuffer = await downloadImageBuffer(image_url);
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: imgBuffer.toString('base64')
      }
    });
  }
  
  // 構建請求體
  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT']
    }
  };
  
  // 設定 aspect ratio
  let aspectRatio = modelConfig.defaultSize || '16:9';
  if (size) {
    if (modelConfig.sizeMap && modelConfig.sizeMap[size]) {
      aspectRatio = modelConfig.sizeMap[size];
    } else if (/^\d+:\d+$/.test(size)) {
      aspectRatio = size;
    }
  }
  // aspectRatio via responseModalities only; responseFormat not supported by zhizengzeng proxy
  // aspectRatio hint added to prompt instead if needed
  
  console.log('[IMG] Gemini request for', modelKey, '- aspectRatio:', aspectRatio);
  
  // 智增增 Gemini API URL 格式
  const geminiUrl = ZHIZENGENG_BASE_URL.replace('/v1', '') + '/google/v1beta/models/' + modelKey + ':generateContent';
  
  const apiResp = await fetch(geminiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': ZHIZENGENG_API_KEY
    },
    body: JSON.stringify(requestBody)
  });
  
  const result = await apiResp.json();
  
  if (!apiResp.ok) {
    console.error('[IMG] Gemini API error:', JSON.stringify(result).substring(0, 500));
    throw new Error(result.error?.message || 'Gemini API 調用失敗');
  }
  
  // 提取圖片 (base64 inline_data)
  const images = [];
  const candidates = result.candidates || [];
  for (const candidate of candidates) {
    const contentParts = candidate.content?.parts || [];
    for (const part of contentParts) {
      if (part.inline_data?.data) {
        images.push(Buffer.from(part.inline_data.data, 'base64'));
      } else if (part.inlineData?.data) {
        images.push(Buffer.from(part.inlineData.data, 'base64'));
      }
    }
  }
  
  if (images.length === 0) {
    throw new Error('Gemini API 未返回图片');
  }
  
  return images;
}

// === Grok (xAI) 模式 ===
async function generateGrok(modelKey, modelConfig, prompt, image_url, size) {
  const requestBody = {
    model: modelKey,
    prompt: prompt,
    n: 1,
    response_format: "b64_json"
  };
  
  // 只有当 sizeParam 存在时才添加 size
  if (modelConfig.sizeParam && modelConfig.defaultSize) {
    let actualSize = modelConfig.defaultSize;
    if (size) {
      if (modelConfig.sizeMap && modelConfig.sizeMap[size]) {
        actualSize = modelConfig.sizeMap[size];
      } else if (/^\d+x\d+$/.test(size)) {
        actualSize = size;
      }
    }
    requestBody.size = actualSize;
  }
  
  // Grok 不支持图生图，直接使用文生图
  console.log('[IMG] Grok t2i request for', modelKey, '- prompt:', prompt.substring(0, 50));
  const apiResp = await fetch(ZHIZENGENG_BASE_URL + modelConfig.apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ZHIZENGENG_API_KEY
    },
    body: JSON.stringify(requestBody)
  });
  
  const data = await apiResp.json();
  if (!apiResp.ok || data.error) {
    throw new Error(data.error?.message || data.error || 'Grok 图片生成失败');
  }
  
  const images = [];
  if (data.data && data.data.length > 0) {
    for (const item of data.data) {
      if (item.b64_json) {
        images.push(Buffer.from(item.b64_json, 'base64'));
      } else if (item.url) {
        images.push(await downloadImageBuffer(item.url));
      }
    }
  }
  return images;
}

// === 字节豆包 Doubao/Seedream 模式 ===
async function generateDoubao(modelKey, modelConfig, prompt, image_url, size) {
  const requestBody = {
    model: modelKey,
    prompt: prompt,
    n: 1
  };

  let actualSize = modelConfig.defaultSize;
  if (size) {
    if (modelConfig.sizeMap && modelConfig.sizeMap[size]) actualSize = modelConfig.sizeMap[size];
    else if (/^\d+x\d+$/.test(size)) actualSize = size;
  }
  requestBody.size = actualSize;

  if (image_url && modelConfig.supportsI2I) {
    requestBody.image = resolveImageUrl(image_url);
    console.log('[IMG] Doubao i2i for', modelKey);
  } else {
    console.log('[IMG] Doubao t2i for', modelKey, '- prompt:', prompt.substring(0, 50));
  }

  const apiResp = await fetch(ZHIZENGENG_BASE_URL + modelConfig.apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ZHIZENGENG_API_KEY
    },
    body: JSON.stringify(requestBody)
  });

  const data = await apiResp.json();
  if (!apiResp.ok || data.error) {
    console.error('[IMG] Doubao API error:', JSON.stringify(data).substring(0, 500));
    throw new Error(data.error?.message || data.error || '豆包 图片生成失败');
  }

  const images = [];
  if (data.data) {
    for (const item of data.data) {
      if (item.b64_json) {
        images.push(Buffer.from(item.b64_json, 'base64'));
      } else if (item.url) {
        images.push(await downloadImageBuffer(item.url));
      }
    }
  }
  return images;
}

// === Qwen 通义万相模式 ===
async function generateQwen(modelKey, modelConfig, prompt, image_url, size) {
  const requestBody = {
    model: modelKey,
    prompt: prompt,
    n: 1
  };

  let actualSize = modelConfig.defaultSize;
  if (size) {
    if (modelConfig.sizeMap && modelConfig.sizeMap[size]) actualSize = modelConfig.sizeMap[size];
    else if (/^\d+x\d+$/.test(size)) actualSize = size;
  }
  requestBody.size = actualSize;

  if (image_url && modelConfig.supportsI2I) {
    requestBody.image = resolveImageUrl(image_url);
    console.log('[IMG] Qwen i2i for', modelKey, '- image:', requestBody.image.substring(0, 100));
  } else {
    console.log('[IMG] Qwen t2i for', modelKey, '- prompt:', prompt.substring(0, 50));
  }

  const apiResp = await fetch(ZHIZENGENG_BASE_URL + modelConfig.apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ZHIZENGENG_API_KEY
    },
    body: JSON.stringify(requestBody)
  });

  const data = await apiResp.json();
  if (!apiResp.ok || data.error) {
    console.error('[IMG] Qwen API error:', JSON.stringify(data).substring(0, 500));
    throw new Error(data.error?.message || data.error || 'Qwen 图片生成失败');
  }

  const images = [];
  if (data.data) {
    for (const item of data.data) {
      if (item.b64_json) {
        images.push(Buffer.from(item.b64_json, 'base64'));
      } else if (item.url) {
        images.push(await downloadImageBuffer(item.url));
      }
    }
  }
  return images;
}

// === 主生成接口 ===
app.post('/api/ai/wan/generate', async (req, res) => {
  const username = req.headers['x-username'];
  if (!username) return res.status(401).json({ error: '请先登录' });
  
  const { prompt, model: modelKey, size, image_url } = req.body;
  if (!prompt) return res.status(400).json({ error: '请输入提示词' });
  
  const modelConfig = IMAGE_MODELS[modelKey];
  if (!modelConfig) {
    return res.status(400).json({ error: '不支持的模型: ' + modelKey });
  }
  
  // 检查配额（所有模型共享每日预算，管理员不限）
  const usageInfo = getUsageInfo(username, modelKey);
  if (!usageInfo.canUse) {
    return res.status(429).json({
      error: `今日免費次數已用完（已用 ${usageInfo.calls} / ${usageInfo.freeCalls} 次）`,
      overview: buildModelsOverview(username)
    });
  }
  
  try {
    console.log('[IMG]', modelConfig.label, 'for', username, '- prompt:', prompt.substring(0, 50));
    
    let imageBuffers = [];
    
    if (modelConfig.type === 'openai') {
      imageBuffers = await generateOpenAI(modelKey, modelConfig, prompt, image_url, size);
    } else if (modelConfig.type === 'qwen') {
      imageBuffers = await generateQwen(modelKey, modelConfig, prompt, image_url, size);
    } else if (modelConfig.type === 'alibaba') {
      imageBuffers = await generateAlibaba(modelKey, modelConfig, prompt, image_url, size);
    } else if (modelConfig.type === 'grok') {
      imageBuffers = await generateGrok(modelKey, modelConfig, prompt, image_url, size);
    } else if (modelConfig.type === 'doubao') {
      imageBuffers = await generateDoubao(modelKey, modelConfig, prompt, image_url, size);
    } else if (modelConfig.type === 'gemini') {
      imageBuffers = await generateGemini(modelKey, modelConfig, prompt, image_url, size);
    } else {
      throw new Error('未知的模型类型: ' + modelConfig.type);
    }
    
    if (imageBuffers.length === 0) {
      throw new Error('未生成任何图片');
    }
    
    // 保存所有图片到存储
    const finalImages = [];
    for (const buf of imageBuffers) {
      const url = await saveImageToStorage(buf);
      finalImages.push(url);
    }
    
    // 更新用量（共享预算）
    const { allUsage, userData } = getUserUsage(username);
    userData.models[modelKey] = (userData.models[modelKey] || 0) + 1;
    userData.calls = (userData.calls || 0) + 1;
    allUsage[username] = userData;
    saveWanUsage(allUsage);
    
    console.log('[IMG]', modelConfig.label, 'done for', username, 
      '(calls: ' + userData.calls + '/' + DAILY_FREE_CALLS + ')');
    
    // 保存生成记录
    try {
      db.prepare(`INSERT INTO wan_generation_history (username, model, prompt, input_image, output_images) VALUES (?, ?, ?, ?, ?)`)
        .run(username, modelKey, prompt, image_url || '', JSON.stringify(finalImages));
    } catch (histErr) {
      console.warn('[IMG] Failed to save history:', histErr.message);
    }
    
    res.json({
      images: finalImages,
      overview: buildModelsOverview(username)
    });
  } catch (e) {
    console.error('[IMG] Generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 清理7天前的生成记录
function cleanupWanHistory() {
  try {
    const result = db.prepare(`DELETE FROM wan_generation_history WHERE created_at < datetime('now', '-7 days')`).run();
    if (result.changes > 0) {
      console.log('[WAN] Cleaned up', result.changes, 'old generation records');
    }
  } catch (e) {
    console.error('[WAN] History cleanup error:', e.message);
  }
}

// GET /api/ai/wan/history - 获取生成历史
app.get('/api/ai/wan/history', (req, res) => {
  const username = req.headers['x-username'];
  if (!username) return res.status(401).json({ error: '请先登录' });
  
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  
  try {
    const rows = db.prepare(`SELECT * FROM wan_generation_history WHERE username = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(username, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM wan_generation_history WHERE username = ?`).get(username).count;
    
    res.json({
      records: rows.map(r => ({
        id: r.id,
        model: r.model,
        prompt: r.prompt,
        input_image: r.input_image,
        output_images: JSON.parse(r.output_images || '[]'),
        created_at: r.created_at
      })),
      total,
      limit,
      offset
    });
  } catch (e) {
    console.error('[WAN] History fetch error:', e.message);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

// === Image Upload for i2v (Image-to-Video) ===
const uploadForVideo = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'public', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, 'iv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('只接受图片文件'));
    cb(null, true);
  }
});

app.post('/api/upload-image', uploadForVideo.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const url = 'https://lizisucaiwang.online/uploads/' + req.file.filename;
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Sora 2 Video API Proxy ===
const APIYI_VIDEO_KEY = process.env.APIYI_VIDEO_KEY;
const APIYI_VIDEO_URL = process.env.APIYI_VIDEO_URL || "https://api.zhizengzeng.com";

app.post('/api/video/generate', async (req, res) => {
  try {
    const { model, prompt, seconds, size, image_url } = req.body;
    if (!model || !prompt) return res.status(400).json({ error: '缺少必要参数' });
    
    // Build request body - include image_url for i2v (image-to-video)
    const requestBody = { model, prompt, seconds: String(seconds), size };
    if (image_url) {
      requestBody.image_url = image_url;
    }
    
    const resp = await fetch(`${APIYI_VIDEO_URL}/v1/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIYI_VIDEO_KEY}` },
      body: JSON.stringify(requestBody)
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error?.message || '提交失败' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/video/status/:id', async (req, res) => {
  try {
    const resp = await fetch(`${APIYI_VIDEO_URL}/v1/videos/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${APIYI_VIDEO_KEY}` }
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error?.message || '查询失败' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/video/download/:id', async (req, res) => {
  try {
    const resp = await fetch(`${APIYI_VIDEO_URL}/v1/videos/${req.params.id}/content`, {
      headers: { 'Authorization': `Bearer ${APIYI_VIDEO_KEY}` }
    });
    if (!resp.ok) return res.status(resp.status).json({ error: '下载失败' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="sora2-${req.params.id}.mp4"`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// PUT /api/settings/zhizengzeng-key - Update zhizengzeng API key
app.put("/api/settings/zhizengzeng-key", (req, res) => {
  const { adminUsername, newKey } = req.body;
  if (!adminUsername || !newKey) return res.json({ ok: false, error: "缺少参数" });
  const admin = db.prepare("SELECT * FROM users WHERE username = ? AND role = ?").get(adminUsername, "admin");
  if (!admin) return res.json({ ok: false, error: "权限不足" });
  if (!newKey.startsWith("sk-")) return res.json({ ok: false, error: "Key 格式错误（需以 sk- 开头）" });
  try {
    const envPath = require("path").join(__dirname, ".env");
    let envContent = require("fs").readFileSync(envPath, "utf-8");
    if (envContent.includes("ZHIZENGENG_API_KEY=")) {
      envContent = envContent.replace(/ZHIZENGENG_API_KEY=.*/, "ZHIZENGENG_API_KEY=" + newKey);
    } else {
      envContent += "\nZHIZENGZENG_API_KEY=" + newKey;
    }
    require("fs").writeFileSync(envPath, envContent, "utf-8");
    ZHIZENGENG_API_KEY = newKey;
    process.env.ZHIZENGENG_API_KEY = newKey;
    console.log("[SETTINGS] ZHIZENGENG_API_KEY updated by", adminUsername);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// === SPA Catch-all: serve index.html for any unmatched GET routes ===
// This fixes "NOT FOUND" when users bookmark or directly visit sub-page URLs on mobile/desktop
app.get('/{*splat}', (req, res, next) => {
  // Skip API routes and static files
  if (req.path.startsWith('/api/') || req.path.startsWith('/assets/') || req.path.startsWith('/css/') || req.path.startsWith('/js/') || /\.(css|js|png|jpg|gif|ico|svg|woff2?)$/.test(req.path)) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function main() {
  
  await setupDBSync();
  // Initialize AI system
  initAITables(db);
  app.locals.db = db; // Make db accessible to AI system  // === Chat Proxy to voice-app ===
  app.all('/api/ai/proxy/apiyi/{*path}', async (req, res) => {
    const http = require('http');
    const url = new URL(req.url, 'http://localhost');
    const targetPath = url.pathname.replace('/api/ai/proxy/apiyi', '/api');
    const bodyStr = req.body ? JSON.stringify(req.body) : '';
    
    const options = {
      hostname: '127.0.0.1',
      port: 3003,
      path: targetPath + (url.search || ''),
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      }
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      proxyRes.pipe(res, { end: true });
    });
    
    proxyReq.on('error', (err) => {
      console.error('Chat proxy error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Proxy error: ' + err.message });
    });
    
    if (bodyStr) proxyReq.write(bodyStr);
    proxyReq.end();
  });

  app.use('/api/ai', aiRouter);

  console.log('AI image generation system initialized');
  cleanupWanHistory();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`栗子素材网 running on http://0.0.0.0:${PORT}`);
  });
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
