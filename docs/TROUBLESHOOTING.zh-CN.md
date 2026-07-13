# 故障排查

简体中文 | [English](TROUBLESHOOTING.md)

## Zinc 无法启动

确认 Windows 为 x64。PowerShell 7 是推荐项而非必需项——未安装时 Zinc 会回退到
Windows PowerShell 或命令提示符，因此"没装 PowerShell 7"不是启动失败的原因。开发版
请在 `app/` 中依次执行 `npm ci`、`npm run typecheck` 和 `npm run build`。不要公开完整
环境转储，必须先脱敏。

## 终端文字被裁切或错位

重置 UI 缩放与终端字号，最大化/还原窗口一次，再新建标签。记录 Windows 显示
缩放、Zinc 缩放、字体名称/大小和准确的窗口调整步骤。截图必须遮住终端内容与标题
栏路径。

## 无法创建 shell

确认设置中的 shell 可执行文件存在，并能在 Windows 中直接启动。PowerShell 7
通常安装在标准系统位置；其他 shell 的兼容性由用户自行确认。

## 会话恢复异常

在设置中关闭会话恢复，正常退出并重新打开。如果状态损坏仍存在，可删除 Zinc 当前
用户数据目录中的 session-state 文件。该文件包含工作目录，不要公开分享。

## 安装或更新失败

确认文件名和版本与 Release 页面一致，核对 `SHA256SUMS.txt`，关闭全部 Zinc
窗口后重试。更新失败时可下载同一 Release 的完整 setup 做覆盖安装。不要绕过
payload 完整性错误。

## 开发界面检查

仅在 dev renderer URL 有效时，开发版会在 `http://127.0.0.1:9336` 暴露 Electron
CDP。优先使用项目 Playwright/CDP 与静默测试模式；打包版不得开放该端口。

仍需帮助时请按 [`../SUPPORT.zh-CN.md`](../SUPPORT.zh-CN.md) 提交信息。
