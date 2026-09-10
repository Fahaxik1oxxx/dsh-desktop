# dsh-desktop — DeepSeek Harness 桌面壳

把本地运行的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web 界面包成 Electron 桌面应用，并内置「检测 upstream 新版本 → 提示 → 用户确认 → git 拉取 + 重建 + 重启」的更新链路。

> **说明**：应用里的 web 页面本身来自上游 deepseek-harness（`apps/web`），本仓库只包含 Electron 壳、服务器生命周期管理和更新器，不包含也不修改上游代码。上游项目 MIT 许可，版权归 DeepSeek 所有。

## 工作方式

```
deepseek-harness/            ← 上游仓库的干净克隆（保持可 fast-forward）
  └─ desktop/                ← 本仓库（独立 git 仓库，嵌套在外层克隆内）
       assets/               窗口 / 托盘 / 任务栏图标
       scripts/              盖章 exe、快捷方式、冒烟测试
       tests/                单元测试
```

- 主进程 spawn 本地 node 服务器（`node apps/cli/lib/bin.js web --no-open`，默认 127.0.0.1:3080），从启动输出解析本进程带 token 的 URL 后只在 Electron 窗口加载；`--no-open` 关掉上游默认的系统浏览器跳转。启动前预检端口占用，被别的程序占了会直接报明确原因。布局保持左右两栏、不另开顶栏：最小化/最大化/关闭叠在右栏右上角；会话头「打开侧边栏」和右栏折叠按钮会左移，避免叠在关闭键上。
- 服务就绪后进入看护：进程意外退出自动重启（最多 5 次），主动停止/退出应用不会误触发。
- 更新器每 `checkIntervalMs`（默认 30 分钟）用 `git fetch` 比对远端。发现新版本时，侧栏「设置」旁出现「更新」按钮。托盘「检查更新」会把主窗口提到前台：检查中显示「检查中…」，已是最新显示绿色「已是最新」约 6 秒（右下角同步提示），无法连接或无法快进则显示警告。点「更新」后：本地 `git merge --ff-only FETCH_HEAD` → 依赖变化时 `corepack pnpm install` → 按变更文件选最短构建 → 重启服务器。进度叠在主窗口右下角。
- 外层克隆只允许 fast-forward：工作区有 tracked 改动或本地已分叉时更新中止，不会覆盖任何本地内容。
- 网页里新开的链接交给系统浏览器；托盘支持 显示/隐藏、重启服务器、在浏览器打开、打开日志、检查更新，tooltip 带当前仓库 HEAD。托盘「打开日志」在窗口内显示实时尾巴（复制 / 打开文件夹 / 记事本），不再默认扔进记事本。

## 环境要求

- Windows + [Git for Windows](https://gitforwindows.org/)（更新链路经 Git Bash 执行）
- Node.js（建议 v22+）
- 上游仓库已安装依赖并完成过一次构建（服务器从 `apps/cli/lib/bin.js` 启动，启动前需要 `pnpm install && pnpm run build`）

## 从零安装

桌面壳只是包装层：web 界面来自上游源码构建出的产物，壳的自动更新也依赖上游的源码克隆（git 拉取 + 重建）。第一次使用先把上游跑通：

```sh
# 1. 克隆上游 deepseek-harness 并构建（Node ≥22.19 或 ≥24；pnpm 可用 corepack 启用，或 npm i -g pnpm）
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build

# 2. 配置 API Key：在 deepseek-harness 根目录创建 .env，写入一行
#    （没有它界面能启动，但无法对话）：
#    DEEPSEEK_API_KEY=sk-xxxxxxxx

# 3. 在任意目录克隆本仓库并安装
cd ..
git clone https://github.com/Fahaxik1oxxx/dsh-desktop.git
cd dsh-desktop
npm install

# 4. 创建本机配置（Windows cmd 下用 copy 代替 cp），按下一节的字段表改成实际路径
cp config.example.json config.json

# 5. 启动
npm start
```

已经有构建好的上游克隆的话，从第 3 步开始即可。若把本仓库放在上游克隆的 `desktop/` 下，记得让外层 git 忽略该目录（例如 `.git/info/exclude` 加一行 `desktop/`），以免污染上游工作区。

编辑 `config.json`（已被 gitignore，按机器填写，代码不硬编码任何路径）：

| 字段 | 含义 |
| --- | --- |
| `repo` | 外层 deepseek-harness 克隆的绝对路径 |
| `nodeExe` | node.exe 绝对路径（服务器与更新链路都用它） |
| `bashExe` | Git Bash 的 `bash.exe` 绝对路径（`C:\Program Files\Git\usr\bin\bash.exe`） |
| `gitExe` | 可选，git.exe 绝对路径；缺省时从 `bashExe` 按 Git for Windows 各目录布局自动推导（新版安装通常在 `cmd\git.exe`） |
| `serverArgs` | 传给 node 的服务器入口参数，默认 `["apps/cli/lib/bin.js", "web", "--no-open"]`（`--no-open` 禁止上游打开系统浏览器） |
| `port` / `url` | 服务器端口与加载地址 |
| `icon` | 可选，窗口/托盘图标；相对路径相对 `config.json`。省略则用本仓库 `assets/deepseek.ico` |
| `checkIntervalMs` | 更新检测间隔，毫秒 |
| `autoStart` | 可选，开机自启（Windows 登录项），默认 `false` |
| `hotkey` | 可选，全局呼出/隐藏窗口快捷键如 `Alt+Shift+D`；缺省或空字符串关闭 |

Electron 下载慢可设镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

Windows 任务栏按可执行文件名分组：直接跑 `electron.exe` 永远是 Electron 默认图标。`npm install` 会复制并盖章 `DeepSeekHarness.exe`；请用桌面快捷方式或 `start-desktop.cmd` 启动。创建/刷新快捷方式：

```sh
npm run shortcut
```

若任务栏仍钉着旧的 Electron 图标，先取消固定，再从新快捷方式打开并重新固定。

## 开发与测试

```sh
npm test                         # 单元测试（更新编排、路径转换、git 判定、配置校验）
node scripts/server-smoke.js     # 非 GUI 冒烟：拉起真实服务器等 3080 就绪，停掉后断言端口释放
```

PATH 里没有 node 时，用绝对路径运行，例如 `"D:\Compile\Node\node.exe" --test`。

架构说明见 [DESIGN.md](DESIGN.md)。

## License

本仓库代码 MIT。web 界面与上游功能归 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT, Copyright (c) 2026 DeepSeek）所有；DeepSeek 徽标归其权利人所有。
