const express = require('express');
const sqlite3 = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// === Storage setup ===
const UPLOADS_DIR = path.join(__dirname, 'public', 'assets');
const DB_PATH = path.join(__dirname, 'data', 'lizi.db');

// Ensure directories exist
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// === Database ===
const db = sqlite3(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
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

// Seed default admin user
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, ?)')
    .run('admin', crypto.createHash('md5').update('admin123').digest('hex'), 'admin', 0);
}

// === Middleware ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// === Helper ===
function hashPwd(p) { return crypto.createHash('md5').update(p).digest('hex'); }

// === API Routes ===

// Login
app.post('/api/login', (req, res) => {
  const { username, password, deviceId } = req.body;
  if (!username || !password) return res.json({ ok: false, error: '请输入用户名和密码' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '用户名或密码错误' });
  if (user.password !== hashPwd(password)) return res.json({ ok: false, error: '用户名或密码错误' });

  // Save session
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (username, device_id, token) VALUES (?, ?, ?)')
    .run(username, deviceId || '', token);

  res.json({
    ok: true,
    user: { username: user.username, role: user.role },
    forcePwdChange: !!user.force_pwd_change
  });
});

// Change password
app.post('/api/changePwd', (req, res) => {
  const { username, oldPwd, newPwd } = req.body;
  if (!oldPwd || !newPwd || newPwd.length < 4) return res.json({ ok: false, error: '新密码至少4位' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(oldPwd)) return res.json({ ok: false, error: '当前密码错误' });

  db.prepare('UPDATE users SET password = ?, force_pwd_change = 0 WHERE username = ?')
    .run(hashPwd(newPwd), username);
  res.json({ ok: true });
});

// Admin: add user
app.post('/api/admin/addUser', (req, res) => {
  const { adminUsername, newUsername, role } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (!newUsername || newUsername.length < 2) return res.json({ ok: false, error: '用户名至少2个字符' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(newUsername);
  if (exists) return res.json({ ok: false, error: '用户名已存在' });

  db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, 1)')
    .run(newUsername, hashPwd('123456'), role || 'user');
  res.json({ ok: true });
});

// Admin: delete user
app.post('/api/admin/delUser', (req, res) => {
  const { adminUsername, targetUsername } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (targetUsername === 'admin') return res.json({ ok: false, error: '不能删除管理员' });

  db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
  res.json({ ok: true });
});

// Admin: toggle role
app.post('/api/admin/toggleRole', (req, res) => {
  const { adminUsername, targetUsername } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });

  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(targetUsername);
  if (!target) return res.json({ ok: false, error: '用户不存在' });

  const roles = ['user', 'promo', 'vip'];
  const idx = roles.indexOf(target.role);
  const newRole = roles[(idx + 1) % roles.length];
  db.prepare('UPDATE users SET role = ? WHERE username = ?').run(newRole, targetUsername);
  res.json({ ok: true, newRole });
});

// Admin: list users
app.get('/api/admin/users', (req, res) => {
  const adminUsername = req.query.adminUsername;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });

  const users = db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all();
  res.json({ ok: true, users });
});

// Get materials
app.get('/api/materials', (req, res) => {
  const items = db.prepare('SELECT * FROM materials ORDER BY created_at DESC').all();
  // Parse JSON fields
  const parsed = items.map(item => ({
    ...item,
    files: JSON.parse(item.files || '[]'),
    imgs: JSON.parse(item.imgs || '[]'),
    isNew: !!item.is_new,
    limit: !!item.limit_flag
  }));
  res.json({ ok: true, items: parsed });
});

