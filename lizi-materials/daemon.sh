#!/bin/bash
# Start the lizi-materials server
cd /workspace/hiubaby/lizi-materials
export NODE_ENV=production
export PORT=3000
export R2_ACCOUNT_ID=ae5c20bd97e1d547c9913ad516ece101
export R2_ACCESS_KEY_ID=4f20817a0f6329cacf4a5c4eda00fee7
export R2_BUCKET=lizi-sucai
export R2_PUBLIC_URL=https://pub-2d81719a7aaf43a19e0ac4120399b44f.r2.dev
export R2_SECRET_ACCESS_KEY=ed9df48853677e8e7533a9c1fec821598b45e3ca9afb5a0aabfa46c9da451952

# Start server as a true daemon using setsid if available, otherwise nohup
if command -v setsid &>/dev/null; then
    setsid node server.js </dev/null >/tmp/lizi.log 2>&1
else
    nohup node server.js </dev/null >/tmp/lizi.log 2>&1 &
fi

# Wait for server to start
sleep 2

# Test it
if curl -s http://127.0.0.1:3000/api/materials >/dev/null 2>&1; then
    echo "Server started successfully on port 3000"
else
    echo "Server failed to start"
    cat /tmp/lizi.log
fi

# Keep this script running to prevent bash session from ending
# and killing child processes
tail -f /tmp/lizi.log
