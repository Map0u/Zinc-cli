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

开发版仅在 `app/` 下执行 `npm run dev` 且 dev renderer 生效时，于
`http://127.0.0.1:9336` 暴露 Electron CDP。安装版 Zinc **不会**打开该端口。

项目 MCP `playwright-zinc`（`.mcp.json` → `scripts/playwright-zinc-mcp.ps1`）：

1. 若 9336 可达，则附着到 Zinc Electron；
2. 否则启动**隔离 headless Chromium**（不占用 fatality 的 9335），便于截 mock /
   文档页。要操作真实应用 UI，先 `npm run dev` 再重连 MCP。

自动化冒烟（`ZINC_TEST_ISOLATED=1` 和/或 `ZINC_TEST_USER_DATA`）会隔离 shell
历史：PowerShell 会话将 PSReadLine 设为 `SaveNothing` 并写到测试 profile 下的路径，
bash 类 shell 使用私有 `HISTFILE`，避免 CDP 标记写入开发者全局 PSReadLine 历史
（`%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`）。

仍需帮助时请按 [`../SUPPORT.zh-CN.md`](../SUPPORT.zh-CN.md) 提交信息。
