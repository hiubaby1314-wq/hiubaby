#!/bin/bash
cd /workspace/hiubaby/lizi-materials
export NODE_ENV=production
export PORT=3000
export R2_ACCOUNT_ID=ae5c20bd97e1d547c9913ad516ece101
export R2_ACCESS_KEY_ID=4f20817a0f6329cacf4a5c4eda00fee7
export R2_BUCKET=lizi-sucai
export R2_PUBLIC_URL=https://pub-2d81719a7aaf43a19e0ac4120399b44f.r2.dev
export R2_SECRET_ACCESS_KEY=ed9df48853677e8e7533a9c1fec821598b45e3ca9afb5a0aabfa46c9da451952
exec node server.js
