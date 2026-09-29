# dsh-desktop — 官方 DeepSeek Harness 桌面的外置增强层

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 自带官方桌面端，位于该仓库的 `apps/desktop`（Electron 壳 + 自己的 Host + 打包脚本）。本仓库不复制也不修改它，只提供官方桌面缺少的那一半：**源码检出的更新与增量重建**。

官方在 GitHub 上的 release 只有变更说明、没有安装包资源，所以本机使用官方桌面就是从源码启动：

```sh
pnpm run dev:desktop    # 构建后启动（会跑完整构建）
pnpm run start:desktop  # 跳过构建，直接启动已有产物
```

## 为什么需要这一层

`start:desktop` 不知道源码是否比产物新，`dev:desktop` 每次都跑完整构建。于是每次 `git pull` 之后只有两个选择：用可能过期的产物启动，或者等一次完整构建。官方桌面的自动更新只服务打包版本，管不到源码检出。

这一层补上：

- **只快进**：先 fetch，确认本地落后且可 fast-forward 才合并；工作区有 tracked 改动或已分叉就跳过更新并照常启动，绝不覆盖本地内容。
- **依赖按需**：只有 `pnpm-lock.yaml` 真的变了才跑 `pnpm install`。
- **增量构建**：按变更文件选最短的构建组合，纯文档更新完全不构建。
- **缺产物兜底**：`apps/desktop/lib` 或 `apps/desktop-host/lib` 缺失时强制完整构建，而不是按「无变更」跳过。

## 使用

| 入口 | 作用 |
| --- | --- |
| 桌面「DeepSeek Harness」 | 无控制台窗口启动官方桌面 |
| 桌面「DeepSeek Harness (更新并启动)」 | 更新 + 增量重建 + 启动（保留控制台以便看构建进度） |
| 桌面「DeepSeek Harness (查看启动日志)」 | 打开最近一次无窗口启动的输出 |
| `desktop\launch-hidden.vbs` | 无窗口启动：`wscript.exe` 以 SW_HIDE 跑整条进程链，输出写 `logs\desktop.log` |
| `desktop\start-official.cmd` | 启动（保留控制台，便于直接看输出） |
| `desktop\update-and-start.cmd` | 更新 + 增量重建 + 启动 |
| `desktop\update-and-start.cmd --check` | 只报告本地/远端状态与将要执行的构建 |

选项：

| 选项 | 作用 |
| --- | --- |
| `--check` | 只报告，不修改任何东西 |
| `--full` | 忽略增量判断，跑完整 `pnpm run build` |
| `--no-build` | 只更新，不构建 |
| `--no-start` | 更新后不启动桌面 |
| `--git <path>` | 指定 git 可执行文件（默认 PATH 上的 `git`） |

两个启动器都会设置 `DSH_HOME`（默认 `%USERPROFILE%\.dsh`），让官方桌面直接用你已有的会话、工作区与凭据；不设置的话官方开发启动器会在 `apps/desktop/.desktop-build` 下另建一个空 home。

首次启动会准备随包运行时（Node + Python，约 270 MB），可能要好几分钟；网络受限时设好 `HTTPS_PROXY` 后重跑即可。

`.cmd` 与 `.vbs` 必须保持 **CRLF 行尾且纯 ASCII**：cmd.exe 会误解析 LF-only 批处理，而其中的 UTF-8 多字节字符会触发 DBCS 前导字节错位。`.gitattributes` 已声明这两类文件为 CRLF。

## 启动前的环境修复（preflight）

两条启动路径都会先跑 `preflight.js`，它只做幂等的两件事：

1. **清理 pnpm 死链。** pnpm 的 `node_modules/.pnpm/node_modules` 会残留已删除包的链接（`install`、`--force`、删 `.modules.yaml` 都报 “Already up to date”，不会清理）。官方开发启动器会遍历该目录并对每条链接 `realpathSync`，任何一条死链都会让启动直接 `ENOENT` 失败。判定标准只有两条：目标不存在，或目标不是包目录（没有 `package.json`）；包名与链接名不同的正常别名（如 `string-width-cjs`）保留。
2. **盖章 exe 图标。** 见下节。

## Windows 图标

