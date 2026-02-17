@echo off
cd /d c:\Users\wondewossenb\AddisBackend-1
echo Starting backend... > server_log.txt
npm run dev >> server_log.txt 2>&1
