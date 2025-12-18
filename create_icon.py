"""
创建默认应用图标
如果没有自定义图标，可以运行此脚本生成一个简单的默认图标
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_default_icon():
    """创建默认的应用图标"""
    
    # 确保 resources 目录存在
    resources_dir = os.path.join(os.path.dirname(__file__), 'resources')
    os.makedirs(resources_dir, exist_ok=True)
    
    # 图标尺寸
    sizes = [16, 32, 48, 64, 128, 256]
    
    # 为 ICO 格式创建多个尺寸的图像
    images = []
    
    for size in sizes:
        # 创建图像
        img = Image.new('RGB', (size, size), color='#1e40af')
        draw = ImageDraw.Draw(img)
        
        # 绘制边框
        border_width = max(1, size // 32)
        draw.rectangle(
            [border_width, border_width, size - border_width, size - border_width],
            outline='#60a5fa',
            width=border_width
        )
        
        # 绘制文字 "FA"
        try:
            # 尝试使用系统字体
            font_size = size // 2
            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except:
                try:
                    font = ImageFont.truetype("Arial.ttf", font_size)
                except:
                    # 如果找不到字体，使用默认字体
                    font = ImageFont.load_default()
        except:
            font = ImageFont.load_default()
        
        # 计算文字位置（居中）
        text = "FA"
        
        # 获取文字边界框
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        x = (size - text_width) // 2
        y = (size - text_height) // 2 - bbox[1]
        
        # 绘制文字
        draw.text((x, y), text, fill='#ffffff', font=font)
        
        images.append(img)
    
    # 保存为 ICO 文件（Windows 图标）
    ico_path = os.path.join(resources_dir, 'icon.ico')
    images[0].save(
        ico_path,
        format='ICO',
        sizes=[(s, s) for s in sizes]
    )
    print(f"✓ 创建图标: {ico_path}")
    
    # 保存最大尺寸为 PNG（用于其他用途）
    png_path = os.path.join(resources_dir, 'icon.png')
    images[-1].save(png_path, format='PNG')
    print(f"✓ 创建 PNG 图标: {png_path}")
    
    return True


def main():
    """主函数"""
    print("创建默认应用图标...\n")
    
    try:
        # 检查是否已安装 Pillow
        try:
            from PIL import Image
        except ImportError:
            print("未找到 Pillow 库，正在安装...")
            import subprocess
            subprocess.run(['pip', 'install', 'Pillow'], check=True)
            print("✓ Pillow 安装完成\n")
        
        # 创建图标
        if create_default_icon():
            print("\n✅ 图标创建成功！")
            print("\n提示：这是一个简单的默认图标（蓝色背景，白色 'FA' 文字）")
            print("您可以使用专业的图标设计工具创建更精美的图标，")
            print("然后替换 resources/icon.ico 和 resources/icon.png 文件。")
            print("\n推荐的图标设计工具：")
            print("  - Adobe Illustrator")
            print("  - Figma")
            print("  - Inkscape (免费)")
            print("  - GIMP (免费)")
        
        return 0
        
    except Exception as e:
        print(f"\n❌ 创建图标失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    import sys
    sys.exit(main())


