#!/usr/bin/env bash

# ==============================================================================
# ARSANT SCREENER - MARKET ANALYSIS WORKSPACE LAUNCHER
# Runs both Go Backend API Server & Vite Frontend concurrently
# ==============================================================================

# Ensure Node 22, Go, and standard binaries are in PATH
export PATH="/Users/yasrilimam/.nvm/versions/node/v22.23.1/bin:/usr/local/go/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Color tokens for Arsant Screener workspace logs
CYAN='\033[1;36m'
AMBER='\033[1;33m'
GREEN='\033[1;32m'
RED='\033[1;31m'
NC='\033[0m' # No Color

# Workspace Root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}======================================================================${NC}"
echo -e "${AMBER}              ARSANT SCREENER • MARKET ANALYSIS WORKSPACE              ${NC}"
echo -e "${CYAN}======================================================================${NC}"

# Cleanup function to kill all child background processes on Ctrl+C (SIGINT / SIGTERM / EXIT)
cleanup() {
    echo -e "\n${RED}[TERMINAL] Shutting down backend and frontend services...${NC}"
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null
    fi
    echo -e "${GREEN}[TERMINAL] All services stopped cleanly. Goodbye!${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# 1. Start Go Backend Server
echo -e "${GREEN}[BACKEND]  Starting Go server (cmd/server)...${NC}"
cd "$ROOT_DIR/server" || exit 1
go run ./cmd/server &
BACKEND_PID=$!
echo -e "${GREEN}[BACKEND]  Go server launched (PID: $BACKEND_PID)${NC}"

# Give backend a moment to boot
sleep 1

# 2. Start Vite Frontend Development Server
echo -e "${AMBER}[FRONTEND] Starting Vite terminal web app (npm run dev)...${NC}"
cd "$ROOT_DIR/web" || exit 1
npm run dev &
FRONTEND_PID=$!
echo -e "${AMBER}[FRONTEND] Vite frontend launched (PID: $FRONTEND_PID)${NC}"

echo -e "${CYAN}----------------------------------------------------------------------${NC}"
echo -e "${CYAN}   Arsant Screener Ready! Open your browser (usually http://localhost:5173)${NC}"
echo -e "${CYAN}   Press Ctrl+C to stop both backend and frontend.${NC}"
echo -e "${CYAN}----------------------------------------------------------------------${NC}"

# Keep script running and wait for background processes
wait
