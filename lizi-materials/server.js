
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const BCRYPT_ROUNDS = 12;
const { router: aiRouter, initTables: initAITables } = require('./ai-system');
const cors = require('cors');
const COS = require("cos-nodejs-sdk-v5");
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
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-2d81719a7aaf43a19e0ac4120399b44f.r2.dev';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const USE_R2 = !!(R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
const DB_KEY = 'lizi.db';
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

  // WAN generation history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS wan_generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT DEFAULT '',
      input_image TEXT DEFAULT '',
      output_images TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  
  // Voice clones table (MiniMax)
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_clones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      voice_id TEXT NOT NULL UNIQUE,
      demo_url TEXT DEFAULT '',
      status TEXT DEFAULT 'cloning',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add missing columns if needed
  try { db.exec('ALTER TABLE materials ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN downloads INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN gradient INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN badges TEXT DEFAULT \'["版权","new"]\''); } catch(e) {}

  // Add lockout columns for login brute-force protection
  try { db.exec('ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL'); } catch(e) {}

  // Create admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, ?)')
      .run('admin', hashPwd(process.env.ADMIN_PWD || 'admin123'), 'admin', 0);
  }
}

// === R2 Storage ===
let s3Client = null;
let cosClient = null;

async function initR2() {
  if (!USE_R2) { console.log('R2 not configured. Using local disk.'); return; }
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  s3Client = {
    client: new S3Client({
      region: process.env.COS_REGION || 'ap-hongkong',
      endpoint: process.env.COS_ENDPOINT || `https://cos.${process.env.COS_REGION || 'ap-hongkong'}.myqcloud.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      forcePathStyle: false,
    }),
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand
  };
  console.log('R2 storage configured.');
  console.log("COS init - SecretId:", process.env.R2_ACCESS_KEY_ID ? "set" : "missing", "SecretKey:", process.env.R2_SECRET_ACCESS_KEY ? "set (" + process.env.R2_SECRET_ACCESS_KEY.length + " chars)" : "missing");
  cosClient = new COS({ SecretId: process.env.R2_ACCESS_KEY_ID, SecretKey: process.env.R2_SECRET_ACCESS_KEY });
}

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

    // Sync snapshot to R2
    if (USE_R2 && cosClient) {
      const buffer = fs.readFileSync(SNAPSHOT_PATH);
      await new Promise((resolve, reject) => {
        cosClient.putObject({
          Bucket: R2_BUCKET,
          Region: process.env.COS_REGION || 'ap-hongkong',
          Key: 'materials-snapshot.json',
          Body: buffer
        }, (err) => { if (err) reject(err); else resolve(); });
      });
    }
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
  
  // Delete R2 files that are not in the snapshot (orphans)
  const orphans = currentPaths.filter(p => p && !snapshotPaths.has(p));
  if (orphans.length > 0) {
    console.log(`Cleaning up ${orphans.length} orphaned files from R2...`);
    await Promise.all(orphans.map(p => deleteFromR2(p)));
  }
  
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

async function downloadFromR2(key) {
  try {
    if (!cosClient) return null;
    return await new Promise((resolve, reject) => {
      cosClient.getObject({
        Bucket: R2_BUCKET,
        Region: process.env.COS_REGION || 'ap-hongkong',
        Key: key
      }, (err, data) => {
        if (err) {
          console.log('COS download error:', err.message);
          resolve(null);
        } else {
          resolve(data.Body);
        }
      });
    });
  } catch (e) {
    console.log('R2 download error:', e.message);
    return null;
  }
}

async function uploadToR2(key, buffer, contentType = 'application/octet-stream') {
  try {
    if (!s3Client) throw new Error('R2 client not configured');
    const { PutObjectCommand } = s3Client;
    const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType });
    await s3Client.client.send(cmd);
    const url = `${R2_PUBLIC_URL}/${key}`;
    return url;
  } catch (e) {
    console.log('R2 upload error:', e.message);
    throw e;
  }
}

async function deleteFromR2(url) {
  if (!cosClient) return;
  let key = url;
  if (url.startsWith('http')) {
    const prefix = R2_PUBLIC_URL + '/';
    if (!url.startsWith(prefix)) {
      console.warn('deleteFromR2: URL not from our bucket, skipping:', url);
      return;
    }
    key = url.slice(prefix.length);
  }
  try {
    await new Promise((resolve, reject) => {
      cosClient.deleteObject({
        Bucket: R2_BUCKET,
        Region: process.env.COS_REGION || 'ap-hongkong',
        Key: key
      }, (err, data) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch(e) {
    console.error('R2 delete error:', e.message, 'key:', key);
  }
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

// === Auth Middleware ===
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function requireAuth(req, res, next) {
  if (!dbReady) return res.status(503).json({ ok: false, error: '服务维护中' });
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ ok: false, error: '请先登录' });
  const session = db.prepare('SELECT username FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ ok: false, error: '登录已过期，请重新登录' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(session.username);
  if (!user) return res.status(401).json({ ok: false, error: '用户不存在' });
  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(403).json({ ok: false, error: '账号已锁定，请15分钟后再试' });
  }
  // Enforce force_pwd_change (allow only changePwd and logout)
  if (user.force_pwd_change === 1 && req.path !== '/api/changePwd') {
    return res.json({ ok: false, error: '请先修改密码', forcePwdChange: true });
  }
  req.authUser = user;
  req.authToken = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.authUser || req.authUser.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '权限不足，仅管理员可操作' });
  }
  next();
}

// Cache headers for static assets
// Cache headers for static assets
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '7d', immutable: true }));
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

// AI image page - only accessible via iframe inside main site
// Direct /ai URL access is disabled, redirects to homepage
app.get("/ai", function(req, res) {
  res.redirect('/');
});


const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

function hashPwd(p) { return bcrypt.hashSync(p, BCRYPT_ROUNDS); }
function verifyPwd(plain, hashed) {
  if (!hashed) return false;
  // Legacy MD5 hash (32 hex chars) — transparent migration
  if (/^[a-f0-9]{32}$/.test(hashed)) {
    const md5 = crypto.createHash('md5').update(plain).digest('hex');
    if (md5 === hashed) {
      // Upgrade to bcrypt in background (caller should persist)
      return 'upgrade';
    }
    return false;
  }
  return bcrypt.compareSync(plain, hashed);
}
function generateTempPassword() {
  return crypto.randomBytes(5).toString('base64url'); // 8-char random password
}

// Rewrite old R2 bucket URLs to the current R2_PUBLIC_URL
function rewriteR2Url(url) {
  if (!url || typeof url !== 'string') return url;
  // Match any pub-xxxxxxxx.r2.dev URL and replace with current R2_PUBLIC_URL
  if (R2_PUBLIC_URL && url.includes('.r2.dev/')) {
    return url.replace(/^https?:\/\/pub-[a-f0-9]+\.r2\.dev/, R2_PUBLIC_URL);
  }
  return url;
}

// === DB Sync Helper ===
async function syncDB() {
  if (!USE_R2) return;
  try {
    if (!cosClient || !db) {
      console.error('DB sync: cosClient or db not initialized');
      return;
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    const buffer = fs.readFileSync(DB_PATH);
    await new Promise((resolve, reject) => {
      cosClient.putObject({
        Bucket: R2_BUCKET,
        Region: process.env.COS_REGION || 'ap-hongkong',
        Key: DB_KEY,
        Body: buffer
      }, (err, data) => {
        if (err) {
          console.error('DB sync failed:', err.message);
          reject(err);
        } else {
          console.log('DB synced to R2 (' + buffer.length + ' bytes)');
          resolve();
        }
      });
    });
  } catch(e) {
    console.error('DB sync failed:', e.message);
  }
}

// === Helper: get material with files ===
function getMaterialWithFiles(id) {
  const mat = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!mat) return null;
  const files = db.prepare('SELECT * FROM material_files WHERE material_id = ? ORDER BY id').all(id);
  return {
    ...mat,
    badges: JSON.parse(mat.badges || '["版权","new"]'),
    uploadedFiles: files.map(f => ({ name: f.name, path: rewriteR2Url(f.path), ext: f.ext, size: f.size, mime: f.mime }))
  };
}

function getAllMaterials() {
  const materials = db.prepare('SELECT * FROM materials ORDER BY id DESC').all();
  return materials.map(m => {
    const files = db.prepare('SELECT * FROM material_files WHERE material_id = ? ORDER BY id').all(m.id);
    return {
      ...m,
      badges: JSON.parse(m.badges || '["版权","new"]'),
      uploadedFiles: files.map(f => ({ name: f.name, path: rewriteR2Url(f.path), ext: f.ext, size: f.size, mime: f.mime }))
    };
  });
}

// === API Routes ===

// Login
app.post('/api/login', async (req, res) => {
  const { username, password, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  if (!username || !password) return res.json({ ok: false, error: '请输入用户名和密码' });
  // Device lock removed - deviceId validation disabled
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '用户名或密码错误' });

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.json({ ok: false, error: '密码错误次数过多，账号已锁定15分钟' });
  }

  // Verify password (with transparent MD5→bcrypt migration)
  const pwdResult = verifyPwd(password, user.password);
  if (pwdResult === 'upgrade') {
    // Upgrade password hash to bcrypt
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPwd(password), user.id);
  } else if (!pwdResult) {
    // Increment failed attempts
    const attempts = (user.login_attempts || 0) + 1;
    if (attempts >= 5) {
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?')
        .run(attempts, lockedUntil, user.id);
      await syncDB();
      return res.json({ ok: false, error: '密码错误5次，账号已锁定15分钟' });
    }
    db.prepare('UPDATE users SET login_attempts = ? WHERE id = ?').run(attempts, user.id);
    const remaining = 5 - attempts;
    return res.json({ ok: false, error: `用户名或密码错误（还可尝试${remaining}次）` });
  }

  // Reset failed attempts on success
  db.prepare('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  // Device lock check (admin: enforce on ALL devices including mobile)
  const isAdminLogin = user.role === 'admin';
  if (!isMobile || isAdminLogin) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.json({ ok: false, error: isAdminLogin ? '管理员账号已锁定到指定设备，无法在此设备登录' : '该账号已在其他设备登录，无法在此设备使用' });
      }
      if (!isAdminLogin && lock.is_mobile !== (isMobile ? 1 : 0)) {
        db.prepare('UPDATE device_lock SET is_mobile = ? WHERE username = ?').run(isMobile ? 1 : 0, username);
        await syncDB();
      }
    } else {
      db.prepare('INSERT INTO device_lock (username, device_id, is_mobile) VALUES (?, ?, ?)')
        .run(username, deviceId, isMobile ? 1 : 0);
      await syncDB();
    }
  }

  // Generate session token
  // Remove any existing sessions for this user+device
  db.prepare('DELETE FROM sessions WHERE username = ? AND device_id = ?').run(username, deviceId);
  const token = generateToken();
  db.prepare('INSERT INTO sessions (username, device_id, token) VALUES (?, ?, ?)')
    .run(username, deviceId, token);
  await syncDB();

  res.json({
    ok: true,
    token: token,
    user: { username: user.username, role: user.role },
    forcePwdChange: user.force_pwd_change === 1
  });
});

// Change password
app.post('/api/changePwd', requireAuth, async (req, res) => {
  const { oldPwd, newPwd } = req.body;
  if (!oldPwd || !newPwd || newPwd.length < 8) return res.json({ ok: false, error: '新密码至少8位，需包含字母和数字' });
  if (!/[a-zA-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) return res.json({ ok: false, error: '密码需包含字母和数字' });
  const user = req.authUser;
  const pwdResult = verifyPwd(oldPwd, user.password);
  if (pwdResult === 'upgrade') {
    // Old MD5 hash matches, proceed
  } else if (!pwdResult) {
    return res.json({ ok: false, error: '当前密码错误' });
  }
  db.prepare('UPDATE users SET password = ?, force_pwd_change = 0 WHERE username = ?').run(hashPwd(newPwd), user.username);
  await syncDB();
  res.json({ ok: true });
});

// Logout — invalidate token
app.post('/api/logout', requireAuth, async (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.authToken);
  await syncDB();
  res.json({ ok: true });
});

// === Users ===
// Lightweight endpoint to get current user info
app.post('/api/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: { username: req.authUser.username, role: req.authUser.role }, forcePwdChange: req.authUser.force_pwd_change === 1 });
});

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, users: db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all() });
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, role } = req.body;
  if (!username || username.length < 2) return res.json({ ok: false, error: '用户名至少2个字符' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.json({ ok: false, error: '用户名已存在' });
  const tempPwd = generateTempPassword();
  db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, 1)').run(username, hashPwd(tempPwd), role || 'user');
  await syncDB();
  res.json({ ok: true, tempPassword: tempPwd });
});

app.delete('/api/users/:username', requireAuth, requireAdmin, async (req, res) => {
  const targetUsername = req.params.username;
  if (targetUsername === 'admin') return res.json({ ok: false, error: '不能删除管理员' });
  db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
  await syncDB();
  res.json({ ok: true });
});

// === Materials ===
app.get('/api/materials', (req, res) => {
  res.json({ ok: true, materials: getAllMaterials() });
});

// Add material with file uploads
app.post('/api/materials', requireAuth, requireAdmin, upload.array('files', 20), async (req, res) => {
  const { cat, badges, gradient } = req.body;
  const name = toSimplified(req.body.name);
  if (!name) return res.json({ ok: false, error: '请输入名称' });

  // Auto-overwrite if same name exists
  const existing = db.prepare('SELECT * FROM materials WHERE name = ?').get(name);
  if (existing) {
    const oldFiles = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(existing.id);
    await Promise.all(oldFiles.map(f => f.path && f.path.startsWith('http') ? deleteFromR2(f.path) : Promise.resolve()));
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
    await syncDB();
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
      const url = await uploadToR2(key, fileBuffer, f.mimetype);
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
    await syncDB();
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

  await syncDB();
  res.json({ ok: true, materials: getAllMaterials(), warning });
});

// Upload files to existing material
app.post('/api/materials/:id/upload', requireAuth, requireAdmin, upload.array('files', 20), async (req, res) => {
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
    const url = await uploadToR2(key, fileBuffer, f.mimetype);
    db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
      .run(materialId, f.originalname, url, ext, f.size, f.mimetype);
  }

  await syncDB();
  res.json({ ok: true, material: getMaterialWithFiles(materialId) });
});

// Update material
app.put('/api/materials/:id', requireAuth, requireAdmin, async (req, res) => {
  const { cat, badges, gradient } = req.body;
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

  await syncDB();
  res.json({ ok: true, materials: getAllMaterials() });
});

// Delete material
app.delete('/api/materials/:id', requireAuth, requireAdmin, async (req, res) => {
  const materialId = parseInt(req.params.id, 10);

  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (material) {
    const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(materialId);
    // Wait for all R2 deletions to complete
    await Promise.all(files.map(f => {
      if (f.path && f.path.startsWith('http')) return deleteFromR2(f.path);
    }));
    db.prepare('DELETE FROM material_files WHERE material_id = ?').run(materialId);
    db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);
    // Real-time backup
    await syncDB();
  }

  res.json({ ok: true, materials: getAllMaterials() });
});

// Reorder materials
app.post('/api/materials/reorder', requireAuth, requireAdmin, async (req, res) => {
  const { order } = req.body;
  const stmt = db.prepare('UPDATE materials SET sort_order = ? WHERE id = ?');
  const materials = getAllMaterials();
  order.forEach((idx, i) => {
    if (materials[idx]) stmt.run(i, materials[idx].id);
  });
  await syncDB();
  res.json({ ok: true, materials: getAllMaterials() });
});

// === Download ===
app.post('/api/download', requireAuth, async (req, res) => {
  const { materialIndex, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = req.authUser;

  // Device lock removed - download from any device

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
  await syncDB();
  res.json({ ok: true, material: getMaterialWithFiles(material.id) });
});

// Track download (lightweight, no file data returned)
app.post('/api/download/track', requireAuth, async (req, res) => {
  const { materialId } = req.body;
  const username = req.authUser.username;
  if (!materialId) return res.json({ ok: false });
  db.prepare('UPDATE materials SET downloads = downloads + 1 WHERE id = ?').run(materialId);
  await syncDB();
  res.json({ ok: true });
});


// Download all materials as zip
app.post('/api/download-all', requireAuth, async (req, res) => {
  const { deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = req.authUser;

  // Device lock removed - download from any device

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip';
  if (!canDl) return res.json({ ok: false, error: '权限不足，仅管理员或VIP可下载全部素材' });

  try {
    const { ZipArchive } = await import('archiver');
    const archive = new ZipArchive();
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=lizi-materials-all.zip');
    
    archive.pipe(res);
    
    const materials = db.prepare('SELECT * FROM materials ORDER BY id DESC').all();
    
    for (const mat of materials) {
      const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(mat.id);
      
      for (const file of files) {
        try {
          const r2Key = file.path.replace(/^https?:\/\/[^/]+\//, '');
          const fileBuffer = await downloadFromR2(r2Key);
          
          if (fileBuffer) {
            const folder = mat.cat || '未分类';
            const fileName = file.name || `file_${file.id}${file.ext}`;
            archive.append(fileBuffer, { name: `${folder}/${mat.name}/${fileName}` });
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
app.post('/api/download-category', requireAuth, async (req, res) => {
  const { deviceId, category } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = req.authUser;

  // Device lock removed - download from any device

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip';
  if (!canDl) return res.json({ ok: false, error: '权限不足，仅管理员或VIP可下载素材' });

  if (!category) return res.json({ ok: false, error: '请指定分类' });

  try {
    const { ZipArchive } = await import('archiver');
    const archive = new ZipArchive();
    
    res.setHeader('Content-Type', 'application/zip');
    
    res.setHeader('Content-Disposition', 'attachment; filename=lizi-materials.zip');
    archive.pipe(res);
    
    const materials = db.prepare('SELECT * FROM materials WHERE cat = ? ORDER BY id DESC').all(category);
    
    for (const mat of materials) {
      const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(mat.id);
      
      for (const file of files) {
        try {
          const r2Key = file.path.replace(/^https?:\/\/[^/]+\//, '');
          const fileBuffer = await downloadFromR2(r2Key);
          
          if (fileBuffer) {
            const fileName = file.name || `file_${file.id}${file.ext}`;
            archive.append(fileBuffer, { name: `${mat.name}/${fileName}` });
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
app.post('/api/requests', requireAuth, upload.array('images', 5), async (req, res) => {
  const username = req.authUser.username;
  const { content, contact } = req.body;
  if (!content) return res.json({ ok: false, error: '请填写需求描述' });

  const imgPaths = [];
  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${crypto.randomUUID()}${ext}`;
    imgPaths.push(await uploadToR2(key, f.buffer, f.mimetype));
  }

  db.prepare('INSERT INTO requests (user, content, contact, images) VALUES (?, ?, ?, ?)')
    .run(username || '匿名', content, contact || '', JSON.stringify(imgPaths));

  // Notify admin
  const admins = db.prepare('SELECT username FROM users WHERE role = ?').all('admin');
  for (const admin of admins) {
    db.prepare('INSERT INTO notifications (user, from_user, message) VALUES (?, ?, ?)')
      .run(admin.username, username || '匿名', `收到新的素材需求: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
  }

  await syncDB();
  res.json({ ok: true });
});

app.get('/api/requests', (req, res) => {
  const requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  res.json({ ok: true, requests: requests.map(r => ({
    ...r,
    images: JSON.parse(r.images || '[]')
  }))});
});

app.delete('/api/requests/:id', requireAuth, requireAdmin, async (req, res) => {
  db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
  await syncDB();
  res.json({ ok: true });
});

// === Notifications ===
app.get('/api/notifications', requireAuth, (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE user = ? ORDER BY time DESC').all(req.authUser.username);
  const unread = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user = ? AND is_read = 0').get(req.authUser.username).cnt;
  res.json({ ok: true, notifications: notifs, unread });
});

app.post('/api/notifications/read', requireAuth, async (req, res) => {
  const username = req.authUser.username;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user = ?').run(username);
  await syncDB();
  res.json({ ok: true });
});

// === Bindings ===
app.post('/api/bindings', requireAuth, async (req, res) => {
  const username = req.authUser.username;
  const { platform, platformAccount } = req.body;
  if (!platform || !platformAccount) return res.json({ ok: false, error: '请填写完整信息' });
  const existing = db.prepare('SELECT id FROM bindings WHERE username = ? AND platform = ?').get(username, platform);
  if (existing) {
    db.prepare('UPDATE bindings SET platform_account = ? WHERE username = ? AND platform = ?').run(platformAccount, username, platform);
  } else {
    db.prepare('INSERT INTO bindings (username, platform, platform_account) VALUES (?, ?, ?)').run(username, platform, platformAccount);
  }
  await syncDB();
  res.json({ ok: true });
});

app.get('/api/bindings', requireAuth, (req, res) => {
  const bindings = db.prepare('SELECT * FROM bindings WHERE username = ? ORDER BY bind_time DESC').all(req.authUser.username);
  res.json({ ok: true, bindings });
});

app.delete('/api/bindings/:platform', requireAuth, async (req, res) => {
  const username = req.authUser.username;
  db.prepare('DELETE FROM bindings WHERE username = ? AND platform = ?').run(username, req.params.platform);
  await syncDB();
  res.json({ ok: true });
});

app.get('/api/bindings/all', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all();
  const usersWithBindings = users.map(u => {
    const bindings = db.prepare('SELECT * FROM bindings WHERE username = ?').all(u.username);
    return { ...u, bindings };
  });
  res.json({ ok: true, users: usersWithBindings });
});

// === Save Current Version to lizi-new ===
app.post('/api/save-version', requireAuth, requireAdmin, async (req, res) => {
  
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

// === Revert to Stable ===
app.post('/api/revert-stable', requireAuth, requireAdmin, async (req, res) => {
  
  if (!USE_R2 || !cosClient) {
    return res.json({ ok: false, error: 'R2 未配置，无法恢复' });
  }
  
  try {
    console.log('Reverting to stable DB from R2...');
    const backupBuffer = await downloadFromR2('lizi_backup.db');
    if (!backupBuffer) {
      return res.json({ ok: false, error: 'R2 中找不到备份数据库 lizi_backup.db' });
    }
    
    // Block other requests during DB swap
    dbReady = false;
    
    // === 备份当前帐号资料（密码、设备锁定、绑定、会话） ===
    const currentUsers = db.prepare('SELECT * FROM users').all();
    const currentDeviceLocks = db.prepare('SELECT * FROM device_lock').all();
    const currentBindings = db.prepare('SELECT * FROM bindings').all();
    const currentSessions = db.prepare('SELECT * FROM sessions').all();
    console.log(`Preserving ${currentUsers.length} users, ${currentDeviceLocks.length} device locks, ${currentBindings.length} bindings`);
    
    // Close current DB
    db.close();
    
    // Write backup to DB path
    fs.writeFileSync(DB_PATH, backupBuffer);
    console.log('DB file restored from backup (' + backupBuffer.length + ' bytes)');
    
    // Re-init DB
    const CompatDB = require('./lib/sqlite-compat');
    db = new CompatDB(null, DB_PATH);
    db.pragma('journal_mode = WAL');
    
    // === 恢复当前帐号资料（不影响密码） ===
    // 清空备份中的帐号表，用当前数据覆盖
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM device_lock');
    db.exec('DELETE FROM bindings');
    db.exec('DELETE FROM users');
    
    const insertUser = db.prepare('INSERT INTO users (id, username, password, role, force_pwd_change, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const u of currentUsers) {
      insertUser.run(u.id, u.username, u.password, u.role, u.force_pwd_change, u.created_at);
    }
    console.log(`Restored ${currentUsers.length} users (passwords preserved)`);
    
    const insertLock = db.prepare('INSERT INTO device_lock (id, username, device_id, is_mobile, locked_at) VALUES (?, ?, ?, ?, ?)');
    for (const l of currentDeviceLocks) {
      try { insertLock.run(l.id, l.username, l.device_id, l.is_mobile, l.locked_at); } catch(e) {}
    }
    
    const insertBinding = db.prepare('INSERT INTO bindings (id, username, platform, platform_account, bind_time) VALUES (?, ?, ?, ?, ?)');
    for (const b of currentBindings) {
      try { insertBinding.run(b.id, b.username, b.platform, b.platform_account, b.bind_time); } catch(e) {}
    }
    
    const insertSession = db.prepare('INSERT INTO sessions (id, username, device_id, token, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const s of currentSessions) {
      try { insertSession.run(s.id, s.username, s.device_id, s.token, s.created_at); } catch(e) {}
    }
    
    const count = db.prepare('SELECT COUNT(*) as c FROM materials').get().c;
    console.log('DB restored with ' + count + ' materials (accounts preserved)');
    
    // Sync back to R2
    await syncDB();
    
    // Unblock requests
    dbReady = true;
    
    res.json({ ok: true, message: '恢复成功（帐号密码已保留）', materialCount: count, userCount: currentUsers.length });
  } catch (e) {
    console.error('Revert failed:', e);
    dbReady = true; // Always unblock even on error
    res.json({ ok: false, error: '恢复失败: ' + e.message });
  }
});

// === Snapshot Save/Restore (manual only) ===
app.post('/api/snapshot/save', requireAuth, requireAdmin, async (req, res) => {
  
  try {
    const count = await saveSnapshot();
    res.json({ ok: true, message: `已保存 ${count} 个素材到快照`, materialCount: count });
  } catch (e) {
    res.json({ ok: false, error: '保存快照失败: ' + e.message });
  }
});

app.post('/api/snapshot/restore', requireAuth, requireAdmin, async (req, res) => {
  
  try {
    const count = await restoreSnapshot();
    await syncDB();
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
app.get('/api/debug/r2-test', async (req, res) => {
  const results = { timestamp: new Date().toISOString() };
  
  // Check config
  results.config = {
    USE_R2,
    R2_BUCKET: R2_BUCKET ? R2_BUCKET.substring(0, 10) + '...' : '(empty)',
    R2_ACCOUNT_ID: R2_ACCOUNT_ID ? R2_ACCOUNT_ID.substring(0, 8) + '...' : '(empty)',
    R2_ACCESS_KEY_ID: R2_ACCESS_KEY_ID ? 'set (' + R2_ACCESS_KEY_ID.substring(0, 8) + '...)' : '(empty)',
    R2_SECRET_ACCESS_KEY: R2_SECRET_ACCESS_KEY ? 'set (' + R2_SECRET_ACCESS_KEY.length + ' chars)' : '(empty)',
    R2_PUBLIC_URL,
    s3ClientInitialized: !!s3Client,
  };
  
  if (!USE_R2 || !cosClient) {
    results.error = 'R2 not configured';
    return res.json(results);
  }

  // Test 1: Upload a tiny test file
  const testKey = 'uploads/_diag_test_' + Date.now() + '.txt';
  const testContent = Buffer.from('R2 diagnostic test - ' + new Date().toISOString());
  try {
    const url = await uploadToR2(testKey, testContent, 'text/plain');
    results.upload = { ok: true, url };
  } catch(e) {
    results.upload = { ok: false, error: e.message, name: e.name, code: e.Code, statusCode: e.$metadata?.httpStatusCode };
    return res.json(results);
  }

  // Test 2: Download it back
  try {
    const buf = await downloadFromR2(testKey);
    results.download = { ok: !!buf, size: buf ? buf.length : 0, content: buf ? buf.toString() : null };
  } catch(e) {
    results.download = { ok: false, error: e.message };
  }

  // Test 3: Verify public URL is accessible
  try {
    const publicUrl = `${R2_PUBLIC_URL}/${testKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const fetchRes = await fetch(publicUrl, { signal: controller.signal });
    clearTimeout(timeout);
    results.publicAccess = { ok: fetchRes.ok, status: fetchRes.status, url: publicUrl };
  } catch(e) {
    results.publicAccess = { ok: false, error: e.message };
  }

  // Test 4: Cleanup
  try {
    await deleteFromR2(`${R2_PUBLIC_URL}/${testKey}`);
    results.cleanup = { ok: true };
  } catch(e) {
    results.cleanup = { ok: false, error: e.message };
  }

  // Test 5: Check multer config
  results.multer = {
    storage: 'memoryStorage',
    fileSizeLimit: '100MB',
    maxFiles: 20
  };

  res.json(results);
});

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
  if (USE_R2) {
    console.log('Checking for DB in R2...');
    // Only restore from R2 if local DB doesn't exist
    if (!fs.existsSync(DB_PATH)) {
      const dbBuffer = await downloadFromR2(DB_KEY);
      if (dbBuffer) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        fs.writeFileSync(DB_PATH, dbBuffer);
        console.log('DB restored from R2 (' + dbBuffer.length + ' bytes)');
      } else {
        console.log('No DB found in R2, will create new');
      }
    } else {
      console.log('Local DB exists, skipping R2 restore');
    }
  }
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

  // Migration: fix non-ASCII file paths in R2 (Chinese filenames cause 403 errors)
  if (USE_R2) {
    const filesWithBadPaths = db.prepare(
      "SELECT id, name, path, ext, mime FROM material_files WHERE path NOT LIKE '%/uploads/%' AND path NOT LIKE '%/files/%'"
    ).all();

    if (filesWithBadPaths.length > 0) {
      console.log(`Migration: Found ${filesWithBadPaths.length} files with non-ASCII paths, renaming...`);
      for (const f of filesWithBadPaths) {
        try {
          let key = f.path;
          const prefix = R2_PUBLIC_URL + '/';
          if (key.startsWith(prefix)) key = key.slice(prefix.length);

          // Check if key has non-ASCII chars
          let hasNonAscii = false;
          for (let i = 0; i < key.length; i++) {
            if (key.charCodeAt(i) > 127) { hasNonAscii = true; break; }
          }
          if (!hasNonAscii) continue;

          // Download from R2
          const fileBuffer = await downloadFromR2(key);
          if (!fileBuffer) {
            console.log(`  SKIP: Cannot download ${key}`);
            continue;
          }

          // Generate ASCII-safe key
          const hash = crypto.createHash('md5').update(f.name).digest('hex').slice(0, 12);
          const newKey = `files/${hash}${f.ext}`;

          // Upload to new key
          await new Promise((resolve, reject) => {
            cosClient.putObject({
              Bucket: R2_BUCKET,
              Region: process.env.COS_REGION || 'ap-hongkong',
              Key: newKey,
              Body: fileBuffer,
              ContentType: f.mime || 'application/octet-stream'
            }, (err) => { if (err) reject(err); else resolve(); });
          });

          // Delete old key
          await new Promise((resolve, reject) => {
            cosClient.deleteObject({
              Bucket: R2_BUCKET,
              Region: process.env.COS_REGION || 'ap-hongkong',
              Key: key
            }, (err) => { if (err) reject(err); else resolve(); });
          });

          // Update database
          const newUrl = `${R2_PUBLIC_URL}/${newKey}`;
          db.prepare('UPDATE material_files SET path = ? WHERE id = ?').run(newUrl, f.id);
          console.log(`  Renamed: ${key} → ${newKey}`);
        } catch(e) {
          console.error(`  Error renaming ${f.name}: ${e.message}`);
        }
      }
    }
  }

  // Check if database is incomplete and restore from backup if needed
  const materialCount = db.prepare('SELECT COUNT(*) as count FROM materials').get().count;
  console.log(`Current material count: ${materialCount}`);
  
  if (USE_R2 && materialCount < 55) {
    console.log('Material count is too low, restoring from backup...');
    const backupBuffer = await downloadFromR2('lizi_backup.db');
    if (backupBuffer) {
      // Close current connection
      db.close();
      // Restore from backup
      fs.writeFileSync(DB_PATH, backupBuffer);
      // Reopen database
      const CompatDB = require('./lib/sqlite-compat');
      db = new CompatDB(null, DB_PATH);
      db.pragma('journal_mode = WAL');
      
      // Re-run migrations on restored database
      for (const m of migrations) {
        const result = db.prepare('UPDATE materials SET cat = ? WHERE cat = ?').run(m.to, m.from);
        if (result.changes > 0) {
          console.log(`Migration on backup: ${result.changes} materials updated from "${m.from}" to "${m.to}"`);
        }
      }
      
      const newCount = db.prepare('SELECT COUNT(*) as count FROM materials').get().count;
      console.log(`Restored database with ${newCount} materials`);
    } else {
      console.log('Warning: lizi_backup.db not found in R2');
    }
  }
  
  // Migration: fix orphaned materials (materials with no files due to lastInsertRowid bug)
  if (USE_R2) {
    try {
      const orphanedMaterials = db.prepare(
        'SELECT m.id, m.name, m.created_at FROM materials m LEFT JOIN material_files mf ON m.id = mf.material_id WHERE mf.id IS NULL ORDER BY m.id'
      ).all();
      
      if (orphanedMaterials.length > 0) {
        console.log(`Migration: Found ${orphanedMaterials.length} orphaned materials, attempting to recover files from R2...`);
        const r2Files = await new Promise((resolve, reject) => {
          cosClient.getBucket({
            Bucket: R2_BUCKET,
            Region: process.env.COS_REGION || 'ap-hongkong',
            Prefix: 'uploads/',
            MaxKeys: 1000
          }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        
        const r2FileMap = {};
        for (const obj of (r2Files.Contents || [])) {
          r2FileMap[obj.Key] = { size: obj.Size, modified: new Date(obj.LastModified) };
        }
        
        for (const mat of orphanedMaterials) {
          const matTime = new Date(mat.created_at).getTime();
          const matches = [];
          
          for (const [key, info] of Object.entries(r2FileMap)) {
            const fileTime = info.modified.getTime();
            if (Math.abs(fileTime - matTime) < 60000) {
              const ext = path.extname(key).toLowerCase();
              if (['.png', '.gif', '.jpg', '.jpeg', '.fla'].includes(ext)) {
                matches.push({ key, ext, size: info.size, mime: ext === '.fla' ? 'application/octet-stream' : (ext === '.gif' ? 'image/gif' : ext === '.jpg' ? 'image/jpeg' : 'image/' + ext.slice(1)) });
              }
            }
          }
          
          if (matches.length > 0) {
            console.log(`  Material "${mat.name}" (id=${mat.id}): found ${matches.length} matching files`);
            for (const m of matches) {
              const url = `${R2_PUBLIC_URL}/${m.key}`;
              db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
                .run(mat.id, mat.name + m.ext, url, m.ext, m.size, m.mime);
            }
          } else {
            console.log(`  Material "${mat.name}" (id=${mat.id}): no matching files found, deleting...`);
            db.prepare('DELETE FROM materials WHERE id = ?').run(mat.id);
          }
        }
      }
    } catch (e) {
      console.error('Migration (orphaned materials) failed:', e.message);
    }
  }
  
  // Upload DB immediately on startup so R2 always has latest
  if (USE_R2) {
    await syncDB();
  }
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

app.put("/api/settings/ai-maintenance", requireAuth, requireAdmin, (req, res) => {
  try {
    const { enabled } = req.body;
    const username = req.authUser.username;
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

app.put("/api/settings/voice-maintenance", requireAuth, requireAdmin, (req, res) => {
  try {
    const { enabled } = req.body;
    const username = req.authUser.username;
    const val = enabled ? "true" : "false";
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run("voice_maintenance", val);
    console.log("[Settings] Voice maintenance set to:", val, "by", username);
    res.json({ success: true, maintenance: enabled });
  } catch (err) {
    console.error("Set voice maintenance error:", err);
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
// === 多模型圖片生成 (MuleRouter) ===
const MULEROUTER_API_KEY = process.env.MULEROUTER_API_KEY || 'sk-mr-5fdb9ef902b7d05f469385e0a46de1eb14cd3b26ca8a6c70067a86527ed92dcb';
const MULEROUTER_BASE_URL = process.env.MULEROUTER_BASE_URL || 'https://api.mulerouter.ai';
const WAN_USAGE_PATH = path.join(__dirname, 'data', 'wan_usage.json');
const DAILY_BUDGET_CNY = 2.0;  // 每日限額 2 元人民幣
const USD_TO_CNY = 7.25;

// 模型配置：API路徑、單價(USD/張)、顯示名稱、尺寸參數名
const IMAGE_MODELS = {
  'wan2.7-image': {
    priceCny: 0.35,
    label: '万相2.7(图生图)',
    defaultSize: '16:9',
    imageField: 'image',
    apiType: 'openai'
  },
  'gpt-image-2': {
    priceCny: 0.35,
    label: 'GPT Image 2',
    defaultSize: '1K',
    imageField: 'image',
    apiType: 'openai'
  },
  'gpt-image-1.5': {
    priceCny: 0.30,
    label: 'GPT Image 1.5 (推荐)',
    defaultSize: '1K',
    imageField: 'image',
    apiType: 'openai'
  },
  'chatgpt-image-latest': {
    priceCny: 1.00,
    label: 'ChatGPT Image Latest',
    defaultSize: '1K',
    imageField: 'image',
    apiType: 'openai'
  },
  'gpt-image-1': {
    priceCny: 0.30,
    label: 'GPT Image 1',
    defaultSize: '1K',
    imageField: 'image',
    apiType: 'openai'
  },
  'gpt-image-1-mini': {
    priceCny: 0.10,
    label: 'GPT Image 1 Mini (经济)',
    defaultSize: '1K',
    imageField: 'image',
    apiType: 'openai'
  },
  'dall-e-3': {
    priceCny: 0.28,
    label: 'DALL-E 3',
    defaultSize: '1K',
    apiType: 'openai'
  },
  'dall-e-2': {
    priceCny: 0.14,
    label: 'DALL-E 2',
    defaultSize: '1K',
    apiType: 'openai'
  },
  'gemini-2.5-flash-image': {
    priceCny: 0.28,
    label: 'Nano Banana(图生图)',
    defaultSize: '16:9',
    imageField: 'image',
    apiType: 'gemini'
  },
  'gemini-3.1-flash-image': {
    priceCny: 0.52,
    label: 'Nano Banana 2(图生图)',
    defaultSize: '16:9',
    imageField: 'image',
    apiType: 'gemini'
  },
  'gemini-3-pro-image': {
    priceCny: 0.85,
    label: 'Nano Banana Pro(图生图)',
    defaultSize: '16:9',
    imageField: 'image',
    apiType: 'gemini'
  },
  // === Imagen 系列 === (NOTE: aigcbest.top does not support Imagen, models disabled)
  // [API-UNSUPPORTED] 'imagen-4.0-generate-001': {
  // [API-UNSUPPORTED] priceCny: 0.28,
  // [API-UNSUPPORTED] label: 'Imagen 4.0',
  // [API-UNSUPPORTED] defaultSize: '1K',
  // [API-UNSUPPORTED] apiType: 'imagen'
  // [API-UNSUPPORTED] },
  // [API-UNSUPPORTED] 'imagen-4.0-ultra-generate-001': {
  // [API-UNSUPPORTED] priceCny: 0.56,
  // [API-UNSUPPORTED] label: 'Imagen 4.0 Ultra',
  // [API-UNSUPPORTED] defaultSize: '1K',
  // [API-UNSUPPORTED] apiType: 'imagen'
  // [API-UNSUPPORTED] },
  // [API-UNSUPPORTED] 'imagen-4.0-fast-generate-001': {
  // [API-UNSUPPORTED] priceCny: 0.14,
  // [API-UNSUPPORTED] label: 'Imagen 4.0 Fast',
  // [API-UNSUPPORTED] defaultSize: '1K',
  // [API-UNSUPPORTED] apiType: 'imagen'
  // [API-UNSUPPORTED] },
  // [API-UNSUPPORTED] 'imagen-3.0-generate-002': {
  // [API-UNSUPPORTED] priceCny: 0.28,
  // [API-UNSUPPORTED] label: 'Imagen 3.0',
  // [API-UNSUPPORTED] defaultSize: '1K',
  // [API-UNSUPPORTED] apiType: 'imagen'
  // [API-UNSUPPORTED] },
  // === Grok 系列 ===
  'grok-imagine-image-pro': {
    priceCny: 0.50,
    label: 'Grok Imagine Pro',
    defaultSize: '1K',
    apiType: 'openai'
  },
  'grok-imagine-image': {
    priceCny: 0.28,
    label: 'Grok Imagine',
    defaultSize: '1K',
    apiType: 'openai'
  },
  // === Seedream 系列 ===
  // [UNAVAILABLE] 'doubao-seedream-5-0-250612': {
  // [UNAVAILABLE] priceCny: 0.28,
  // [UNAVAILABLE] label: 'Seedream 5.0',
  // [UNAVAILABLE] defaultSize: '1K',
  // [UNAVAILABLE] apiType: 'openai'
  // [UNAVAILABLE] },
  // [UNAVAILABLE] 'doubao-seedream-5-0-lite-250612': {
  // [UNAVAILABLE] priceCny: 0.14,
  // [UNAVAILABLE] label: 'Seedream 5.0 Lite',
  // [UNAVAILABLE] defaultSize: '1K',
  // [UNAVAILABLE] apiType: 'openai'
  // [UNAVAILABLE] },
  'doubao-seedream-4-5-251128': {
    priceCny: 0.28,
    label: 'Seedream 4.5',
    defaultSize: '1K',
    apiType: 'openai'
  },
  'doubao-seedream-4-0-250828': {
    priceCny: 0.28,
    label: 'Seedream 4.0',
    defaultSize: '1K',
    apiType: 'openai'
  },
  // [UNAVAILABLE] 'doubao-seedream-3-0-t2i-250415': {
  // [UNAVAILABLE] priceCny: 0.14,
  // [UNAVAILABLE] label: 'Seedream 3.0',
  // [UNAVAILABLE] defaultSize: '1K',
  // [UNAVAILABLE] apiType: 'openai'
  // [UNAVAILABLE] },
  'doubao-seededit-3-0-i2i-250628': {
    priceCny: 0.28,
    label: 'SeedEdit 3.0 (图生图)',
    defaultSize: '1K',
    imageField: 'image',
    apiType: 'openai'
  },
  'step-image-edit-2': {
    priceCny: 0.15,
    label: '阶跃图像编辑(图生图)',
    defaultSize: '1K',
    imageField: 'image',
    apiType: 'openai'
  },
};

// 計算某模型剩餘可用次數 (考慮總預算)
function getModelDailyLimit(modelKey, username, today, allUsage) {
  const model = IMAGE_MODELS[modelKey];
  if (!model) return 0;
  
  // 如果沒有用戶上下文，返回最大可能次數（用於公開接口）
  if (!username) {
    return Math.floor(DAILY_BUDGET_CNY / model.priceCny);
  }
  
  // 检查用户角色，admin 不限制
  try {
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username);
    if (user && user.role === 'admin') {
      return 99999; // admin 无限次数
    }
  } catch (e) {
    console.error('Check user role error:', e.message);
  }
  
  // 計算今日已花費總額
  const userData = allUsage[username];
  let spent = 0;
  if (userData && userData.date === today && userData.models) {
    for (const [key, count] of Object.entries(userData.models)) {
      const m = IMAGE_MODELS[key];
      if (m) spent += count * m.priceCny;
    }
  }
  
  // 剩餘預算能生成多少次
  const remainingBudget = DAILY_BUDGET_CNY - spent;
  if (remainingBudget <= 0) return 0;
  return Math.floor(remainingBudget / model.priceCny);
}

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

// GET /api/ai/wan/usage - 返回各模型剩餘次數
app.get('/api/ai/wan/usage', requireAuth, (req, res) => {
  const username = req.authUser.username;
  
  const today = new Date().toISOString().slice(0, 10);
  const allUsage = loadWanUsage();
  
  // 結構: { username: { date: 'YYYY-MM-DD', models: { 'wan2.6-t2i': 3, 'qwen-image-max': 1 } } }
  let userData = allUsage[username];
  
  // 初始化或重置（也處理舊格式遷移）
  if (!userData || userData.date !== today || !userData.models) {
    const models = {};
    for (const key of Object.keys(IMAGE_MODELS)) {
      models[key] = 0;
    }
    allUsage[username] = { date: today, models };
    saveWanUsage(allUsage);
    userData = allUsage[username];
  }
  
  // 計算各模型剩餘
  const modelsInfo = {};
  for (const [key, model] of Object.entries(IMAGE_MODELS)) {
    const used = allUsage[username].models[key] || 0;
    const limit = getModelDailyLimit(key, username, today, allUsage);
    modelsInfo[key] = {
      label: model.label,
      used: used,
      limit: limit,
      remaining: Math.max(0, limit - used),
      priceCny: model.priceCny
    };
  }
  
  res.json({
    date: today,
    dailyBudget: DAILY_BUDGET_CNY,
    models: modelsInfo
  });
});

// GET /api/ai/wan/models - 返回可用模型列表
app.get('/api/ai/wan/models', (req, res) => {
  const models = {};
  for (const [key, model] of Object.entries(IMAGE_MODELS)) {
    models[key] = {
      label: model.label,
      priceUsd: +(model.priceCny / USD_TO_CNY).toFixed(4),
      priceCny: model.priceCny,
      dailyLimit: getModelDailyLimit(key)
    };
  }
  res.json(models);
});

// POST /api/ai/host-image - Upload reference image to COS
app.post('/api/ai/host-image', requireAuth, upload.single('image'), async (req, res) => {
  const username = req.authUser.username;
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  
  try {
    const ext = path.extname(req.file.originalname) || '.png';
    const key = 'wan-ref/' + crypto.randomUUID() + ext;
    const url = await uploadToR2(key, req.file.buffer, req.file.mimetype);
    console.log('[IMG] Hosted image uploaded:', url);
    res.json({ url });
  } catch (e) {
    console.error('[IMG] Host image error:', e.message);
    res.status(500).json({ error: '上传失败: ' + e.message });
  }
});

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-RL3e5gM2Y9lGy2nlDjLEq8MFdwfF9qEvzsyOfAQGYkvGDXzE';

// POST /api/ai/wan/generate - 万相2.7 图像生成 (OpenAI compatible via aigcbest)
app.post('/api/ai/wan/generate', requireAuth, async (req, res) => {
  const username = req.authUser.username;
  
  const { prompt, model: modelKey, size, image_url } = req.body;
  if (!prompt) return res.status(400).json({ error: '请输入提示词' });
  
  // 驗證模型
  const modelConfig = IMAGE_MODELS[modelKey];
  if (!modelConfig) {
    return res.status(400).json({ error: '不支持的模型: ' + modelKey });
  }
  
  // 檢查該模型今日配額
  const today = new Date().toISOString().slice(0, 10);
  const allUsage = loadWanUsage();
  const userData = allUsage[username] || { date: today, models: {} };
  
  if (userData.date !== today) {
    userData.date = today;
    userData.models = {};
  }
  
  const used = userData.models[modelKey] || 0;
  const limit = getModelDailyLimit(modelKey, username, today, allUsage);
  
  // admin 不限制
  let isAdmin = false;
  try {
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username);
    isAdmin = user && user.role === 'admin';
  } catch (e) {}
  
  if (!isAdmin && used >= limit) {
    return res.status(429).json({ 
      error: modelConfig.label + ' 今日次數已用完（' + used + '/' + limit + '）',
      models: buildModelsInfo(username, today, allUsage)
    });
  }
  
  try {
    // 計算尺寸 (OpenAI format uses pixel values like 1024x1024)
    const sizeMap = { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096', '16:9': '1792x1024', '16:9_2K': '2048x1152' };
    let actualSize = sizeMap[modelConfig.defaultSize] || '1024x1024';
    if (size && sizeMap[size]) {
      actualSize = sizeMap[size];
    } else if (size && size.includes('x')) {
      actualSize = size;
    }
    
    // wan2.7 / step-image-edit-2 with image uses /images/edits endpoint (multipart/form-data)
    let apiData;
    if ((modelKey === 'wan2.7-image' || modelKey === 'step-image-edit-2') && image_url) {
      const imgResp = await fetch(image_url);
      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      const imgCType = imgResp.headers.get('content-type') || 'image/png';
      
      const boundary = '----WB' + crypto.randomUUID().replace(/-/g, '');
      const crlf = '\r\n';
      
      const parts = [];
      // image part
      parts.push(Buffer.from('--' + boundary + crlf + 'Content-Disposition: form-data; name="image"; filename="ref.png"' + crlf + 'Content-Type: ' + imgCType + crlf + crlf));
      parts.push(imgBuffer);
      parts.push(Buffer.from(crlf));
      // prompt part
      parts.push(Buffer.from('--' + boundary + crlf + 'Content-Disposition: form-data; name="prompt"' + crlf + crlf + prompt + crlf));
      // model part
      parts.push(Buffer.from('--' + boundary + crlf + 'Content-Disposition: form-data; name="model"' + crlf + crlf + modelKey + crlf));
      // n part
      parts.push(Buffer.from('--' + boundary + crlf + 'Content-Disposition: form-data; name="n"' + crlf + crlf + '1' + crlf));
      // response_format part
      parts.push(Buffer.from('--' + boundary + crlf + 'Content-Disposition: form-data; name="response_format"' + crlf + crlf + 'url' + crlf));
      // closing boundary
      parts.push(Buffer.from('--' + boundary + '--' + crlf));
      
      const body = Buffer.concat(parts);
      
      console.log('[IMG]', modelConfig.label, '(edits) for', username, '- prompt:', prompt.substring(0, 50), '- img:', imgBuffer.length, 'bytes');
      
      const apiResp = await fetch('https://api2.aigcbest.top/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + DASHSCOPE_API_KEY,
          'Content-Type': 'multipart/form-data; boundary=' + boundary
        },
        body: body
      });
      
      apiData = await apiResp.json();
      console.log('[IMG] Edits Response:', apiResp.status, '- has data:', !!apiData.data);
      
      if (!apiResp.ok || apiData.error) {
        const errMsg = apiData.error?.message || JSON.stringify(apiData.error).substring(0, 200);
        console.error('[IMG] Edits API error:', errMsg);
        throw new Error(errMsg);
      }
    } else if (modelConfig.apiType === 'imagen') {
      // Imagen native format: uses :predict endpoint with instances/parameters
      const aspectRatio = (size === '16:9' || modelConfig.defaultSize === '16:9') ? '16:9' : '1:1';
      const imagenBody = {
        instances: [{ prompt: prompt }],
        parameters: { sampleCount: 1, aspectRatio: aspectRatio }
      };
      console.log('[IMG]', modelConfig.label, '(imagen) for', username, '- prompt:', prompt.substring(0, 50), '- aspect:', aspectRatio);
      const apiResp = await fetch('https://api2.aigcbest.top/v1beta/models/' + modelKey + ':predict?key=' + DASHSCOPE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imagenBody)
      });
      apiData = await apiResp.json();
      console.log('[IMG] Imagen Response:', apiResp.status, '- predictions:', !!(apiData.predictions && apiData.predictions.length));
      if (!apiResp.ok || apiData.error) {
        const errMsg = apiData.error && apiData.error.message ? apiData.error.message : JSON.stringify(apiData).substring(0, 200);
        console.error('[IMG] Imagen API error:', errMsg);
        throw new Error(errMsg);
      }
      // Parse Imagen response: { predictions: [{ bytesBase64Encoded, mimeType }] }
      const imagenImages = [];
      if (apiData.predictions) {
        for (const pred of apiData.predictions) {
          if (pred.bytesBase64Encoded) imagenImages.push({ b64_json: pred.bytesBase64Encoded });
          else if (pred.image) imagenImages.push({ b64_json: pred.image });
        }
      }
      apiData.data = imagenImages;
    } else if (modelConfig.apiType === 'gemini') {
      // Gemini native format
      const aspectRatio = (size === '16:9' || modelConfig.defaultSize === '16:9') ? '16:9' : '1:1';
      
      const geminiParts = [];
      
      if (image_url) {
        try {
          const imgResp = await fetch(image_url);
          const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
          const imgBase64 = imgBuffer.toString('base64');
          const cType = imgResp.headers.get('content-type') || 'image/png';
          geminiParts.push({ inlineData: { mimeType: cType, data: imgBase64 } });
          console.log('[IMG] Gemini: loaded image, base64 length:', imgBase64.length);
        } catch (imgErr) {
          console.error('[IMG] Gemini: failed to load image:', imgErr.message);
        }
      }
      
      geminiParts.push({ text: prompt });
      
      const geminiBody = {
        contents: [{ role: 'user', parts: geminiParts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: aspectRatio }
        }
      };
      
      console.log('[IMG]', modelConfig.label, '(gemini) for', username, '- prompt:', prompt.substring(0, 50), '- aspect:', aspectRatio);
      
      const apiResp = await fetch('https://api2.aigcbest.top/v1beta/models/' + modelKey + ':generateContent/?key=' + DASHSCOPE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      });
      
      apiData = await apiResp.json();
      console.log('[IMG] Gemini Response:', apiResp.status, '- has candidates:', !!apiData.candidates);
      
      if (!apiResp.ok || apiData.error) {
        const errMsg = apiData.error?.message || JSON.stringify(apiData.error).substring(0, 200);
        console.error('[IMG] Gemini API error:', errMsg);
        throw new Error(errMsg);
      }
      
      // Extract images from Gemini response into apiData.data format
      const gemImageData = [];
      if (apiData.candidates && apiData.candidates[0]?.content?.parts) {
        for (const part of apiData.candidates[0].content.parts) {
          if (part.inlineData) {
            gemImageData.push({ b64_json: part.inlineData.data });
          } else if (part.fileData) {
            gemImageData.push({ url: part.fileData.fileUri });
          }
        }
      }
      apiData.data = gemImageData;
    } else {
      // OpenAI compatible format for other models or text-only
      const requestBody = {
        model: modelKey,
        prompt: prompt,
        size: actualSize,
        n: 1
      };
      
      if (image_url && modelConfig.imageField) {
        requestBody[modelConfig.imageField] = image_url;
      }
      
      console.log('[IMG]', modelConfig.label, 'for', username, '- prompt:', prompt.substring(0, 50), '- size:', actualSize, '- image:', image_url ? 'yes' : 'no');
      
      const apiResp = await fetch('https://api2.aigcbest.top/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + DASHSCOPE_API_KEY
        },
        body: JSON.stringify(requestBody)
      });
      
      apiData = await apiResp.json();
      console.log('[IMG] Response:', apiResp.status, '- has data:', !!apiData.data);
      
      if (!apiResp.ok || apiData.error) {
        const errMsg = apiData.error?.message || JSON.stringify(apiData.error).substring(0, 200);
        console.error('[IMG] API error:', errMsg);
        throw new Error(errMsg);
      }
    }
    
    // 提取圖片 (支持 URL 或 Base64)
    const imageData = apiData.data || [];
    if (imageData.length === 0) {
      throw new Error('API 未返回图片');
    }
    
    // 下載並上傳到 R2 (支持 URL 和 Base64)
    const finalImages = [];
    for (const item of imageData) {
      try {
        let imgBuffer;
        if (item.url && item.url.startsWith('http')) {
          // 從 URL 下載
          const imgResp = await fetch(item.url);
          imgBuffer = Buffer.from(await imgResp.arrayBuffer());
        } else if (item.b64_json) {
          // 從 Base64 解碼
          imgBuffer = Buffer.from(item.b64_json, 'base64');
        } else {
          console.warn('[IMG] No image data in response item');
          continue;
        }
        const key = 'wan-output/' + crypto.randomUUID() + '.png';
        const permanentUrl = await uploadToR2(key, imgBuffer, 'image/png');
        finalImages.push(permanentUrl);
      } catch (dlErr) {
        console.warn('[IMG] Failed to process image:', dlErr.message);
      }
    }
    
    // 更新用量
    userData.models[modelKey] = (userData.models[modelKey] || 0) + 1;
    allUsage[username] = userData;
    saveWanUsage(allUsage);
    
    const newUsed = userData.models[modelKey];
    console.log('[IMG]', modelConfig.label, 'done for', username, '(usage:', newUsed + '/' + limit + ')');
    
    // 保存生成记录到数据库（7天后自动清理）
    try {
      db.prepare(`INSERT INTO wan_generation_history (username, model, prompt, input_image, output_images) VALUES (?, ?, ?, ?, ?)`)
        .run(username, modelKey, prompt, image_url || '', JSON.stringify(finalImages));
    } catch (histErr) {
      console.warn('[IMG] Failed to save history:', histErr.message);
    }
    
    res.json({
      images: finalImages,
      models: buildModelsInfo(username, today, allUsage)
    });
  } catch (e) {
    console.error('[IMG] Generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// 輔助函數：構建模型資訊
function buildModelsInfo(username, today, allUsage) {
  const userData = allUsage[username];
  if (!userData || userData.date !== today) return null;
  
  const modelsInfo = {};
  for (const [key, model] of Object.entries(IMAGE_MODELS)) {
    const used = (userData.models && userData.models[key]) || 0;
    const limit = getModelDailyLimit(key, username, today, allUsage);
    modelsInfo[key] = {
      label: model.label,
      used: used,
      limit: limit,
      remaining: Math.max(0, limit - used),
      priceCny: model.priceCny
    };
  }
  return modelsInfo;
}

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
app.get('/api/ai/wan/history', requireAuth, (req, res) => {
  const username = req.authUser.username;
  
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

// === Video API Proxy (Sora 2, Seedance, Kling, Minimax) ===
const ZZ_VIDEO_API_KEY = process.env.ZHIZENGZENG_API_KEY || process.env.ZZ_API_KEY || 'sk-zk21a2660d7104b3c7cc3ad7404326f5a3a6a22b4daacfbc';
const ZZ_VIDEO_API_URL = process.env.APIYI_VIDEO_URL || "https://api2.aigcbest.top";

// Map aspect ratio to pixel size
const ASPECT_TO_SIZE = {
  '16:9': '1280x720',
  '9:16': '720x1280',
  '1:1': '1024x1024',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '21:9': '1792x768',
  '3:2': '1536x1024',
  '2:3': '1024x1536'
};

// Map frontend size names to pixel size
const SIZE_NAME_MAP = {
  '720p': '1280x720',
  '1080p': '1920x1080',
  '480p': '854x480'
};

// Validate seconds - only 4, 8, 12 supported
function normalizeSeconds(seconds) {
  const s = parseInt(seconds);
  if (s <= 6) return '4';
  if (s <= 10) return '8';
  return '12';
}

app.post('/api/video/generate', async (req, res) => {
  try {
    // Accept both frontend (duration, ratio) and backend (seconds, size) param names
    const { model, prompt, seconds, size, duration, ratio, resolution, image_url } = req.body;
    if (!model || !prompt) return res.status(400).json({ error: '缺少必要参数' });
    
    // Normalize parameters
    const actualSeconds = normalizeSeconds(seconds || duration || 5);
    
    // Convert aspect ratio or size name to pixel dimensions
    let actualSize = '1280x720'; // default
    const ratioOrSize = size || ratio || '16:9';
    if (ASPECT_TO_SIZE[ratioOrSize]) {
      actualSize = ASPECT_TO_SIZE[ratioOrSize];
    } else if (SIZE_NAME_MAP[ratioOrSize]) {
      actualSize = SIZE_NAME_MAP[ratioOrSize];
    } else if (ratioOrSize.includes('x')) {
      actualSize = ratioOrSize; // Already in pixel format
    }
    
    // Build request body
    const requestBody = { 
      model, 
      prompt, 
      seconds: actualSeconds, 
      size: actualSize 
    };
    if (image_url) {
      requestBody.image_url = image_url;
    }
    
    console.log('[VIDEO] Generate:', model, '- prompt:', prompt.substring(0, 50), '- seconds:', actualSeconds, '- size:', actualSize);
    
    const resp = await fetch(`${ZZ_VIDEO_API_URL}/v1/videos`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${ZZ_VIDEO_API_KEY}` 
      },
      body: JSON.stringify(requestBody)
    });
    const data = await resp.json();
    
    if (!resp.ok) {
      console.error('[VIDEO] API error:', JSON.stringify(data).substring(0, 500));
      return res.status(resp.status).json({ error: data.error?.message || '提交失败' });
    }
    
    console.log('[VIDEO] Task submitted:', data.id);
    res.json(data);
  } catch (e) {
    console.error('[VIDEO] Generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/video/status/:id', async (req, res) => {
  try {
    const resp = await fetch(`${ZZ_VIDEO_API_URL}/v1/videos/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${ZZ_VIDEO_API_KEY}` }
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
    const resp = await fetch(`${ZZ_VIDEO_API_URL}/v1/videos/${req.params.id}/content`, {
      headers: { 'Authorization': `Bearer ${ZZ_VIDEO_API_KEY}` }
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


// === MiniMax Voice Clone ===
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';

// Upload voice sample and clone
app.post('/api/voice/clone', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    const username = req.authUser.username;
    const user = req.authUser;

    if (!MINIMAX_API_KEY) return res.json({ ok: false, error: '语音服务未配置' });
    if (!req.file) return res.json({ ok: false, error: '请上传音频文件' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.mp3', '.m4a', '.wav'].includes(ext)) {
      return res.json({ ok: false, error: '仅支持 mp3, m4a, wav 格式' });
    }

    // Check file size (max 20MB)
    if (req.file.size > 20 * 1024 * 1024) {
      return res.json({ ok: false, error: '文件大小不能超过 20MB' });
    }

    // Step 1: Upload file to MiniMax
    const formData = new FormData();
    formData.append('purpose', 'voice_clone');
    formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

    const uploadResp = await fetch(MINIMAX_BASE_URL + '/files/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + MINIMAX_API_KEY },
      body: formData
    });
    const uploadData = await uploadResp.json();

    if (uploadData.base_resp?.status_code !== 0) {
      console.error('[Voice Clone] Upload failed:', uploadData);
      return res.json({ ok: false, error: '音频上传失败: ' + (uploadData.base_resp?.status_msg || '未知错误') });
    }

    const fileId = uploadData.file.file_id;
    console.log('[Voice Clone] File uploaded, file_id:', fileId);

    // Step 2: Clone voice
    const voiceId = 'lizi_v_' + user.id + '_' + Date.now();
    const cloneBody = {
      file_id: fileId,
      voice_id: voiceId,
      language_boost: 'Chinese'
    };

    const cloneResp = await fetch(MINIMAX_BASE_URL + '/voice_clone', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + MINIMAX_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cloneBody)
    });
    const cloneData = await cloneResp.json();

    if (cloneData.base_resp?.status_code !== 0) {
      console.error('[Voice Clone] Clone failed:', cloneData);
      return res.json({ ok: false, error: '声音克隆失败: ' + (cloneData.base_resp?.status_msg || '未知错误') });
    }

    // Step 3: Save to DB (delete any existing clone first)
    db.prepare('DELETE FROM voice_clones WHERE username = ?').run(username);
    db.prepare(
      'INSERT INTO voice_clones (user_id, username, voice_id, demo_url, status) VALUES (?, ?, ?, ?, ?)'
    ).run(user.id, username, voiceId, cloneData.demo_audio || '', 'ready');

    await syncDB();
    console.log('[Voice Clone] Success for', username, '- voice_id:', voiceId);

    res.json({
      ok: true,
      voice: {
        voice_id: voiceId,
        demo_url: cloneData.demo_audio || ''
      }
    });
  } catch (e) {
    console.error('[Voice Clone] Error:', e.message);
    res.json({ ok: false, error: '克隆失败: ' + e.message });
  }
});

// Get voice clone status
app.get('/api/voice/status', requireAuth, (req, res) => {
  const username = req.authUser.username;

  const clone = db.prepare('SELECT * FROM voice_clones WHERE username = ?').get(username);
  if (!clone) {
    return res.json({ ok: false, cloned: false });
  }

  res.json({
    ok: true,
    cloned: true,
    voice: {
      voice_id: clone.voice_id,
      demo_url: clone.demo_url,
      status: clone.status,
      created_at: clone.created_at
    }
  });
});

// TTS with cloned voice
app.post('/api/voice/tts', requireAuth, async (req, res) => {
  try {
    const username = req.authUser.username;
    const { text, model, speed } = req.body;
    if (!text || !text.trim()) return res.json({ ok: false, error: '请输入文本' });

    const clone = db.prepare('SELECT * FROM voice_clones WHERE username = ?').get(username);
    if (!clone || clone.status !== 'ready') {
      return res.json({ ok: false, error: '请先克隆声音' });
    }

    const ttsResp = await fetch(MINIMAX_BASE_URL + '/t2a_v2', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + MINIMAX_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'speech-2.8-hd',
        text: text.trim().slice(0, 5000),
        stream: false,
        voice_setting: {
          voice_id: clone.voice_id,
          speed: speed || 1.0,
          vol: 1,
          pitch: 0
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1
        },
        language_boost: 'auto',
        output_format: 'url'
      })
    });

    const ttsData = await ttsResp.json();

    if (ttsData.base_resp?.status_code !== 0) {
      console.error('[Voice TTS] Error:', ttsData);
      return res.json({ ok: false, error: '语音生成失败: ' + (ttsData.base_resp?.status_msg || '未知错误') });
    }

    // output_format=url returns a URL in data.audio
    const audioUrl = ttsData.data?.audio || '';
    const extraInfo = ttsData.extra_info || {};

    res.json({
      ok: true,
      audio_url: audioUrl,
      duration_ms: extraInfo.audio_length || 0,
      chars: extraInfo.usage_characters || 0
    });
  } catch (e) {
    console.error('[Voice TTS] Error:', e.message);
    res.json({ ok: false, error: '生成失败: ' + e.message });
  }
});

// Delete voice clone
app.delete('/api/voice/clone', requireAuth, async (req, res) => {
  try {
    const username = req.authUser.username;

    const clone = db.prepare('SELECT * FROM voice_clones WHERE username = ?').get(username);
    if (!clone) return res.json({ ok: false, error: '未找到克隆声音' });

    // Delete from MiniMax
    if (MINIMAX_API_KEY) {
      try {
        await fetch(MINIMAX_BASE_URL + '/voice/delete', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + MINIMAX_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ voice_id: clone.voice_id })
        });
      } catch (e) {
        console.error('[Voice Clone] MiniMax delete error:', e.message);
      }
    }

    db.prepare('DELETE FROM voice_clones WHERE username = ?').run(username);
    await syncDB();

    res.json({ ok: true });
  } catch (e) {
    console.error('[Voice Delete] Error:', e.message);
    res.json({ ok: false, error: '删除失败: ' + e.message });
  }
});

// Map /voice/ to voice.html
app.get("/voice/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "voice.html"));
});

// === SPA Catch-all: serve index.html for any unmatched GET routes ===
// This fixes "NOT FOUND" when users bookmark or directly visit sub-page URLs on mobile/desktop
app.get('*', (req, res, next) => {
  // Skip API routes and static files
  if (req.path.startsWith('/api/') || req.path.startsWith('/assets/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function main() {
  await initR2();
  await setupDBSync();
  
  // Initialize AI system
  initAITables(db);
  app.locals.db = db; // Make db accessible to AI system
  app.locals.uploadToR2 = uploadToR2; // Make R2 upload accessible to AI video system
  // === Chat Proxy to voice-app ===
  app.all('/api/ai/proxy/apiyi/*', async (req, res) => {
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
    console.log(`栗子素材网 running on http://0.0.0.0:${PORT} | R2: ${USE_R2 ? 'enabled' : 'disabled'}`);
  });
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
