const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const USE_R2 = !!(R2_BUCKET && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

let db;
function initDB() {
  const sqlite3 = require('better-sqlite3');
  const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'data', 'lizi.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = sqlite3(DB_PATH);
  db.pragma('journal_mode = WAL');
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
      cat TEXT NOT NULL,
      files TEXT DEFAULT '[]',
      img TEXT DEFAULT '',
      imgs TEXT DEFAULT '[]',
      fla TEXT DEFAULT '',
      grad TEXT DEFAULT '',
      is_new INTEGER DEFAULT 0,
      limit_flag INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      desc TEXT NOT NULL,
      contact TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      douyin TEXT DEFAULT '',
      bilibili TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, ?)')
      .run('admin', crypto.createHash('md5').update('admin123').digest('hex'), 'admin', 0);
  }
  try { db.exec('ALTER TABLE materials ADD COLUMN limit_flag INTEGER DEFAULT 0'); } catch(e) {}
}

let s3Client = null;

async function initR2() {
  if (!USE_R2) { console.log('R2 not configured. Using local disk.'); return; }
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  s3Client = {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
    }),
    PutObjectCommand,
    DeleteObjectCommand
  };
  console.log('R2 storage configured.');
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
  // Extract the key from a full URL or use as-is
  let key = url;
  if (url.startsWith('http')) {
    // URL format: https://R2_PUBLIC_URL/uploads/xxx.ext
    const prefix = R2_PUBLIC_URL ? R2_PUBLIC_URL + '/' : '';
    key = url.replace(prefix, '');
  }
  try {
    await s3Client.client.send(new s3Client.DeleteObjectCommand({
      Bucket: R2_BUCKET, Key: key
    }));
  } catch(e) {
    console.error('R2 delete error:', e.message, 'key:', key);
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function hashPwd(p) { return crypto.createHash('md5').update(p).digest('hex'); }

app.post('/api/login', (req, res) => {
  const { username, password, deviceId } = req.body;
  if (!username || !password) return res.json({ ok: false, error: '请输入用户名和密码' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(password)) return res.json({ ok: false, error: '用户名或密码错误' });
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (username, device_id, token) VALUES (?, ?, ?)').run(username, deviceId || '', token);
  res.json({ ok: true, user: { username: user.username, role: user.role }, forcePwdChange: !!user.force_pwd_change });
});

app.post('/api/changePwd', (req, res) => {
  const { username, oldPwd, newPwd } = req.body;
  if (!oldPwd || !newPwd || newPwd.length < 4) return res.json({ ok: false, error: '新密码至少4位' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(oldPwd)) return res.json({ ok: false, error: '当前密码错误' });
  db.prepare('UPDATE users SET password = ?, force_pwd_change = 0 WHERE username = ?').run(hashPwd(newPwd), username);
  res.json({ ok: true });
});

app.post('/api/admin/addUser', (req, res) => {
  const { adminUsername, newUsername, role } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (!newUsername || newUsername.length < 2) return res.json({ ok: false, error: '用户名至少2个字符' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(newUsername)) return res.json({ ok: false, error: '用户名已存在' });
  db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, 1)').run(newUsername, hashPwd('123456'), role || 'user');
  res.json({ ok: true });
});

app.post('/api/admin/delUser', (req, res) => {
  const { adminUsername, targetUsername } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (targetUsername === 'admin') return res.json({ ok: false, error: '不能删除管理员' });
  db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
  res.json({ ok: true });
});

app.post('/api/admin/toggleRole', (req, res) => {
  const { adminUsername, targetUsername } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(targetUsername);
  if (!target) return res.json({ ok: false, error: '用户不存在' });
  const roles = ['user', 'promo', 'vip'];
  const newRole = roles[(roles.indexOf(target.role) + 1) % roles.length];
  db.prepare('UPDATE users SET role = ? WHERE username = ?').run(newRole, targetUsername);
  res.json({ ok: true, newRole });
});

app.get('/api/admin/users', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.query.adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  res.json({ ok: true, users: db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all() });
});

app.get('/api/materials', (req, res) => {
  const items = db.prepare('SELECT * FROM materials ORDER BY created_at DESC').all();
  res.json({ ok: true, items: items.map(item => ({
    ...item,
    files: JSON.parse(item.files || '[]'),
    imgs: JSON.parse(item.imgs || '[]'),
    isNew: !!item.is_new,
    limit: !!item.limit_flag
  }))});
});

app.post('/api/materials', upload.fields({ images: 5, fla: 1 }), async (req, res) => {
  const { username, name, cat, files, isNew, limit } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  if (!name) return res.json({ ok: false, error: '请输入名称' });
  const imgFiles = req.files['images'] || [];
  const flaFile = req.files['fla'] ? req.files['fla'][0] : null;
  const imgPaths = [];
  for (const f of imgFiles) {
    const key = `uploads/${Date.now()}-${Math.round(Math.random()*1E9)}${path.extname(f.originalname)}`;
    imgPaths.push(await uploadToR2(key, f.buffer, f.mimetype));
  }
  let flaPath = '';
  if (flaFile) {
    const key = `uploads/${Date.now()}-${Math.round(Math.random()*1E9)}.fla`;
    flaPath = await uploadToR2(key, flaFile.buffer, 'application/octet-stream');
  }
  db.prepare(`INSERT INTO materials (name, cat, files, img, imgs, fla, grad, is_new, limit_flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, cat, JSON.stringify(files ? files.split(',').map(s=>s.trim()) : []), imgPaths[0]||'', JSON.stringify(imgPaths), flaPath, '', isNew==='true'?1:0, limit==='true'?1:0);
  res.json({ ok: true });
});

app.post('/api/materials/update', upload.fields({ images: 5, fla: 1 }), async (req, res) => {
  const { username, id, name, cat, files, isNew, limit } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  if (!name) return res.json({ ok: false, error: '请输入名称' });
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!material) return res.json({ ok: false, error: '素材不存在' });
  let imgPaths = JSON.parse(material.imgs || '[]');
  for (const f of (req.files['images'] || [])) {
    const key = `uploads/${Date.now()}-${Math.round(Math.random()*1E9)}${path.extname(f.originalname)}`;
    imgPaths.push(await uploadToR2(key, f.buffer, f.mimetype));
  }
  let flaPath = material.fla || '';
  if (req.files['fla'] && req.files['fla'][0]) {
    flaPath = await uploadToR2(`uploads/${Date.now()}-${Math.round(Math.random()*1E9)}.fla`, req.files['fla'][0].buffer, 'application/octet-stream');
  }
  db.prepare(`UPDATE materials SET name=?, cat=?, files=?, img=?, imgs=?, fla=?, is_new=?, limit_flag=? WHERE id=?`)
    .run(name, cat, JSON.stringify(files ? files.split(',').map(s=>s.trim()) : JSON.parse(material.files)), imgPaths[0]||material.img||'', JSON.stringify(imgPaths), flaPath, isNew==='true'?1:0, limit==='true'?1:0, id);
  res.json({ ok: true });
});

app.post('/api/materials/delete', async (req, res) => {
  const { username, id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (material) {
    if (material.fla) await deleteFromR2(material.fla);
    try { JSON.parse(material.imgs||'[]').forEach(u => deleteFromR2(u)); } catch(e) {}
    if (material.img) await deleteFromR2(material.img);
  }
  db.prepare('DELETE FROM materials WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/requests', upload.single('images'), async (req, res) => {
  const { desc, contact } = req.body;
  if (!desc || !contact) return res.json({ ok: false, error: '请填写完整信息' });
  let imgPaths = [];
  if (req.file) {
    const key = `uploads/${Date.now()}-${Math.round(Math.random()*1E9)}${path.extname(req.file.originalname)}`;
    imgPaths = [await uploadToR2(key, req.file.buffer, req.file.mimetype)];
  }
  db.prepare('INSERT INTO requests (desc, contact, images) VALUES (?, ?, ?)').run(desc, contact, JSON.stringify(imgPaths));
  res.json({ ok: true });
});

app.get('/api/requests', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.query.adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  const requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  res.json({ ok: true, requests: requests.map(r => ({ ...r, images: JSON.parse(r.images||'[]') })) });
});

app.post('/api/requests/read', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.body.adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  req.body.ids.forEach(id => db.prepare('UPDATE requests SET read = 1 WHERE id = ?').run(id));
  res.json({ ok: true });
});

app.get('/api/requests/count', (req, res) => {
  res.json({ ok: true, count: db.prepare('SELECT COUNT(*) as cnt FROM requests WHERE read = 0').get().cnt });
});

app.get('/api/me', (req, res) => {
  const user = db.prepare('SELECT username, role FROM users WHERE username = ?').get(req.query.username);
  if (!user) return res.json({ ok: false, error: '用户不存在' });
  const binding = db.prepare('SELECT * FROM bindings WHERE username = ?').get(user.username);
  res.json({ ok: true, user, bindings: binding ? { douyin: binding.douyin, bilibili: binding.bilibili } : {} });
});

app.post('/api/bind-accounts', (req, res) => {
  const { username, douyin, bilibili } = req.body;
  const existing = db.prepare('SELECT id FROM bindings WHERE username = ?').get(username);
  if (existing) db.prepare('UPDATE bindings SET douyin = ?, bilibili = ? WHERE username = ?').run(douyin, bilibili, username);
  else db.prepare('INSERT INTO bindings (username, douyin, bilibili) VALUES (?, ?, ?)').run(username, douyin, bilibili);
  res.json({ ok: true });
});

async function main() {
  await initR2();
  initDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`栗子素材网 running on http://0.0.0.0:${PORT} | R2: ${USE_R2?'enabled':'disabled'}`);
  });
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
