"""
Fin-Agent Desktop 构建工具 (源代码打包方案)
策略：直接打包 Python 源代码，不使用 PyInstaller
"""
import os
import sys
import shutil
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.resolve()
PYTHON_DIR = PROJECT_ROOT / "python"
FIN_AGENT_DIR = PYTHON_DIR / "fin-agent"
RESOURCES_DIR = PROJECT_ROOT / "resources"
DIST_DIR = PROJECT_ROOT / "dist"

def log(msg, level="INFO"):
    icons = {"INFO": "[INFO]", "SUCCESS": "[OK]", "WARN": "[WARN]", "ERROR": "[ERROR]"}
    print(f"{icons.get(level, '[*]')} {msg}")

def run(cmd, cwd=None):
    log(f"执行: {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd)
    if result.returncode != 0:
        log(f"命令失败: {cmd}", "ERROR")
        sys.exit(1)

import json

def prepare_resources():
    """准备图标和其他资源"""
    resources_dir = PROJECT_ROOT / "resources"
    resources_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. 处理图标
    icon_path = resources_dir / "icon.ico"
    if not icon_path.exists():
        log("未找到 icon.ico，尝试使用默认图标...", "WARN")
        # 尝试从 node_modules 找一个替代品
        default_icons = list(PROJECT_ROOT.glob("node_modules/**/proton-native.ico"))
        if default_icons:
            shutil.copy2(default_icons[0], icon_path)
            log(f"已复制默认图标: {default_icons[0]}", "SUCCESS")
        else:
            log("无法找到默认图标，打包可能会失败！", "ERROR")

    # 2. 修正 electron-builder.json
    builder_config_path = PROJECT_ROOT / "electron-builder.json"
    if builder_config_path.exists():
        try:
            with open(builder_config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            
            changed = False
            nsis = config.get("nsis", {})
            
            # 移除不存在的 installerHeader
            if "installerHeader" in nsis:
                header_path = PROJECT_ROOT / nsis["installerHeader"]
                if not header_path.exists():
                    log(f"移除不存在的配置: installerHeader ({nsis['installerHeader']})", "WARN")
                    del nsis["installerHeader"]
                    changed = True

            # 确保 installerHeaderIcon 存在，如果不存在就用 icon.ico
            if "installerHeaderIcon" in nsis:
                header_icon_path = PROJECT_ROOT / nsis["installerHeaderIcon"]
                if not header_icon_path.exists():
                    if icon_path.exists():
                        nsis["installerHeaderIcon"] = "resources/icon.ico"
                        log("重定向 installerHeaderIcon 到 resources/icon.ico", "WARN")
                        changed = True
                    else:
                        del nsis["installerHeaderIcon"]
                        changed = True
            
            if changed:
                config["nsis"] = nsis
                with open(builder_config_path, "w", encoding="utf-8") as f:
                    json.dump(config, f, indent=2)
                log("已自动修复 electron-builder.json 配置", "SUCCESS")
                
        except Exception as e:
            log(f"处理配置文件时出错: {e}", "WARN")

def update_package_version():
    """从 VERSION 文件更新 package.json 的版本号"""
    version_file = PROJECT_ROOT / "VERSION"
    package_json_file = PROJECT_ROOT / "package.json"
    
    if not version_file.exists():
        log("VERSION 文件不存在，跳过版本更新", "WARN")
        return

    if not package_json_file.exists():
        log("package.json 文件不存在，跳过版本更新", "WARN")
        return

    try:
        version = version_file.read_text("utf-8").strip()
        if not version:
            log("VERSION 文件为空", "WARN")
            return
            
        with open(package_json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        current_version = data.get("version")
        if current_version != version:
            log(f"更新版本号: {current_version} -> {version}")
            data["version"] = version
            with open(package_json_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        else:
            log(f"版本号已是最新: {version}")
            
    except Exception as e:
        log(f"更新版本号失败: {e}", "WARN")

def main():
    os.system("cls" if os.name == "nt" else "clear")
    print("="*60)
    print("  Fin-Agent Desktop 源代码打包工具")
    print("="*60)
    
    # 0. 同步版本号
    update_package_version()
    
    # 1. 清理
    log("清理旧文件...")
    for d in [DIST_DIR, PROJECT_ROOT / "out", RESOURCES_DIR / "python"]:
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
            
    # 新增：准备资源（图标等）
    prepare_resources()
    
    # 2. 准备 Python 资源
    log("准备 Python 后端...")
    python_res = RESOURCES_DIR / "python"
    python_res.mkdir(parents=True, exist_ok=True)
    
    # 复制 api.py
    shutil.copy2(PYTHON_DIR / "api.py", python_res / "api.py")
    
    # 复制 fin_agent 包
    shutil.copytree(FIN_AGENT_DIR / "fin_agent", python_res / "fin_agent", dirs_exist_ok=True)
    
    # 复制 requirements.txt
    shutil.copy2(FIN_AGENT_DIR / "requirements.txt", python_res / "requirements.txt")
    
    # 复制 .env（如果存在）
    if (PYTHON_DIR / ".env").exists():
        shutil.copy2(PYTHON_DIR / ".env", python_res / ".env")
    
    # 创建依赖安装脚本
    install_deps_script = python_res / "install_deps.bat"
    install_deps_script.write_text("""@echo off
echo 正在安装依赖...
pip install -r requirements.txt
if errorlevel 1 (
    echo 依赖安装失败
    pause
    exit /b 1
)
echo 依赖安装完成
pause
""", encoding="utf-8")
    
    # 复制 VERSION
    shutil.copy2(PROJECT_ROOT / "VERSION", RESOURCES_DIR / "VERSION")
    
    log("Python 后端准备完成", "SUCCESS")
    
    # 3. 构建前端
    log("安装前端依赖...")
    if not (PROJECT_ROOT / "node_modules").exists():
        run("npm install", cwd=PROJECT_ROOT)
    
    log("编译前端...")
    run("npm run build", cwd=PROJECT_ROOT)
    
    log("打包 Electron...")
    # 设置环境变量以加速 Electron 相关下载（使用淘宝镜像/华为镜像等）
    env = os.environ.copy()
    env["ELECTRON_MIRROR"] = "https://npmmirror.com/mirrors/electron/"
    env["ELECTRON_BUILDER_BINARIES_MIRROR"] = "https://npmmirror.com/mirrors/electron-builder-binaries/"
    
    # 在 Windows 上运行 npm 命令
    cmd = "npm run build:win"
    log(f"执行: {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=PROJECT_ROOT, env=env)
    
    if result.returncode != 0:
        log("Electron 打包失败", "ERROR")
        print("\n" + "="*40)
        print("可能的解决方案：")
        print("1. 权限错误：请尝试【以管理员身份运行】")
        print("2. 网络错误：已尝试设置镜像源，请检查网络连接")
        print("3. 缓存损坏：尝试删除 %LOCALAPPDATA%\\electron-builder\\Cache 目录")
        print("="*40 + "\n")
        sys.exit(1)
    
    # 完成
    log("\n" + "="*60, "SUCCESS")
    log("  打包完成！", "SUCCESS")
    log(f"  输出目录: {DIST_DIR}", "SUCCESS")
    log("="*60 + "\n", "SUCCESS")
    
    if DIST_DIR.exists() and os.name == "nt":
        os.startfile(DIST_DIR)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\n已取消", "WARN")
    except Exception as e:
        log(f"\n错误: {e}", "ERROR")
        import traceback
        traceback.print_exc()
        sys.exit(1)
