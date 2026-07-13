# 为 Zinc 贡献

简体中文 | [English](CONTRIBUTING.md)

感谢你帮助改进 Zinc。当前主线是 `app/` 中的 Electron 应用；`archive/` 下的
WinUI 工程仅作为历史参考。

## 开始之前

- 先搜索已有 Issue 和 Pull Request，避免重复。
- 涉及行为或范围变化时，先通过 Issue 取得设计共识。
- Zinc 保持小而专注。平台扩张、账户、同步或插件系统必须先得到维护者同意。
- 遵守[行为准则](CODE_OF_CONDUCT.md)与下方隐私规则。

## 开发环境

使用 Windows、PowerShell 7 和 Node.js 22.12 或更高版本：

```powershell
cd app
npm ci
npm run typecheck
npm run build
npm run dev
```

不要提交 `node_modules/`、`out/`、`dist/`、安装器 payload、本机设置快照、日志或
调试截图。

## 分支与提交

- `main` 是发布分支；请在专用功能或修复分支中工作。
- 一个 Pull Request 尽量只包含一个逻辑变更。
- 提交主题使用 `feat:`、`fix:`、`docs:`、`chore:` 等 Conventional Commits。
- 不要重写已发布历史，也不要修改已发布 tag。
- 应用版本号变更必须来自明确的发布决定。

## Pull Request

说明问题、最终行为和完成的验证。可行时补充或更新测试。UI 改动只有在确实有助
于审查时才附截图，并确保截图已经脱敏。

最低检查：

```powershell
cd app
npm run typecheck
npm run build
node ../scripts/verify-public-tree.mjs
```

涉及打包、更新器或安装器时，还需执行 [`docs/RELEASE.md`](docs/RELEASE.md) 与
[`docs/INSTALLER.md`](docs/INSTALLER.md) 中的检查。

## 隐私与秘密信息

提交前检查完整 diff。禁止加入密码、令牌、Cookie、私钥、签名证书、个人邮箱、
电话号码、用户目录、设备名、主机名、真实 IP、私有仓库地址，以及真实终端历史、
会话状态、Windows Terminal 快照、崩溃转储或含私人内容的截图。

示例请使用 `C:\Users\Example`、`example.invalid` 与文档专用 IP 网段。提交前从
仓库根目录运行 `node scripts/verify-public-tree.mjs`。

## 许可

提交贡献即表示你同意其按本仓库的 [AGPL-3.0-only 许可证](LICENSE)分发。不要
复制许可不兼容或来源不明的代码与资产。新增第三方材料时同步更新
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
