import os
from setuptools import setup, find_packages

# 获取当前 setup.py 文件的目录
here = os.path.abspath(os.path.dirname(__file__))

# 使用绝对路径读取文件
with open(os.path.join(here, "README.md"), "r", encoding="utf-8") as fh:
    long_description = fh.read()

requirements = []
req_path = os.path.join(here, "requirements.txt")
if os.path.exists(req_path):
    with open(req_path, "r", encoding="utf-8") as fh:
        requirements = [line.strip() for line in fh if line.strip() and not line.startswith("#")]

version_path = os.path.join(here, "VERSION")
if os.path.exists(version_path):
    with open(version_path, "r", encoding="utf-8") as fh:
        version = fh.read().strip()
else:
    version = "0.1.0" # Fallback

setup(
    name="fin-agent",
    version=version,
    author="Fin Agent Team",
    description="A financial analysis agent powered by DeepSeek and Tushare",
    long_description=long_description,
    long_description_content_type="text/markdown",
    packages=find_packages(),
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.8",
    install_requires=requirements,
    entry_points={
        "console_scripts": [
            "fin-agent=fin_agent.main:main",
        ],
    },
)
