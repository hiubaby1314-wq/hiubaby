#!/bin/bash
# Restore from backup - replaces current files with stable backup versions
echo "=== Restoring from stable backup ==="
cd "$(dirname "$0")"
cp backup/server.js.bak lizi-materials/server.js
cp backup/index.html.bak lizi-materials/public/index.html
cp backup/package.json.bak lizi-materials/package.json
cp backup/render.yaml.bak lizi-materials/render.yaml
echo "Restore complete. Commit and push to deploy."
