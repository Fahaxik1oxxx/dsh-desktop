# dsh-desktop — DeepSeek Harness 桌面壳

把本地运行的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web 界面包成 Electron 桌面应用。本仓库只包含壳：窗口、托盘、服务器生命周期、应用内更新。web 页面来自上游 `apps/web`，不包含也不修改上游代码。上游 MIT，版权归 DeepSeek。

## 工作方式

```
deepseek-harness/            ← 上游克隆（保持可 fast-forward）
  └─ desktop/                ← 本仓库（独立 git，嵌套在外层克隆内）
       assets/               窗口 / 托盘 / 盖章 exe 图标
       scripts/              盖章 exe、快捷方式、冒烟测试
       tests/                node:test
```

- 主进程 `spawn` `node apps/cli/lib/bin.js web --no-open`（默认 127.0.0.1:3080）。从启动输出解析带 token 的环回 URL 后只在 Electron 窗口加载；`--no-open` 禁止上游打开系统浏览器。启动前预检端口占用。
- 关窗隐藏到托盘，不销毁窗口。无系统标题栏：自绘最小化/最大化/关闭叠在右上角。会话头「打开侧边栏」和右栏折叠按钮会左移，避免叠在关闭键上。
- 服务意外退出自动重启（最多 5 次）；主动停止/退出应用不会误触发。
- 更新器每 `checkIntervalMs`（默认 30 分钟）`git fetch --prune --no-tags origin master`。发现新版本时，侧栏「设置」旁出现「更新」。托盘「检查更新」把窗口提到前台，应用内显示检查中 / 已是最新 / 无法检查 / 无法快进，不依赖系统通知。
- 点「更新」后：本地 `git merge --ff-only FETCH_HEAD`（不再二次 fetch）→ lockfile 变化时 `corepack pnpm install` → 按 diff 选最短构建 → 重启服务器。进度在主窗口右下角。
- 构建选择：仅文档/notes/snapshots 跳过；仅 `apps/web` 或 `packages/client` 走 `npm run build:web`；普通代码走 `npm run build:lib && npm run build:web`；动到 `native/` 才跑完整 `npm run build`。
- 外层克隆只允许 fast-forward。工作区有 tracked 改动或本地已分叉时中止，不覆盖本地内容。
- 网页新开链接交给系统浏览器。托盘：显示/隐藏、重启服务器、在浏览器打开、打开日志、检查更新；tooltip 带当前 HEAD。打开日志是窗口内实时尾巴（复制 / 打开文件夹 / 记事本），Esc 关闭。

## 环境要求

- Windows + [Git for Windows](https://gitforwindows.org/)
- Node.js v22.12+（建议与上游一致：`^22.19 || >=24`）
- 上游已 `pnpm install && pnpm run build`（服务器从 `apps/cli/lib/bin.js` 启动）

## 从零安装

```sh
# 1. 克隆上游并构建
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build

# 2. 在上游根目录创建 .env（没有它界面能启动，但无法对话）
#    DEEPSEEK_API_KEY=sk-xxxxxxxx

# 3. 克隆本仓库并安装
cd ..
git clone https://github.com/Fahaxik1oxxx/dsh-desktop.git
cd dsh-desktop
npm install

# 4. 本机配置（Windows cmd 用 copy）
cp config.example.json config.json

# 5. 启动（任务栏图标请用下一节的快捷方式，不要直接 npm start）
npm start
```

已有构建好的上游克隆时从第 3 步开始。若把本仓库放在上游的 `desktop/` 下，向外层 `.git/info/exclude` 追加 `desktop/`，以免污染上游工作区。

编辑 `config.json`（已被 gitignore）：

| 字段 | 含义 |
| --- | --- |
| `repo` | 外层 deepseek-harness 克隆的绝对路径 |
| `nodeExe` | node.exe 绝对路径 |
| `bashExe` | Git Bash `bash.exe`（通常 `C:\Program Files\Git\usr\bin\bash.exe`） |
| `gitExe` | 可选。缺省从 `bashExe` 推导（新版 Git for Windows 在 `cmd\git.exe`） |
| `serverArgs` | 默认 `["apps/cli/lib/bin.js", "web", "--no-open"]` |
| `port` / `url` | 服务器端口与加载地址 |
| `icon` | 可选。相对路径相对 `config.json`。省略时 Windows 优先 `assets/deepseek-win.ico` |
| `checkIntervalMs` | 更新检测间隔，毫秒 |
| `autoStart` | 可选，开机自启，默认 `false` |
| `hotkey` | 可选，全局呼出/隐藏，如 `Alt+Shift+D`；空字符串关闭 |

Electron 下载慢可设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 桌面图标与启动

Windows 任务栏按可执行文件名分组。直接跑 `electron.exe` 或 `npm start` 永远是 Electron 默认图标。`npm install` 会复制并盖章 `DeepSeekHarness.exe`。请用桌面快捷方式或 `start-desktop.cmd`：

```sh
npm run shortcut
```

快捷方式图标取自盖章后的 exe，不依赖会搬家的 `.ico` 路径。若桌面图标空白或任务栏仍钉着旧 Electron 图标：再跑一次 `npm run shortcut`，取消固定后从新快捷方式打开并重新固定。

## 日常使用

| 动作 | 结果 |
| --- | --- |
| 关窗 | 隐藏到托盘，内容保留 |
| 托盘左键 / 显示隐藏 | 恢复或隐藏主窗口 |
| 检查更新 | 窗口前台 + 设置旁状态芯片；已是最新显示约 6 秒 |
| 有新版本时点「更新」 | 快进合并 + 增量构建 + 重启服务 |
| 打开日志 | 窗口内实时尾巴，不必先开记事本 |
| 重启服务器 | 停掉再拉起本地 dsh web |

## 开发与测试

```sh
npm test                         # 单元测试
node scripts/server-smoke.js     # 非 GUI 冒烟：拉起真实服务器，停掉后断言端口释放
```

PATH 里没有 node 时用绝对路径，例如 `"D:\Compile\Node\node.exe" --test`。架构见 [DESIGN.md](DESIGN.md)。

## License

本仓库代码 MIT。web 界面与上游功能归 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT, Copyright (c) 2026 DeepSeek）；DeepSeek 徽标归其权利人所有。
