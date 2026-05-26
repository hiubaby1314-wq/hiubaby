const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

// R2 Configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'ae5c20bd97e1d547c9913ad516ece101';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '0f358a57deb0de1f5513ddff3870fa8b';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'ed9df48853677e8e7533a9c1fec821598b45e3ca9afb5a0aabfa46c9da451952';
const R2_BUCKET = process.env.R2_BUCKET || 'lizi-sucai';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-3f0122397fcb4559b8be753ba492c857.r2.dev';
const R2_MATERIAL_PREFIX = process.env.R2_MATERIAL_PREFIX || 'lizi-sucai/';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// Helper: Upload file to R2
async function uploadToR2(key, buffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await r2Client.send(command);
  return `${R2_PUBLIC_URL}/${key}`;
}

// Helper: Delete file from R2
async function deleteFromR2(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });
    await r2Client.send(command);
    console.log(`Deleted from R2: ${key}`);
  } catch (e) {
    console.error(`Failed to delete from R2: ${key}`, e.message);
  }
}

// Helper: Download file from R2
async function downloadFromR2(key, localPath) {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });
    const response = await r2Client.send(command);
    const buffer = Buffer.from(await response.Body.transformToByteArray());
    fs.writeFileSync(localPath, buffer);
    console.log(`Downloaded from R2: ${key} -> ${localPath}`);
    return true;
  } catch (e) {
    console.error(`Failed to download from R2: ${key}`, e.message);
    return false;
  }
}

// Helper: Upload data file to R2 (overwrites helper for data files)
async function uploadDataFileToR2(key, filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'application/json',
    });
    await r2Client.send(command);
  } catch (e) {
    console.error(`Failed to upload data to R2: ${key}`, e.message);
  }
}

// Sync data from R2 to local on startup
async function syncDataFromR2() {
  const dataFiles = [
    { r2Key: 'data/users.json', localPath: USERS_FILE },
    { r2Key: 'data/materials.json', localPath: MATERIALS_FILE },
    { r2Key: 'data/requests.json', localPath: REQUESTS_FILE },
    { r2Key: 'data/notifications.json', localPath: NOTIFICATIONS_FILE },
    { r2Key: 'data/bindings.json', localPath: BINDINGS_FILE },
  ];

  console.log('Syncing data from R2...');
  for (const { r2Key, localPath } of dataFiles) {
    const success = await downloadFromR2(r2Key, localPath);
    if (!success) {
      console.log(`No data in R2 for ${r2Key}, will create locally`);
    }
  }
}

// Sync all data files back to R2
async function syncDataToR2() {
  const dataFiles = [
    { r2Key: 'data/users.json', localPath: USERS_FILE },
    { r2Key: 'data/materials.json', localPath: MATERIALS_FILE },
    { r2Key: 'data/requests.json', localPath: REQUESTS_FILE },
    { r2Key: 'data/notifications.json', localPath: NOTIFICATIONS_FILE },
    { r2Key: 'data/bindings.json', localPath: BINDINGS_FILE },
  ];

  console.log('Syncing data to R2...');
  for (const { r2Key, localPath } of dataFiles) {
    if (fs.existsSync(localPath)) {
      await uploadDataFileToR2(r2Key, localPath);
    }
  }
}

// Auto-sync interval (every 60 seconds) - only pull from R2 to avoid overwrites
let autoSyncInterval = null;
function startAutoSync() {
  autoSyncInterval = setInterval(async () => {
    // Only pull from R2 to get any external updates
    await syncDataFromR2();
  }, 60000);
  console.log('Auto-sync from R2 started (every 60s, pull only)');
}

