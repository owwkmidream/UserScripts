import os
import urllib.parse

# CDN 配置列表
CDN_CONFIGS = [
    {
        "name": "GitHub Raw",
        "base_url": "https://github.com/owwkmidream/UserScripts/raw/master/",
        "emoji": "🔗",
        "anchor": "github-raw",
        "description": "GitHub 官方原始链接，稳定可靠，但国内访问可能较慢"
    },
    {
        "name": "jsDelivr",
        "base_url": "https://cdn.jsdelivr.net/gh/owwkmidream/UserScripts@master/",
        "emoji": "🚀",
        "anchor": "jsdelivr",
        "description": "全球 CDN 加速，速度快，但更新可能有延迟（最多 24 小时）"
    },
    {
        "name": "Statically",
        "base_url": "https://cdn.statically.io/gh/owwkmidream/UserScripts/master/",
        "emoji": "⚡",
        "anchor": "statically",
        "description": "静态资源 CDN，全球节点，更新较快"
    },
    {
        "name": "GitMirror",
        "base_url": "https://raw.gitmirror.com/owwkmidream/UserScripts/master/",
        "emoji": "🇨🇳",
        "anchor": "gitmirror",
        "description": "国内镜像，大陆访问稳定快速，更新及时"
    },
    {
        "name": "ghfast",
        "base_url": "https://ghfast.top/https://raw.githubusercontent.com/owwkmidream/UserScripts/master/",
        "emoji": "🌐",
        "anchor": "ghfast",
        "description": "国内代理，实时同步 GitHub，大陆访问友好"
    },
    {
        "name": "FastGit",
        "base_url": "https://raw.fastgit.org/owwkmidream/UserScripts/master/",
        "emoji": "💨",
        "anchor": "fastgit",
        "description": "国内镜像服务，访问速度快"
    },
    {
        "name": "Raw.Githack",
        "base_url": "https://raw.githack.com/owwkmidream/UserScripts/master/",
        "emoji": "🔥",
        "anchor": "raw-githack",
        "description": "实时更新的 CDN，内容同步最快，适合需要最新版本的用户"
    }
]

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
                "## 📥 CDN 下载导航",
                "",
                "根据您的网络环境选择合适的 CDN 源：",
                ""
            ]
            
            # 生成导航锚点列表
            for cdn in CDN_CONFIGS:
                lines.append(f"- [{cdn['emoji']} **{cdn['name']}**](#{cdn['anchor']}) - {cdn['description']}")
            
            lines.append("")
            lines.append("---")
            lines.append("")
            
            # 为每个 CDN 生成独立的表格
            for cdn in CDN_CONFIGS:
                lines.append(f"## {cdn['emoji']} {cdn['name']}")
                lines.append(f"<a id=\"{cdn['anchor']}\"></a>")
                lines.append("")
                lines.append(f"> {cdn['description']}")
                lines.append("")
                lines.append("| 脚本名称 | 下载链接 |")
                lines.append("| :--- | :--- |")
                
                for js_file in sorted(js_files):
                    # 计算相对于项目根目录的路径
                    rel_path = os.path.relpath(os.path.join(root, js_file), ".")
                    # 将路径分隔符统一为 /
                    rel_path = rel_path.replace(os.sep, '/')
                    # URL 编码
                    encoded_path = urllib.parse.quote(rel_path)
                    cdn_url = cdn["base_url"] + encoded_path
                    
                    lines.append(f"| {js_file} | [📥 安装]({cdn_url}) |")
                
                lines.append("")
                lines.append("[⬆️ 返回导航](#-cdn-下载导航)")
                lines.append("")
                lines.append("---")
                lines.append("")
            
            content = "\n".join(lines)
            
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
