#!/bin/bash
# 一鍵恢復到穩定版本

REPO_DIR="/workspace/hiubaby"
TAG="${1:-stable-20260529}"

cd "$REPO_DIR" || exit 1

echo "🔄 正在恢復到穩定版本: $TAG"
echo ""

# 設定遠端（用 token，從環境變數讀取）
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ 請先設定環境變數: export GITHUB_TOKEN=ghp_xxxx"
    exit 1
fi
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/hiubaby1314-wq/hiubaby.git"

# 配置 git
git config --local user.name "hiubaby1314-wq"
git config --local user.email "hiubaby1314-wq@users.noreply.github.com"

# 切換到穩定 tag
echo "📌 切換到 $TAG..."
git checkout $TAG 2>&1 || {
    echo "❌ 無法切換到 $TAG，嘗試拉取 tag..."
    git fetch --tags
    git checkout $TAG 2>&1
}

# 回到 main 分支但使用穩定版本代碼
echo ""
echo "📦 將穩定版本應用到 main 分支..."
git checkout main
git reset --hard $TAG

# 推送（強制）
echo ""
echo "🚀 推送到 GitHub（強制覆蓋）..."
git push --force

# 清理 token
git remote set-url origin "https://github.com/hiubaby1314-wq/hiubaby.git"

echo ""
echo "✅ 已恢復到穩定版本！Render 正在重新部署..."
echo "⏳ 請等待 1-3 分鐘後刷新頁面"
echo "🌐 https://lizisucaiwang.online"