// Manual sync to R2 (called on shutdown)
async function manualSyncToR2() {
  await syncDataToR2();
}

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`${signal} received. Saving data to R2...`);
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  manualSyncToR2().then(() => {
    console.log('Data saved to R2. Shutting down.');
    process.exit(0);
  }).catch(err => {
    console.error('Error saving to R2:', err);
    process.exit(1);
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Render uses SIGUSR2 for graceful restarts

// Data directory
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// File paths
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MATERIALS_FILE = path.join(DATA_DIR, 'materials.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const BINDINGS_FILE = path.join(DATA_DIR, 'bindings.json');

// Helper: read JSON file
function readJSON(file, defaultVal = []) {
  try {
    if (!fs.existsSync(file)) return defaultVal;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return defaultVal;
  }
}

// Helper: write JSON file
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// Initialize default admin user if not exists
function initUsers() {
  let users = readJSON(USERS_FILE, []);
  if (users.length === 0) {
    users = [
      { username: 'admin', password: 'admin123', role: 'admin', createdAt: new Date().toISOString() }
    ];
    writeJSON(USERS_FILE, users);
  }
  return users;
}

// Initialize materials
function initMaterials() {
  if (!fs.existsSync(MATERIALS_FILE)) {
    writeJSON(MATERIALS_FILE, []);
  }
  return readJSON(MATERIALS_FILE, []);
}

// Initialize other data files
function initDataFiles() {
  if (!fs.existsSync(REQUESTS_FILE)) writeJSON(REQUESTS_FILE, []);
  if (!fs.existsSync(NOTIFICATIONS_FILE)) writeJSON(NOTIFICATIONS_FILE, []);
  if (!fs.existsSync(BINDINGS_FILE)) writeJSON(BINDINGS_FILE, []);
}

// Multer config for file uploads - use memory storage for R2 upload
const storage = multer.memoryStorage();

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// No longer serving uploads from disk - all files served from R2
app.use(express.static(path.join(__dirname)));

// ==================== API ROUTES ====================

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.json({ ok: false, error: '用户名或密码错误' });
  }
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

// Change password
app.post('/api/changePwd', (req, res) => {
  const { username, oldPwd, newPwd } = req.body;
  let users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user) return res.json({ ok: false, error: '用户不存在' });
  if (user.password !== oldPwd) return res.json({ ok: false, error: '当前密码错误' });
  user.password = newPwd;
  writeJSON(USERS_FILE, users);
  res.json({ ok: true });
});

// List users (admin only)
app.get('/api/users', (req, res) => {
  const { username } = req.query;
  const users = readJSON(USERS_FILE, []);
  const admin = users.find(u => u.username === username);
  if (!admin || admin.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可查看用户列表' });
  }
  const userList = users.map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt }));
  res.json({ ok: true, users: userList });
});

// Create user (admin only)
app.post('/api/users', (req, res) => {
  const { adminUsername, username, role } = req.body;
  if (!adminUsername || !username) return res.json({ ok: false, error: '缺少参数' });
  
  const users = readJSON(USERS_FILE, []);
  const admin = users.find(u => u.username === adminUsername);
  if (!admin || admin.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可创建用户' });
  }
  if (users.find(u => u.username === username)) {
    return res.json({ ok: false, error: '用户名已存在' });
  }
  
  users.push({
    username,
    password: '123456',
    role: role || 'user',
    createdAt: new Date().toISOString()
  });
  writeJSON(USERS_FILE, users);
  res.json({ ok: true });
});

// Delete user (admin only)
app.delete('/api/users/:username', (req, res) => {
  const { adminUsername } = req.body;
  const targetUsername = req.params.username;
  
  const users = readJSON(USERS_FILE, []);
  const admin = users.find(u => u.username === adminUsername);
  if (!admin || admin.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可删除用户' });
  }
  if (targetUsername === 'admin') {
    return res.json({ ok: false, error: '不能删除管理员' });
  }
  
  const idx = users.findIndex(u => u.username === targetUsername);
  if (idx === -1) return res.json({ ok: false, error: '用户不存在' });
  
  users.splice(idx, 1);
  writeJSON(USERS_FILE, users);
  res.json({ ok: true });
});

// List materials
app.get('/api/materials', (req, res) => {
  let materials = readJSON(MATERIALS_FILE, []);
  // Normalize uploadedFiles URLs (ensure both url and path are set for frontend compatibility)
  materials = materials.map(m => {
    if (m.uploadedFiles) {
      m.uploadedFiles = m.uploadedFiles.map(f => {
        const fileUrl = f.url || f.path || '';
        return {
          ...f,
          url: fileUrl,
          path: fileUrl,
        };
      });
    }
    return m;
  });
  res.json({ ok: true, materials });
});

