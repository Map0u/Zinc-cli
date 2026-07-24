# Zinc

简体中文 | [English](README.md)

Zinc 是一个轻量多 shell 的 Windows 终端启动器，基于 Electron、React、xterm.js
与 `node-pty` 构建。它优先支持 PowerShell 7，保持现代紧凑界面（垂直标签栏、
Acrylic 风格窗口、实用设置），后台占用克制，便于打开本机已安装的各类 shell。

当前应用位于 [`app/`](app/)。归档目录只保留相互隔离的历史可行性实验，
不包含第二套产品实现。

## 主要功能

- 垂直终端标签，支持新建、重命名、复制与关闭。
- 自动探测本机 shell——PowerShell 7、Windows PowerShell、命令提示符、Git Bash
  与已安装的 WSL 发行版——经 `node-pty`、ConPTY 与 xterm.js 运行，支持按标签
  选择 shell 与可配置的默认 shell。
- Acrylic 风格无边框 Windows 界面，支持明暗主题和系统强调色。
- 字体、配色、不透明度、快捷键、缩放、回滚行数与会话恢复设置。
- 剪贴板图片粘贴、可点击网页链接；新建或复制标签会尝试继承当前工作目录，
  后续在 shell 中切换目录可能无法反映。
- 按用户安装的 Windows NSIS 安装包，以及可选的 GitHub Releases 更新流程。
- 英文与简体中文界面资源。

Zinc 有意不提供云同步、账户体系、插件平台、分屏，以及内置 SSH
配置管理。

## 系统要求

- Zinc 0.6.0 仅支持 Windows：Windows 10 或 Windows 11，x64。其他平台没有计划。
- 推荐安装 [PowerShell 7](https://github.com/PowerShell/PowerShell) 作为默认
  shell；未安装时 Zinc 会自动回退到 Windows PowerShell 或命令提示符。
- Git Bash 与 WSL 是可选 shell：仅在你已自行安装时才会被发现并出现在选择列表中。
- 默认按用户安装，日常运行 Zinc 不需要管理员权限；无需另装 Node.js。

## 安装

从本仓库的 GitHub Releases 页面下载 `Zinc-<version>-Setup.exe`（NSIS 安装包）。
这是 Zinc 唯一提供的 Windows 安装方式。

Zinc 当前未做 Windows 代码签名，Microsoft Defender SmartScreen 会拦截首次运行。
请先下载同一 Release 的 `SHA256SUMS.txt`，在下载目录执行
`Get-FileHash .\Zinc-<version>-Setup.exe -Algorithm SHA256`，与清单中同名文件那一行的
校验值逐字比对；一致才运行，不一致请删除文件。

## 开发

安装 Node.js 22.12 或更高版本，然后在 PowerShell 中运行：

```powershell
cd app
npm ci
npm run typecheck
npm run build
npm run dev
```

Windows 打包同样从 `app/` 执行：

```powershell
npm run dist
```

进行较大改动前，请阅读[贡献指南](CONTRIBUTING.zh-CN.md)、
[架构说明](docs/ARCHITECTURE.md)与[故障排查](docs/TROUBLESHOOTING.zh-CN.md)。

## 隐私与安全

Zinc 不内置分析统计或广告遥测。设置、会话恢复元数据和粘贴的剪贴板图片保存在
本机。终端命令及其子进程仍可自行访问网络，检查更新时会连接 GitHub Releases。
完整边界见[隐私说明](PRIVACY.zh-CN.md)，漏洞报告方式见
[安全策略](SECURITY.zh-CN.md)。

请勿在公开 Issue 中附上未脱敏的终端截图、日志、配置文件或会话状态；其中可能
包含用户名、路径、命令、令牌、主机名和工作目录。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [安装器行为](docs/INSTALLER.md)
- [发布流程](docs/RELEASE.md)
- [故障排查](docs/TROUBLESHOOTING.zh-CN.md)
- [支持说明](SUPPORT.zh-CN.md)
- [第三方许可说明](THIRD_PARTY_NOTICES.md)
- [更新日志](CHANGELOG.md)

## 许可证

Zinc 仅按 [GNU Affero General Public License v3.0](LICENSE) 分发。第三方组件
继续适用各自许可证，详见[第三方许可说明](THIRD_PARTY_NOTICES.md)。
