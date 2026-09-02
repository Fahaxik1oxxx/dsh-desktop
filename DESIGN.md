# DeepSeek Harness 桌面版（Electron）设计

日期：2026-09-02
状态：已实现（2026-09-02，desktop/ 嵌套 git 5 次提交）。待用户桌面双击验收。

## 目标

1. 把 DSH 的 web 服务（127.0.0.1:3080）包成 Electron 真桌面应用，体验接近 Codex/Claude 桌面版。
2. 用现有桌面快捷方式启动，双击即出独立应用窗口（无浏览器杂项、无黑控制台）。
3. 自动检测 `github.com/deepseek-ai/deepseek-harness` 上游更新：检测到新版本 → 通知 → 用户确认 → git 拉取 + 重建 + 重启。

## 非目标（本轮不做）

- 不生成 NSIS 安装包（源码按固定路径更新，先做便携式壳）。
- 不自动更新 Electron 壳本身（壳是稳定包装层，几乎不变）。
- 不做 Tauri / 不做多平台打包。

## 关键约束（来自仓库现状调查）

- 本地 `D:\AI\DSH` 是 upstream 的直接克隆，master 跟踪 origin/master。
- `apps/web/dist/`、`apps/cli/lib/`、`*.tsbuildinfo` 均被 `.gitignore`，**不提交**。服务器从预构建 `apps/cli/lib/bin.js` 启动并服务 `apps/web/dist` ⇒ **每次拉取源码后必须重建**，否则运行的是旧产物。
- 服务器启动命令（与 `run-dsh-server.cmd` 一致）：
  `"D:\Compile\Node\node.exe" D:\AI\DSH\apps\cli\lib\bin.js web`
- Node 不在系统 PATH，固定用 `D:\Compile\Node\node.exe`（v24）。
- 桌面壳文件必须**不进 git 跟踪**：用 `.git/info/exclude` 忽略 `desktop/`，不修改提交的 `.gitignore`（避免未来 `git pull` 冲突）。更新策略 `--ff-only` 依赖本地不产生额外的 commit。

## 架构

```
D:\AI\DSH\                     ← upstream 源码克隆（保持纯净）
  └─ desktop\                  ← Electron 壳（git 忽略，git pull 永不触碰）
      ├─ package.json
      ├─ main.js               ← 主进程：spawn 服务器、窗口、托盘、退出清理
      ├─ updater.js            ← 更新检测与执行（git+pnpm+build）
      ├─ DESIGN.md             ← 本文档
      └─ start-desktop.cmd     ← 快捷方式目标
```

`.git/info/exclude` 追加一行：`desktop/`

## 组件职责

### main.js（主进程）
- `spawn` 本地服务器（`node apps/cli/lib/bin.js web`，`windowsHide: true`），作为 child process。
- 轮询 http://127.0.0.1:3080（间隔 ~500ms，超时 ~90s）直到就绪 → `BrowserWindow` 加载。就绪前窗口显示 loading。
- 托盘（`deepseek.ico`）：左键显示/隐藏主窗口；右键菜单含「显示/隐藏」「检查更新」「退出」。
- 退出：kill child（进程组），不留孤儿 node 进程。
- `app.setAppUserModelId` + 单实例锁（`requestSingleInstanceLock`）。

### updater.js + IPC
- **检测**：应用启动后 + 每 30 分钟，`git -C <repo> fetch origin master`；比较本地 HEAD 与 `FETCH_HEAD`。网络失败静默（下轮再试）。
- **提示**：落后 → 通知栏 + 应用内确认框「发现新版本 a→b，是否拉取并更新？」。此阶段不改动任何仓库状态。
- **执行**（用户确认后，逐步，任一步失败即中止并回显错误日志）：
  1. `git status --porcelain`（只看 tracked）非空 → 中止，提示「有未提交改动，请先处理」。
  2. `git pull --ff-only origin master`。
  3. `corepack pnpm install --config.confirmModulesPurge=false`（仅当 lockfile 变化；为稳妥每次安装亦可接受——见实现验证）。
  4. 完整构建：`npm run build`（产出 lib + web dist）。
  5. 重启服务器子进程 + `win.webContents.reload()`。
  6. 通知「已更新到 <new-sha>」。
- 日志：`desktop/updater.log`（追加，含时间戳、每步命令与退出码）。

## 快捷方式

`make-shortcut.ps1`（桌面 .lnk）目标改为 `D:\AI\DSH\desktop\start-desktop.cmd`，图标沿用 `D:\AI\DSH\deepseek.ico`。

`start-desktop.cmd` 内容：定位本机 electron 可执行并 `electron <desktopDir>`（或直接调 `desktop\node_modules\electron\dist\electron.exe`，若未安装则先 `corepack pnpm install` 于 desktop 目录并提示首次安装较慢）。

## 已知风险 / 边界

- 国内到 github.com 的 fetch 可能慢/不稳 → 失败静默重试；如用户有代理需配置 git 代理。npm registry 已是 npmmirror。
- Electron 二进制首次下载走 github 可能慢 → 安装时可用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- 本地 master 有被跟踪改动时更新中止（保护用户改动）。
- 若上游对 `D:\AI\DSH` 内文件布局大幅改动，重建命令需相应调整——运行时失败会以日志暴露。

## 测试

- 单元：`updater.js` 的 git 状态判断/版本比较拆成可测纯函数（vitest 或不引依赖的 node:test）。
- 冒烟：手动跑完整更新链路一次（模拟 origin 落后），验证 pull→install→build→重启→窗口正常。
- 服务器拉起/健康检查/退出清理：写脚本验证 spawn→ready→kill 后无残留 node 进程。