// Add material (with file uploads to R2)
app.post('/api/materials', upload.array('files', 20), async (req, res) => {
  const { username, name, cat, badges, gradient } = req.body;
  
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可添加素材' });
  }
  
  const materials = readJSON(MATERIALS_FILE, []);
  
  const newMaterial = {
    name: name || '未命名素材',
    cat: cat || '表情包',
    badges: badges ? badges.split(',') : ['版权', 'new'],
    gradient: gradient || Math.floor(Math.random() * 25),
    downloads: 0,
    createdAt: new Date().toISOString(),
    uploadedFiles: []
  };
  
  // Process uploaded files and upload to R2
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const key = `${R2_MATERIAL_PREFIX}materials/${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      
      try {
        const r2Url = await uploadToR2(key, file.buffer, file.mimetype);
        newMaterial.uploadedFiles.push({
          name: file.originalname,
          size: file.size,
          ext,
          r2Key: key,
          url: r2Url,
          type: /\.(png|gif|jpg|jpeg|webp)$/i.test(ext) ? 'image' : 'file'
        });
      } catch (e) {
        console.error('Failed to upload to R2:', e.message);
      }
    }
  }
  
  // Extract file extensions for backwards compatibility
  newMaterial.files = [...new Set(newMaterial.uploadedFiles.map(f => f.ext.replace('.', '')))];
  
  materials.push(newMaterial);
  writeJSON(MATERIALS_FILE, materials);
  res.json({ ok: true, materials });
});

// Update material
app.put('/api/materials/:idx', (req, res) => {
  const { username, name, cat, badges, gradient } = req.body;
  const idx = parseInt(req.params.idx);
  
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可编辑素材' });
  }
  
  const materials = readJSON(MATERIALS_FILE, []);
  if (idx < 0 || idx >= materials.length) {
    return res.json({ ok: false, error: '素材不存在' });
  }
  
  if (name !== undefined) materials[idx].name = name;
  if (cat !== undefined) materials[idx].cat = cat;
  if (badges !== undefined) materials[idx].badges = typeof badges === 'string' ? badges.split(',') : badges;
  if (gradient !== undefined) materials[idx].gradient = gradient;
  
  writeJSON(MATERIALS_FILE, materials);
  res.json({ ok: true, materials });
});

// Delete material
app.delete('/api/materials/:idx', async (req, res) => {
  const { username } = req.body;
  const idx = parseInt(req.params.idx);
  
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可删除素材' });
  }
  
  let materials = readJSON(MATERIALS_FILE, []);
  if (idx < 0 || idx >= materials.length) {
    return res.json({ ok: false, error: '素材不存在' });
  }
  
  // Delete uploaded files from R2
  const material = materials[idx];
  if (material.uploadedFiles) {
    for (const f of material.uploadedFiles) {
      if (f.r2Key) {
        await deleteFromR2(f.r2Key);
      } else if (f.path) {
        // Backward compatibility: delete old local files
        const filePath = path.join(__dirname, f.path.replace(/^\//, ''));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
  }
  
  materials.splice(idx, 1);
  writeJSON(MATERIALS_FILE, materials);
  res.json({ ok: true, materials });
});

// Upload files to existing material
app.post('/api/materials/:idx/upload', upload.array('files', 20), async (req, res) => {
  const { username } = req.body;
  const idx = parseInt(req.params.idx);
  
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可上传文件' });
  }
  
  const materials = readJSON(MATERIALS_FILE, []);
  if (idx < 0 || idx >= materials.length) {
    return res.json({ ok: false, error: '素材不存在' });
  }
  
  if (!materials[idx].uploadedFiles) materials[idx].uploadedFiles = [];
  
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const key = `${R2_MATERIAL_PREFIX}materials/${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      
      try {
        const r2Url = await uploadToR2(key, file.buffer, file.mimetype);
        materials[idx].uploadedFiles.push({
          name: file.originalname,
          size: file.size,
          ext,
          r2Key: key,
          url: r2Url,
          type: /\.(png|gif|jpg|jpeg|webp)$/i.test(ext) ? 'image' : 'file'
        });
      } catch (e) {
        console.error('Failed to upload to R2:', e.message);
      }
    }
  }
  
  materials[idx].files = [...new Set(materials[idx].uploadedFiles.map(f => f.ext.replace('.', '')))];
  
  writeJSON(MATERIALS_FILE, materials);
  res.json({ ok: true, material: materials[idx], materials });
});

