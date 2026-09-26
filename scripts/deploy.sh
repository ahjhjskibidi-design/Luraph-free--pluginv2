#!/usr/bin/env bash
# Lua Obf — deploy helper.
# Prepares the project for deployment to Railway, Render, Fly, or any host
# that reads package.json.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "[deploy] Lua Obf"
echo "[deploy] verifying Node"
node --version

echo "[deploy] installing production dependencies"
npm ci --omit=dev

echo "[deploy] checking start script"
if ! grep -q '"start"' package.json; then
  echo "[deploy] error: package.json has no start script" >&2
  exit 1
fi

echo "[deploy] verifying files"
for f in README.md LICENSE package.json src/server.js src/api.js engine/index.js public/index.html; do
  if [ ! -f "$f" ]; then
    echo "[deploy] error: missing $f" >&2
    exit 1
  fi
done

echo "[deploy] done"
echo ""
echo "Next steps:"
echo "  1. Railway:  railway up"
echo "  2. Render:   connect repo, set start command to 'npm start'"
echo "  3. Fly.io:   fly launch && fly deploy"
echo "  4. Codespaces: port 3000 is already forwarded"
echo ""
echo "Environment:"
echo "  PORT   default 3000"
echo "  NODE_ENV   set to 'production' on the host"