// Add material
app.post('/api/materials', upload.fields({ images: 5, fla: 1 }), (req, res) => {
  const { username, name, cat, files, isNew, limit } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  if (!name) return res.json({ ok: false, error: '请输入名称' });

  const imgFiles = req.files['images'] || [];
  const flaFile = req.files['fla'] ? req.files['fla'][0] : null;

  const imgPaths = imgFiles.map(f => '/assets/uploads/' + f.filename);
  const flaPath = flaFile ? '/assets/uploads/' + flaFile.filename : '';
  const firstImg = imgPaths[0] || '';
  const grad = '';

  db.prepare(`INSERT INTO materials (name, cat, files, img, imgs, fla, grad, is_new, limit_flag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, cat, JSON.stringify(files ? files.split(',').map(s => s.trim()) : []),
      firstImg, JSON.stringify(imgPaths), flaPath, grad, isNew === 'true' ? 1 : 0, limit === 'true' ? 1 : 0);
  res.json({ ok: true });
});

// Update material
app.post('/api/materials/update', upload.fields({ images: 5, fla: 1 }), (req, res) => {
  const { username, id, name, cat, files, isNew, limit } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  if (!name) return res.json({ ok: false, error: '请输入名称' });

  const imgFiles = req.files['images'] || [];
  const flaFile = req.files['fla'] ? req.files['fla'][0] : null;

  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  let imgPaths = JSON.parse(material.imgs || '[]');
  const newImgPaths = imgFiles.map(f => '/assets/uploads/' + f.filename);
  if (newImgPaths.length > 0) imgPaths = [...imgPaths, ...newImgPaths];
  const flaPath = flaFile ? '/assets/uploads/' + flaFile.filename : (material.fla || '');
  const firstImg = imgPaths[0] || material.img || '';

  db.prepare(`UPDATE materials SET name=?, cat=?, files=?, img=?, imgs=?, fla=?, is_new=?, limit_flag=?
    WHERE id=?`)
    .run(name, cat, JSON.stringify(files ? files.split(',').map(s => s.trim()) : JSON.parse(material.files)),
      firstImg, JSON.stringify(imgPaths), flaPath, isNew === 'true' ? 1 : 0, limit === 'true' ? 1 : 0, id);
  res.json({ ok: true });
});

// Delete material
app.post('/api/materials/delete', (req, res) => {
  const { username, id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });

  db.prepare('DELETE FROM materials WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Submit request
app.post('/api/requests', upload.single('images'), (req, res) => {
  const { desc, contact } = req.body;
  if (!desc || !contact) return res.json({ ok: false, error: '请填写完整信息' });

  const imgPaths = req.file ? ['/assets/uploads/' + req.file.filename] : [];
  db.prepare('INSERT INTO requests (desc, contact, images) VALUES (?, ?, ?)')
    .run(desc, contact, JSON.stringify(imgPaths));
  res.json({ ok: true });
});

// Get requests (admin)
app.get('/api/requests', (req, res) => {
  const adminUsername = req.query.adminUsername;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });

  const requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  const parsed = requests.map(r => ({ ...r, images: JSON.parse(r.images || '[]') }));
  res.json({ ok: true, requests: parsed });
});

// Mark request as read
app.post('/api/requests/read', (req, res) => {
  const { adminUsername, ids } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });

  ids.forEach(id => db.prepare('UPDATE requests SET read = 1 WHERE id = ?').run(id));
  res.json({ ok: true });
});

// Count unread requests
app.get('/api/requests/count', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM requests WHERE read = 0').get();
  res.json({ ok: true, count: count.cnt });
});

// Get user info
app.get('/api/me', (req, res) => {
  const username = req.query.username;
  const user = db.prepare('SELECT username, role FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '用户不存在' });

  const binding = db.prepare('SELECT * FROM bindings WHERE username = ?').get(username);
  res.json({ ok: true, user, bindings: binding ? { douyin: binding.douyin, bilibili: binding.bilibili } : {} });
});

// Save bindings
app.post('/api/bind-accounts', (req, res) => {
  const { username, douyin, bilibili } = req.body;
  const existing = db.prepare('SELECT id FROM bindings WHERE username = ?').get(username);

  if (existing) {
    db.prepare('UPDATE bindings SET douyin = ?, bilibili = ? WHERE username = ?').run(douyin, bilibili, username);
  } else {
    db.prepare('INSERT INTO bindings (username, douyin, bilibili) VALUES (?, ?, ?)').run(username, douyin, bilibili);
  }
  res.json({ ok: true });
});

// === Start ===
app.listen(PORT, () => {
  console.log(`栗子素材网 running on http://localhost:${PORT}`);
});