// Reorder materials
app.post('/api/materials/reorder', (req, res) => {
  const { username, order } = req.body;
  
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可排序' });
  }
  
  const materials = readJSON(MATERIALS_FILE, []);
  // Reorder based on the order array
  const reordered = order.map(i => materials[i]).filter(Boolean);
  writeJSON(MATERIALS_FILE, reordered);
  res.json({ ok: true, materials: reordered });
});

// Download
app.post('/api/download', (req, res) => {
  const { username, materialIndex } = req.body;
  const idx = parseInt(materialIndex);
  
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.json({ ok: false, error: '请先登录' });
  }
  
  const materials = readJSON(MATERIALS_FILE, []);
  if (idx < 0 || idx >= materials.length) {
    return res.json({ ok: false, error: '素材不存在' });
  }
  
  const material = materials[idx];
  
  // Check download permissions
  let canDownload = false;
  if (user.role === 'admin' || user.role === 'vip') canDownload = true;
  else if (user.role === 'promo' && material.cat === '限时优惠') canDownload = true;
  else if (user.role === 'user' && material.cat === '表情包') canDownload = true;
  
  if (!canDownload) {
    return res.json({ ok: false, error: '权限不足，无法下载此素材' });
  }
  
  // Increment download count
  material.downloads = (material.downloads || 0) + 1;
  writeJSON(MATERIALS_FILE, materials);
  
  // Return material with R2 URLs (normalize both url and path for frontend compatibility)
  const result = JSON.parse(JSON.stringify(material));
  if (result.uploadedFiles) {
    result.uploadedFiles = result.uploadedFiles.map(f => {
      const fileUrl = f.url || (f.r2Key ? `${R2_PUBLIC_URL}/${f.r2Key}` : f.path);
      return {
        ...f,
        url: fileUrl,
        path: fileUrl,
      };
    });
  }
  
  res.json({ ok: true, material: result });
});

// Requests
app.get('/api/requests', (req, res) => {
  const { username } = req.query;
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可查看需求' });
  }
  const requests = readJSON(REQUESTS_FILE, []);
  res.json({ ok: true, requests });
});

app.post('/api/requests', upload.array('images', 5), async (req, res) => {
  const { username, content, contact } = req.body;
  if (!content) return res.json({ ok: false, error: '请输入需求描述' });
  
  const requests = readJSON(REQUESTS_FILE, []);
  
  const newRequest = {
    user: username || '匿名',
    content,
    contact: contact || '',
    time: new Date().toISOString(),
    images: []
  };
  
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const key = `${R2_MATERIAL_PREFIX}requests/${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      
      try {
        const r2Url = await uploadToR2(key, file.buffer, file.mimetype);
        newRequest.images.push(r2Url);
      } catch (e) {
        console.error('Failed to upload request image to R2:', e.message);
        // Fallback to local path
        newRequest.images.push('/uploads/' + file.originalname);
      }
    }
  }
  
  requests.push(newRequest);
  writeJSON(REQUESTS_FILE, requests);
  
  // Send notification to admin
  const notifications = readJSON(NOTIFICATIONS_FILE, []);
  const admins = readJSON(USERS_FILE, []).filter(u => u.role === 'admin');
  for (const admin of admins) {
    notifications.push({
      to: admin.username,
      from: username || '匿名',
      message: `收到新的素材需求：${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
      time: new Date().toISOString(),
      read: false
    });
  }
  writeJSON(NOTIFICATIONS_FILE, notifications);
  
  res.json({ ok: true });
});

