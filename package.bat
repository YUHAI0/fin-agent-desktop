@echo off
cd /d %~dp0
setlocal

echo.
echo ===============================================
echo    Fin-Agent Desktop 一键打包工具
echo    (源代码打包方案 - 稳定版)
echo ===============================================
echo.

REM 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] 警告: 当前没有管理员权限
    echo.
    echo     Electron-Builder 在解压依赖时需要创建符号链接
    echo     请【右键点击】本脚本，选择【以管理员身份运行】
    echo.
    echo     或者按任意键继续尝试（可能会失败）...
    pause
)

REM 检查 Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [X] 未检测到 Python
    echo     请安装 Python 3.8+ 并添加到 PATH
    echo     下载: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [X] 未检测到 Node.js
    echo     请安装 Node.js 16+ 并添加到 PATH
    echo     下载: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] 环境检查通过
echo.

REM 运行打包脚本
python make.py
if %errorlevel% neq 0 (
    echo.
    echo [X] 打包失败
    echo.
    echo 常见原因:
    echo 1. 网络问题导致 electron-builder 依赖下载失败
    echo 2. 权限不足（请尝试以管理员身份运行）
    echo.
    pause
    exit /b %errorlevel%
)

echo.
echo ===============================================
echo    打包完成！
echo ===============================================
pause