上游既没有 `app.setAppUserModelId`，也没给主窗口指定 `icon`，所以任务栏、Alt+Tab 与 exe 图标都来自 Electron 可执行文件本身——未打包启动就是 Electron 默认图标。

这一层**就地**给 `dist\electron.exe` 盖章应用图标与产品名，而**不是**复制改名成 `DeepSeekHarness.exe`：

| 可执行文件 | `app.isPackaged` |
| --- | --- |
| `electron.exe` | `false` → 官方桌面正确进入开发模式 |
| `DeepSeekHarness.exe` | `true` → 官方桌面误判为已打包，去找 `apps/desktop/dsh/desktop-runtime.json` 并启动失败 |

Electron 在 Windows 上按可执行文件名判断 `app.isPackaged`（`process.defaultApp` 是另一个基于参数的信号，两者不等价）。所以改名这个老办法会直接破坏官方桌面的开发模式判定。

盖章用仓库已带的 `rcedit`（`desktop/node_modules/rcedit`），幂等判断记录在 `dist\.dsh-icon-stamp.json`：标记里的图标摘要 + 盖章后的 exe 大小都匹配才跳过；重装依赖把 exe 还原成原始字节后大小会变，下次启动自动重盖。

## 增量构建规则

变更文件 → `pnpm run` 步骤：

| 变更位置 | 构建步骤 |
| --- | --- |
| 仅 `*.md` / `docs/` / `.agents/` / `snapshots/` / `LICENSE` | 不构建 |
| 仅 `.github/` / `website/` / `benchmarks/` / `examples/` | 不构建 |
| 仅 `apps/desktop/**` | `build:desktop` |
| 仅 `apps/web/**` | `build:web` |
| `packages/client/**` | `build:lib` + `build:web` |
| 其它 `packages/**`、`apps/cli/**`、`apps/desktop-host/**`、`vendor/**`、`scripts/**`、根配置文件 | `build:lib` |
| `native/**` | `build:native-system` + `build:lib` |
| 认不出的新区域 | 完整 `build` |

每一步都必须在官方 `package.json` 里真实存在，`tests/build-plan.test.js` 会在嵌套检出时校验这一点。规则判断错时可以 `--full` 覆盖。

## 目录

```
desktop/                    ← 本仓库
  launch-hidden.vbs         无窗口启动（输出写 logs\desktop.log）
  start-official.cmd        启动（保留控制台）
  update-and-start.cmd      更新 + 增量重建 + 启动
  update-and-start.js       编排：fetch → ff → install → build → launch
  preflight.js              启动前修复：清理 pnpm 死链 + 盖章 exe 图标
  link-audit.js             pnpm virtual-hoist 死链的识别与清理
  stamp-electron-icon.js    就地给 electron.exe 盖图标与产品名
  build-plan.js             变更文件 → 构建步骤
  gitup.js                  dirty / behind / lockfile / ff 判定（纯逻辑）
  proc.js                   子进程执行器（超时杀进程树）
  open-log.cmd              打开最近一次无窗口启动的日志
  tests/                    node:test
  assets/                   快捷方式图标与 exe 图标（由官方 icon-windows.png 生成多尺寸 ICO）
```

## 原始桌面壳

本仓库最初实现过一个自包含的 Electron 壳（`main.js`、`preload.js`、`shell-update.js`、`shell-log.js`、`server.js`、`updater.js` 等），自带托盘、更新芯片、应用内日志面板与侧栏布局修正。官方桌面已覆盖其中的窗口、托盘与打包能力，日常入口已切到官方桌面，这部分代码保留作参考与备选：

```sh
npm start                 # 直接跑旧壳（需先按 config.example.json 准备 config.json）
npm run shortcut          # 旧壳的桌面快捷方式（会覆盖指向官方桌面的快捷方式）
```

旧壳的更新器与这一层共用 `gitup.js`、`proc.js`，所以两边的 git 判定语义一致。

## 测试

```sh
node --test
```

嵌套在上游检出内时，测试会额外校验构建步骤名在官方 `package.json` 中存在；单独检出本仓库时该用例自动跳过。

## License

本仓库代码 MIT。官方桌面、web 界面与上游功能归 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT, Copyright (c) 2026 DeepSeek）所有；DeepSeek 徽标归其权利人所有。
