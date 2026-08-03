# Zinc

[**官方网站: zincli.org**](https://zincli.org)

[![English](https://img.shields.io/badge/Language-English-blue.svg?style=flat-square)](./README.md)

> 一款为 Windows 设计的现代化、类原生终端，专注于简洁与设计哲学。

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/Map0u/Zinc?style=flat-square)](https://github.com/Map0u/Zinc/releases/latest)
[![GitHub Downloads (latest)](https://img.shields.io/github/downloads/Map0u/Zinc/latest/total?style=flat-square)](https://github.com/Map0u/Zinc/releases/latest)
[![License: AGPL-3.0-only](https://img.shields.io/github/license/Map0u/Zinc?style=flat-square)](./LICENSE)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/Map0u/Zinc/ci.yml?branch=main&style=flat-square)](https://github.com/Map0u/Zinc/actions)

Zinc 是一款为 Windows 10/11 打造的终端，面向追求干净、高效、与桌面融为一体的命令行工作流的开发者。垂直标签布局 + 克制的功能集：该强的地方强，该静的地方静。

**[从官方网站下载](https://zincli.org)** · **[GitHub Releases](https://github.com/Map0u/Zinc/releases/latest)**

---

## 设计哲学

Zinc 的构建遵循一套明确的原则：

*   **纯粹至上：** 终端应当有力却不嘈杂。Zinc 提供核心能力，主动拒绝臃肿选项。
*   **美学集成：** 无边框 Acrylic 风格界面与垂直标签栏，像现代 Windows 桌面的一部分。
*   **本地优先的隐私：** 零分析遥测。设置、会话元数据与粘贴图片留在本机；可选的更新检查才会连接 GitHub Releases。

## 核心功能

*   **垂直标签栏：** 多会话时名字仍完整可读，不必猜省略号背后是什么。
*   **自动探测 Shell：** PowerShell 7、Windows PowerShell、CMD、Git Bash 与已安装的 WSL 发行版。
*   **现代美学：** 无边框 Acrylic 风格、主题与透明度调节。
*   **深度自定义：** 字体、配色、快捷键、缩放、回滚行数等。
*   **会话恢复：** 重启后恢复标签顺序与工作目录。
*   **智能交互：**
    *   **可点击链接：** 在系统浏览器中打开 URL。
    *   **粘贴图片：** 将剪贴板图片以本机路径粘贴进当前终端。
    *   **会话续写：** 本地辅助，可为你代敲 `claude --continue` 或 `grok --continue`——无 AI 内核，不上传终端内容。
*   **可选更新：** 静默检查 GitHub Releases（可按需使用）。
*   **多语言界面：** 英文与简体中文。

## 我们明确不做

为了保持其作为一款轻量、快速终端的专注，Zinc 刻意避免了以下功能：

*   云同步与用户账户
*   插件市场或扩展 API
*   分屏功能（我们专注于标签页和窗口管理）
*   内置 SSH 配置管理

## 安装

1.  访问 [**官方网站**](https://zincli.org) 或 [**Releases 页面**](https://github.com/Map0u/Zinc/releases/latest)。
2.  下载 `Zinc-0.6.4-Setup.exe` 安装包。
3.  运行安装程序。

> **关于 Windows SmartScreen 的说明：**
> 本应用未进行代码签名，因此 Windows SmartScreen 可能会显示警告。若要继续，请点击「更多信息」，然后点击「仍要运行」。
>
> 为验证安装包的完整性，你可以将其 SHA256 哈希值与发布页面上 `SHA256SUMS` 文件中提供的值进行比较。打开 PowerShell 并运行以下命令：
>
> ```powershell
> Get-FileHash .\Zinc-0.6.4-Setup.exe -Algorithm SHA256
> ```

## 隐私与安全

Zinc 将你的隐私放在首位。

*   **零遥测：** 本应用不收集任何分析或使用数据。
*   **本地数据存储：** 所有设置、会话元数据和粘贴的图片数据都只存储在你的本地计算机上。
*   **网络活动：**
    *   Zinc 本身仅在检查更新时连接到 GitHub Releases API，此为可选功能。
    *   终端子进程（如 PowerShell、WSL、curl）可以像往常一样访问网络。
*   **无 AI，不上传：** 会话续写功能是一个简单的命令输入宏，不涉及任何 AI 模型，也不会上传你的终端内容。

更多详情，请参阅我们的[隐私政策](./PRIVACY.zh-CN.md)和[安全策略](./SECURITY.zh-CN.md)。

## 开发者指南

### 环境要求

*   Node.js ≥22.12
*   Windows 10/11 x64

### 快速开始

核心应用代码位于 `app/` 目录中。`archive/` 目录仅包含历史实验代码，不参与当前构建。

```powershell
# 克隆仓库
git clone https://github.com/Map0u/Zinc.git
cd Zinc/app

# 安装依赖
npm ci

# 运行类型检查
npm run typecheck

# 启动开发服务器
npm run dev

# 构建应用
npm run build

# 打包应用
npm run dist
```

欢迎贡献。较大改动前请阅读[贡献指南](./CONTRIBUTING.zh-CN.md)、[架构说明](./docs/ARCHITECTURE.md)与[故障排查](./docs/TROUBLESHOOTING.zh-CN.md)。

## 许可协议

本项目基于 [AGPL-3.0-only](./LICENSE) 许可协议。

---

[官方网站](https://zincli.org) | [GitHub 仓库](https://github.com/Map0u/Zinc)
