@echo off
chcp 65001 >nul
title 我们的旅行记忆
cd /d "%~dp0"
echo 正在启动旅行记忆网站...
start "" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"
echo 网站已打开！此窗口可以关闭（服务器在后台运行）。
echo 如需停止服务器：任务管理器结束 node.exe，或重启电脑。
timeout /t 3 >nul
