# DeepSeek Harness 桌面版

日期：2026-09-10
状态：已实现。本仓库是独立 git 仓库，通常嵌套在上游 `deepseek-harness` 克隆的 `desktop/` 下；外层用 `.git/info/exclude` 忽略它。更新链路只 fast-forward 上游。

## 目标

1. 把本地 dsh web（默认 `127.0.0.1:3080`）包成 Electron 桌面应用。
2. 用桌面/开始菜单快捷方式启动，无系统浏览器、无控制台窗口。
3. 检测 `github.com/deepseek-ai/deepseek-harness` 更新：设置旁出现「更新」→ 用户点击 → 快进合并 + 按变更增量重建 + 重启服务器。

## 非目标

- 不生成 NSIS 安装包。
- 不自动更新本 Electron 壳。
- 不做 Tauri、不做多平台打包。

## 目录

```
desktop/                       ← 本仓库
  assets/                      窗口、托盘、盖章 exe 图标
    deepseek.ico               PNG 帧（通用）
    deepseek-win.ico           BMP 帧（Windows 快捷方式 / 盖章 exe）
  scripts/                     postinstall 盖章、快捷方式、冒烟
  tests/                       node:test
  main.js                      主进程：服务器、窗口、托盘、更新、日志面板
  server.js                    spawn / 端口就绪 / 停止
  updater.js                   git fetch / merge --ff-only / install / 增量构建
  update-build.js              按 diff 选构建命令
  config-lib.js                读取并校验 config.json
  shell-layout.js              为窗口控件留出右上角
  shell-update.js / shell-log.js  注入到页面的更新芯片与日志面板
  start-desktop.cmd            启动盖章后的 DeepSeekHarness.exe
```

`config.json` 已被 gitignore。`icon` 可省略：Windows 优先 `assets/deepseek-win.ico`。

## 运行时

- `spawn` `node apps/cli/lib/bin.js web --no-open`，解析带 token 的环回 URL 后加载。
- 关窗隐藏到托盘。无系统标题栏；自绘最小化/最大化/关闭。会话头「打开侧边栏」与右栏折叠按钮左移，不与窗口控件重叠。
- 托盘：显示/隐藏、重启服务器、在浏览器打开、打开日志、检查更新。打开日志是窗口内实时尾巴（复制 / 打开文件夹 / 记事本）。手动检查更新显示应用内状态，不依赖系统通知。
- 有可用更新时，「设置」旁出现「更新」。确认后：`git merge --ff-only FETCH_HEAD`（检测阶段已 fetch）→ lockfile 变化才 `pnpm install` → `selectBuildCommand` 选 `build:web` / `build:lib+web` / 完整 `build` / 跳过。
- 更新检测失败静默。本地已分叉或有 tracked 改动则中止。
- `npm install` 把 `electron.exe` 复制为 `DeepSeekHarness.exe` 并盖章 `assets/deepseek-win.ico`。`npm run shortcut` 让桌面/开始菜单快捷方式图标指向该 exe。

## 测试

```sh
npm test
node scripts/server-smoke.js
```
