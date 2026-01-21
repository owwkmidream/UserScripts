import os
import urllib.parse

REPO_BASE_URL = "https://github.com/owwkmidream/UserScripts/raw/master/"

def generate_readmes():
    for root, dirs, files in os.walk("."):
        # 排除隐藏目录（如 .git, .github）
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        
        js_files = [f for f in files if f.endswith('.js')]
        
        if js_files:
            readme_path = os.path.join(root, "README.md")
            # 这里的 root 是 "." 时，basename 会是空，所以处理一下
            folder_name = os.path.basename(os.path.abspath(root))
            
            lines = [
                f"# {folder_name}",
                "",
                "| 脚本名称 | 下载链接 |",
                "| :--- | :--- |"
            ]
            
            for js_file in sorted(js_files):
                # 计算相对于项目根目录的路径
                rel_path = os.path.relpath(os.path.join(root, js_file), ".")
                # 将路径分隔符统一为 /
                rel_path = rel_path.replace(os.sep, '/')
                # URL 编码
                encoded_path = urllib.parse.quote(rel_path)
                raw_url = REPO_BASE_URL + encoded_path
                lines.append(f"| {js_file} | [安装]({raw_url}) |")
            
            content = "\n".join(lines) + "\n"
            
            # 只有当内容发生变化或文件不存在时才写入，减少 git 变动
            should_write = True
            if os.path.exists(readme_path):
                with open(readme_path, "r", encoding="utf-8") as f:
                    if f.read() == content:
                        should_write = False
            
            if should_write:
                with open(readme_path, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"Generated/Updated README in: {root}")

if __name__ == "__main__":
    generate_readmes()