app.delete('/api/requests/:idx', async (req, res) => {
  const { username } = req.body;
  const idx = parseInt(req.params.idx);
  
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可删除需求' });
  }
  
  let requests = readJSON(REQUESTS_FILE, []);
  if (idx < 0 || idx >= requests.length) {
    return res.json({ ok: false, error: '需求不存在' });
  }
  
  // Delete associated images from R2
  const request = requests[idx];
  if (request.images) {
    for (const imgUrl of request.images) {
      // Check if it's an R2 URL
      if (imgUrl.startsWith(R2_PUBLIC_URL)) {
        const key = imgUrl.replace(`${R2_PUBLIC_URL}/`, '');
        await deleteFromR2(key);
      } else {
        // Backward compatibility: delete old local files
        const filePath = path.join(__dirname, imgUrl.replace(/^\//, ''));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
  }
  
  requests.splice(idx, 1);
  writeJSON(REQUESTS_FILE, requests);
  res.json({ ok: true });
});

// Notifications
app.get('/api/notifications', (req, res) => {
  const { username } = req.query;
  const notifications = readJSON(NOTIFICATIONS_FILE, []);
  const userNotifications = notifications.filter(n => n.to === username);
  const unread = userNotifications.filter(n => !n.read).length;
  res.json({ ok: true, notifications: userNotifications, unread });
});

app.post('/api/notifications/read', (req, res) => {
  const { username } = req.body;
  let notifications = readJSON(NOTIFICATIONS_FILE, []);
  notifications = notifications.map(n => {
    if (n.to === username) n.read = true;
    return n;
  });
  writeJSON(NOTIFICATIONS_FILE, notifications);
  res.json({ ok: true });
});

// Bindings
app.post('/api/bindings', (req, res) => {
  const { username, platform, platformAccount } = req.body;
  if (!platform || !platformAccount) {
    return res.json({ ok: false, error: '请选择平台和输入账号' });
  }
  
  const bindings = readJSON(BINDINGS_FILE, []);
  
  // Check if already bound
  if (bindings.find(b => b.username === username && b.platform === platform)) {
    return res.json({ ok: false, error: '已绑定此平台' });
  }
  
  bindings.push({
    username,
    platform,
    platformAccount,
    bindTime: new Date().toISOString()
  });
  writeJSON(BINDINGS_FILE, bindings);
  res.json({ ok: true });
});

app.get('/api/bindings', (req, res) => {
  const { username } = req.query;
  const bindings = readJSON(BINDINGS_FILE, []);
  const userBindings = bindings.filter(b => b.username === username);
  res.json({ ok: true, bindings: userBindings });
});

app.delete('/api/bindings/:platform', (req, res) => {
  const { username } = req.body;
  const platform = decodeURIComponent(req.params.platform);
  
  let bindings = readJSON(BINDINGS_FILE, []);
  bindings = bindings.filter(b => !(b.username === username && b.platform === platform));
  writeJSON(BINDINGS_FILE, bindings);
  res.json({ ok: true });
});

app.get('/api/bindings/all', (req, res) => {
  const { username } = req.query;
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || user.role !== 'admin') {
    return res.json({ ok: false, error: '仅管理员可查看' });
  }
  
  const bindings = readJSON(BINDINGS_FILE, []);
  const allUsers = readJSON(USERS_FILE, []);
  
  const result = allUsers.map(u => ({
    username: u.username,
    role: u.role,
    bindings: bindings.filter(b => b.username === u.username)
  }));
  
  res.json({ ok: true, users: result });
});

// Health check / diagnostic endpoint
app.get('/api/health', (req, res) => {
  try {
    const users = readJSON(USERS_FILE, []);
    const materials = readJSON(MATERIALS_FILE, []);
    const dataDirExists = fs.existsSync(DATA_DIR);
    const uploadsDirExists = fs.existsSync(UPLOADS_DIR);
    const usersFileExists = fs.existsSync(USERS_FILE);
    const materialsFileExists = fs.existsSync(MATERIALS_FILE);
    res.json({
      ok: true,
      dataDir: dataDirExists,
      uploadsDir: uploadsDirExists,
      usersFile: usersFileExists,
      materialsFile: materialsFileExists,
      userCount: users.length,
      materialCount: materials.length,
      users: users.map(u => ({ username: u.username, role: u.role })),
      nodeEnv: process.env.NODE_ENV || 'development',
      port: PORT
    });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// Serve index.html for all other routes (SPA fallback)
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Async startup: sync data from R2 first, then start server
async function startServer() {
  try {
    await syncDataFromR2();
    initUsers();
    initMaterials();
    initDataFiles();

    const server = app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`Data directory: ${DATA_DIR}`);
      console.log(`Users file exists: ${fs.existsSync(USERS_FILE)}`);
      console.log(`Users: ${JSON.stringify(readJSON(USERS_FILE, []).map(u => ({ username: u.username, role: u.role })))}`);
      startAutoSync();
    });

    // Also sync to R2 on uncaught errors
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception, saving data:', err);
      manualSyncToR2().finally(() => process.exit(1));
    });
  } catch (e) {
    console.error('Failed to start server:', e);
    // Try to start anyway with local data
    initUsers();
    initMaterials();
    initDataFiles();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT} (R2 sync failed, using local data)`);
      startAutoSync();
    });
  }
}

startServer();
