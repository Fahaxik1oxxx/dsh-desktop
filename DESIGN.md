# DeepSeek Harness 桌面版

日期：2026-09-06
状态：已实现。本仓库是独立 git 仓库，嵌套在上游 `deepseek-harness` 克隆的 `desktop/` 下；外层用 `.git/info/exclude` 忽略它，更新链路只 fast-forward 上游。

## 目标

1. 把本地 dsh web（默认 `127.0.0.1:3080`）包成 Electron 桌面应用。
2. 用桌面/开始菜单快捷方式启动，无系统浏览器、无控制台窗口。
3. 检测 `github.com/deepseek-ai/deepseek-harness` 更新：设置旁出现「更新」按钮 → 用户点击 → 快进合并 + 按变更增量重建 + 重启服务器。

## 非目标

- 不生成 NSIS 安装包。
- 不自动更新本 Electron 壳。
- 不做 Tauri、不做多平台打包。

## 目录

```
desktop/                       ← 本仓库
  assets/                      窗口、托盘、盖章 exe 用的图标
  scripts/                     postinstall 盖章、快捷方式、冒烟测试
  tests/                       node:test
  main.js                      主进程：服务器生命周期、窗口、托盘、更新入口
  server.js                    spawn / 端口就绪 / 停止
  updater.js                   git fetch / merge --ff-only / install / 增量构建
  config-lib.js                读取并校验 config.json
  start-desktop.cmd            启动盖章后的 DeepSeekHarness.exe
```

`config.json` 已被 gitignore，按机器填写；`icon` 可省略，默认 `assets/deepseek.ico`。

## 运行时

- 主进程 `spawn` `node apps/cli/lib/bin.js web --no-open`，从启动输出解析带 token 的环回 URL 后加载。
- 关窗隐藏到托盘，不销毁窗口。
- 无系统标题栏；右上角自绘最小化/最大化/关闭。会话头「打开侧边栏」与右栏折叠按钮左移，不与窗口控件重叠。
- 托盘：显示/隐藏、重启服务器、在浏览器打开、打开日志、检查更新。打开日志在窗口内显示实时尾巴，可复制、打开文件夹或用记事本。手动检查更新会显示应用内状态（检查中 / 已是最新 / 无法检查），不依赖系统通知是否弹出。
- 有可用更新时，侧栏「设置」按钮旁出现「更新」；进度在主窗口内，不再另开窗口。
- 更新检测失败静默；本地已分叉或有 tracked 改动则中止，不覆盖工作区。构建按 `git diff` 选 `build:web` / `build:lib+web` / 完整 `build`。
- Windows 任务栏按可执行文件名分组：`npm install` 把 `electron.exe` 复制为 `DeepSeekHarness.exe` 并盖章 `assets/deepseek-win.ico`。

## 测试

```sh
npm test
node scripts/server-smoke.js
```
