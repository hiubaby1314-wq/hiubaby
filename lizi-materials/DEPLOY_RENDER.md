# 部署到 Render 指南

## 步骤一：推送代码到 GitHub

确保代码已推送到 GitHub 仓库：

```bash
cd lizi-materials
git init
git add -A
git commit -m "Rebuild 栗子素材网"
git branch -m main
git remote add origin https://github.com/hiubaby1314-wq/hiubaby.git
git push -u origin main
```

## 步骤二：在 Render 创建服务

1. 登录 [render.com](https://render.com)
2. 点击 **New +** → **Web Service**
3. 连接你的 GitHub 仓库 `hiubaby1314-wq/hiubaby`
4. 填写以下配置：

| 设置项 | 值 |
|--------|-----|
| Name | `lizi-materials` |
| Region | Oregon |
| Branch | `main` |
| Root Directory | `lizi-materials` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | Free |

5. 添加环境变量：

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

6. 点击 **Create Web Service**

## 步骤三：配置持久存储（重要）

Render 免费版的文件系统是临时的，每次部署数据会丢失。有两种方案：

### 方案 A：使用 Render 持久磁盘（付费）
1. 进入服务页面 → **Persistent Disk**
2. 创建一个磁盘挂载到 `/data`
3. 数据库文件会自动保存在磁盘上

### 方案 B：接受数据临时性
免费版无需额外配置，但每次部署后数据库会重置。管理员账号会自动重新创建。

## 部署完成

部署成功后，Render 会给你一个 URL，例如：
```
https://lizi-materials-xxxx.onrender.com
```

### 默认管理员账号

- 用户名：`admin`
- 密码：`admin123`

首次登录后请修改密码。
