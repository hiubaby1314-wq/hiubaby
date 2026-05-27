const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-2d81719a7aaf43a19e0ac4120399b44f.r2.dev';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const USE_R2 = !!(R2_BUCKET && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
const DB_KEY = 'lizi.db';
const DB_PATH = path.join(__dirname, 'data', 'lizi.db');
let db;

// === Database ===
function initDB() {
  const sqlite3 = require('better-sqlite3');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = sqlite3(DB_PATH);
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
  `);

  // Add missing columns if needed
  try { db.exec('ALTER TABLE materials ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN downloads INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN gradient INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN badges TEXT DEFAULT \'["版权","new"]\''); } catch(e) {}

  // Create admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, ?)')
      .run('admin', crypto.createHash('md5').update('admin123').digest('hex'), 'admin', 0);
  }
}

// === R2 Storage ===
let s3Client = null;

async function initR2() {
  if (!USE_R2) { console.log('R2 not configured. Using local disk.'); return; }
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  s3Client = {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
    }),
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand
  };
  console.log('R2 storage configured.');
}

async function downloadFromR2(key) {
  if (!s3Client) return null;
  try {
    const res = await s3Client.client.send(new s3Client.GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const buffer = Buffer.from(await res.Body.transformToByteArray());
    return buffer;
  } catch(e) {
    if (e.name === 'NoSuchKey') return null;
    console.error('R2 download error:', e.message);
    return null;
  }
}

async function uploadToR2(key, buffer, contentType) {
  if (!s3Client) return key;
  await s3Client.client.send(new s3Client.PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType || 'application/octet-stream'
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function deleteFromR2(url) {
  if (!s3Client) return;
  let key = url;
  if (url.startsWith('http')) {
    const prefix = R2_PUBLIC_URL ? R2_PUBLIC_URL + '/' : '';
    key = url.replace(prefix, '');
  }
  try {
    await s3Client.client.send(new s3Client.DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch(e) {
    console.error('R2 delete error:', e.message, 'key:', key);
  }
}

// === Middleware ===
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function hashPwd(p) { return crypto.createHash('md5').update(p).digest('hex'); }

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
  if (USE_R2) {
    await uploadDB().catch(e => console.error('DB sync failed:', e.message));
  }
}

// === DB Auto-sync ===
// Fallback sync every 30s in case immediate sync misses something
if (USE_R2) {
  setInterval(() => {
    syncDB().catch(e => console.error('Auto-sync failed:', e.message));
  }, 30000);
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
  const materials = db.prepare('SELECT * FROM materials ORDER BY sort_order, id DESC').all();
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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: '请输入用户名和密码' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(password)) return res.json({ ok: false, error: '用户名或密码错误' });
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

// Change password
app.post('/api/changePwd', (req, res) => {
  const { username, oldPwd, newPwd } = req.body;
  if (!oldPwd || !newPwd || newPwd.length < 4) return res.json({ ok: false, error: '新密码至少4位' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(oldPwd)) return res.json({ ok: false, error: '当前密码错误' });
  db.prepare('UPDATE users SET password = ?, force_pwd_change = 0 WHERE username = ?').run(hashPwd(newPwd), username);
  res.json({ ok: true });
});

// === Users ===
app.get('/api/users', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.query.username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  res.json({ ok: true, users: db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all() });
});

app.post('/api/users', async (req, res) => {
  const { adminUsername, username, role } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (!username || username.length < 2) return res.json({ ok: false, error: '用户名至少2个字符' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.json({ ok: false, error: '用户名已存在' });
  db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, 1)').run(username, hashPwd('123456'), role || 'user');
  res.json({ ok: true });
  await syncDB();
});

app.delete('/api/users/:username', async (req, res) => {
  const { adminUsername } = req.body;
  const targetUsername = req.params.username;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (targetUsername === 'admin') return res.json({ ok: false, error: '不能删除管理员' });
  db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
  res.json({ ok: true });
  await syncDB();
});

// === Materials ===
app.get('/api/materials', (req, res) => {
  res.json({ ok: true, materials: getAllMaterials() });
});

// Add material with file uploads
app.post('/api/materials', upload.array('files', 20), async (req, res) => {
  const { username, name, cat, badges, gradient, overwrite } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  if (!name) return res.json({ ok: false, error: '请输入名称' });

  // Check for duplicate name
  const existing = db.prepare('SELECT * FROM materials WHERE name = ?').get(name);
  if (existing && !overwrite) {
    return res.json({ ok: false, error: 'duplicate', duplicateName: name, existingId: existing.id });
  }

  // If overwrite is true, delete existing material and its files
  if (existing && overwrite) {
    const oldFiles = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(existing.id);
    await Promise.all(oldFiles.map(f => f.path && f.path.startsWith('http') ? deleteFromR2(f.path) : Promise.resolve()));
    db.prepare('DELETE FROM material_files WHERE material_id = ?').run(existing.id);
    db.prepare('DELETE FROM materials WHERE id = ?').run(existing.id);
  }

  const matBadges = badges ? badges.split(',').map(s => s.trim()) : ['版权', 'new'];
  const grad = gradient !== undefined ? parseInt(gradient) : Math.floor(Math.random() * 25);

  const result = db.prepare('INSERT INTO materials (name, cat, badges, gradient) VALUES (?, ?, ?, ?)')
    .run(name, cat || '表情包', JSON.stringify(matBadges), grad);
  const materialId = result.lastInsertRowid;

  // Upload files
  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    const url = await uploadToR2(key, f.buffer, f.mimetype);
    db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
      .run(materialId, f.originalname, url, ext, f.size, f.mimetype);
  }

  res.json({ ok: true, materials: getAllMaterials() });
  await syncDB();
});

// Upload files to existing material
app.post('/api/materials/:id/upload', upload.array('files', 20), async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = req.params.id;
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    const url = await uploadToR2(key, f.buffer, f.mimetype);
    db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
      .run(materialId, f.originalname, url, ext, f.size, f.mimetype);
  }

  res.json({ ok: true, material: getMaterialWithFiles(materialId) });
  await syncDB();
});

// Update material
app.put('/api/materials/:id', async (req, res) => {
  const { username, name, cat, badges, gradient } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = req.params.id;
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const updates = {};
  if (name) updates.name = name;
  if (cat) updates.cat = cat;
  if (badges) updates.badges = JSON.stringify(Array.isArray(badges) ? badges : badges.split(',').map(s => s.trim()));
  if (gradient !== undefined) updates.gradient = parseInt(gradient);

  if (Object.keys(updates).length > 0) {
    const sets = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), materialId];
    db.prepare(`UPDATE materials SET ${sets} WHERE id = ?`).run(...vals);
  }

  res.json({ ok: true, materials: getAllMaterials() });
  await syncDB();
});

// Delete material
app.delete('/api/materials/:id', async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = req.params.id;

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
app.post('/api/materials/reorder', (req, res) => {
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
app.post('/api/download', (req, res) => {
  const { username, materialIndex } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '请先登录' });

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

// === Requests ===
app.post('/api/requests', upload.array('images', 5), async (req, res) => {
  const { username, content, contact } = req.body;
  if (!content) return res.json({ ok: false, error: '请填写需求描述' });

  const imgPaths = [];
  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
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

  res.json({ ok: true });
});

app.get('/api/requests', (req, res) => {
  const requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  res.json({ ok: true, requests: requests.map(r => ({
    ...r,
    images: JSON.parse(r.images || '[]')
  }))});
});

app.delete('/api/requests/:id', (req, res) => {
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

app.post('/api/notifications/read', (req, res) => {
  const { username } = req.body;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user = ?').run(username);
  res.json({ ok: true });
});

// === Bindings ===
app.post('/api/bindings', (req, res) => {
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

app.delete('/api/bindings/:platform', (req, res) => {
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

// === Start ===
async function uploadDB() {
  if (!s3Client || !db) return;
  try {
    // Checkpoint WAL to main file before upload
    db.pragma('wal_checkpoint(TRUNCATE)');
    const buffer = fs.readFileSync(DB_PATH);
    await s3Client.client.send(new s3Client.PutObjectCommand({
      Bucket: R2_BUCKET, Key: DB_KEY, Body: buffer, ContentType: 'application/octet-stream'
    }));
    console.log('DB synced to R2');
  } catch(e) {
    console.error('DB upload to R2 failed:', e.message);
  }
}

async function setupDBSync() {
  if (USE_R2) {
    console.log('Checking for DB in R2...');
    const dbBuffer = await downloadFromR2(DB_KEY);
    if (dbBuffer) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, dbBuffer);
      console.log('DB restored from R2 (' + dbBuffer.length + ' bytes)');
    } else {
      console.log('No DB found in R2, will create new');
    }
  }
  initDB();
}

async function main() {
  await initR2();
  await setupDBSync();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`栗子素材网 running on http://0.0.0.0:${PORT} | R2: ${USE_R2 ? 'enabled' : 'disabled'}`);
  });
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
