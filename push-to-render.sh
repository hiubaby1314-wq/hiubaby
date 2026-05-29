#!/bin/bash
# 一鍵推送到 GitHub，觸發 Render 自動部署

REPO_DIR="/workspace/hiubaby"
MESSAGE="${1:-更新網站 $(date +%Y-%m-%d\ %H:%M)}"

cd "$REPO_DIR" || exit 1

# 檢查是否有變更
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo "❌ 沒有發現變更"
    exit 0
fi

# 顯示變更
echo "📝 變更檔案："
git status --short

# 設定遠端（用 token，從環境變數讀取）
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ 請先設定環境變數: export GITHUB_TOKEN=ghp_xxxx"
    exit 1
fi
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/hiubaby1314-wq/hiubaby.git"

# 配置 git
git config --local user.name "hiubaby1314-wq"
git config --local user.email "hiubaby1314-wq@users.noreply.github.com"

# 拉取最新
echo ""
echo "🔄 拉取最新變更..."
git pull --rebase 2>&1 || {
    echo "⚠️  衝突，嘗試解決..."
    git rebase --abort 2>/dev/null
    git pull --rebase --autostash 2>&1
}

# 提交
echo ""
echo "📦 提交變更..."
git add -A
git commit -m "$MESSAGE"

# 推送
echo ""
echo "🚀 推送到 GitHub..."
git push

# 清理 token
git remote set-url origin "https://github.com/hiubaby1314-wq/hiubaby.git"

echo ""
echo "✅ 推送成功！Render 會在幾分鐘內自動部署"
echo "🌐 https://lizisucaiwang.online"
