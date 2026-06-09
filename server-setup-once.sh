#!/bin/bash
# 栗子素材網 AI 後台管理系統 - 伺服器一次性設定腳本
# 請在伺服器 (43.161.253.21) 上以具有 sudo 權限的使用者執行此腳本一次

echo "=== 開始設定 AI 後台管理系統 ==="

# 1. 確保目標目錄存在
echo "1. 建立必要目錄..."
mkdir -p /opt/hiubaby/lizi-materials/ai-admin-backend
mkdir -p /opt/hiubaby/lizi-materials/public/ai

# 2. 安裝 PM2 (如果尚未安裝)
echo "2. 檢查 PM2..."
if ! command -v pm2 &> /dev/null; then
    echo "安裝 PM2..."
    sudo npm install -g pm2
fi

# 3. 建立後端環境變數檔案
echo "3. 建立後端 .env.production 檔案..."
cat > /opt/hiubaby/lizi-materials/ai-admin-backend/.env.production << 'ENVEOF'
API_BACKEND_HOST="127.0.0.1"
API_BACKEND_PORT=5000
API_PAYLOAD_MAX_SIZE="7mb"
GOOGLE_CLOUD_LOCATION="global"
GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
PROXY_HEADER="EIgtggIkuTngzFrZDltR_bU1OVfn4yg-"
ENVEOF

echo "⚠️  請務必編輯 /opt/hiubaby/lizi-materials/ai-admin-backend/.env.production"
echo "   並將 GOOGLE_CLOUD_PROJECT 替換為您實際的 Google Cloud Project ID。"
read -p "按 Enter 繼續..."

# 4. 安裝後端依賴
echo "4. 安裝後端依賴..."
cd /opt/hiubaby/lizi-materials/ai-admin-backend
npm install --production

# 5. 啟動 PM2 服務
echo "5. 啟動 AI 後端服務..."
pm2 start server.js --name lizi-ai-backend --env production
pm2 save

# 6. Nginx 設定提示
echo ""
echo "=== 設定完成 ==="
echo "6. 請確認您的 Nginx 設定已包含以下代理規則，以便將 /ai/api-proxy 和 /ai/ws-proxy 導向後端："
echo ""
echo "location /ai/api-proxy {"
echo "    proxy_pass http://127.0.0.1:5000/api-proxy;"
echo "    proxy_http_version 1.1;"
echo "    proxy_set_header Upgrade \$http_upgrade;"
echo "    proxy_set_header Connection 'upgrade';"
echo "    proxy_set_header Host \$host;"
echo "    proxy_cache_bypass \$http_upgrade;"
echo "}"
echo ""
echo "location /ai/ws-proxy {"
echo "    proxy_pass http://127.0.0.1:5000/ws-proxy;"
echo "    proxy_http_version 1.1;"
echo "    proxy_set_header Upgrade \$http_upgrade;"
echo "    proxy_set_header Connection \"Upgrade\";"
echo "    proxy_set_header Host \$host;"
echo "}"
echo ""
echo "修改 Nginx 設定後，請執行: sudo nginx -t && sudo systemctl reload nginx"
