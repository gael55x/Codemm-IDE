#!/usr/bin/env bash

# Simple helper script to run the Codem backend together with
# the Java judge Docker image used for compiling and running tests.
#
# Usage:
#   chmod +x run-codem-backend.sh
#   ./run-codem-backend.sh
#
# Requirements:
#   - Docker installed and running
#   - Node.js + npm installed
#   - ANTHROPIC_API_KEY set in Codem-backend/.env (or in your shell env)

set -euo pipefail

BACKEND_DIR="$PWD"

echo "=== Codem backend ==="

# 1) Ensure npm dependencies are installed
if [[ ! -d node_modules ]]; then
  echo "[1/3] Installing npm dependencies..."
  npm install
else
  echo "[1/3] npm dependencies already installed."
fi

# 2) Ensure the codem-java-judge Docker image exists
echo "[2/3] Checking codem-java-judge Docker image..."
if ! docker image inspect codem-java-judge:latest >/dev/null 2>&1; then
  echo "codem-java-judge image not found. Building from Dockerfile.java-judge..."
  docker build -f Dockerfile.java-judge -t codem-java-judge .
else
  echo "codem-java-judge image found."
fi

# 3) Build and start the backend
echo "[3/3] Building backend (TypeScript -> dist)..."
npm run build

echo
echo "Starting Codem backend on port \${PORT:-4000}..."
echo "Press Ctrl+C to stop."
echo

npm start

