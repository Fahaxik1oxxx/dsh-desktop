# DeepSeek Harness 桌面增强层

日期：2026-09-29
状态：已实现。本仓库是独立 git 仓库，通常嵌套在上游 `deepseek-harness` 克隆的 `desktop/` 下；外层用 `.git/info/exclude` 忽略它。

## 目标

1. 用官方桌面端（上游 `apps/desktop`）作为日常桌面应用，不复制也不修改上游代码。
2. 官方 release 不发布安装包，因此本机路径是源码启动；这一层负责让源码检出保持最新并只重建必要部分。
3. 上游检出始终干净，`git pull` 永远可 fast-forward。

## 非目标

- 不修改上游任何文件（因此不能在上游源码里加更新 UI）。
- 不生成 NSIS / DMG 安装包（需要签名凭据，且官方已有打包流水线）。
- 不替代官方桌面自带的托盘、窗口状态、打包版本自动更新。

## 为什么是外置层

把改动打进 `apps/desktop` 会让每次 `git pull` 都冲突，而“干净工作区 + 只快进”正是自动更新成立的前提。官方桌面还自带宽高耦合的 Host、IPC 与打包脚本，补丁面越大越难跟上上游。所以这一层只做启动前后的事：更新、按需安装、增量构建、启动。

## 目录

```
desktop/                    ← 本仓库
  launch-hidden.vbs         无窗口启动：wscript 以 SW_HIDE 跑整条进程链，输出写 logs\desktop.log
  start-official.cmd        启动（保留控制台）
  update-and-start.cmd      更新 + 增量重建 + 启动
  update-and-start.js       编排：fetch → 脏检查 → ff 检查 → merge → install → build → launch
  preflight.js              启动前修复：清理 pnpm 死链 + 盖章 exe 图标
  link-audit.js             识别并清理 pnpm virtual-hoist 死链
  stamp-electron-icon.js    就地给 electron.exe 盖图标与产品名
  build-plan.js             变更文件 → 构建步骤（纯函数）
  gitup.js                  dirty / behind / lockfile / ff 判定（纯逻辑）
  proc.js                   子进程执行器（超时杀进程树）
  assets/deepseek-win.ico   exe / 任务栏图标（BMP 帧）
  assets/deepseek.ico       快捷方式图标（PNG 帧）
```

本仓库只保留这一层。早期自包含 Electron 壳的代码（`main.js`、`preload.js`、`shell-update.js`、`server.js`、`updater.js`、`window-state.js` 等）已移除，可从 git 历史恢复；`proc.js` 与 `gitup.js` 是旧壳留下、这一层仍在复用的纯逻辑（子进程执行器与 git 判定）。

## 启动前的环境修复

两条启动路径都先跑 `preflight.js`，只做幂等的两件事，且都不碰上游源码。

**pnpm 死链。** `node_modules/.pnpm/node_modules` 会留下已删包的链接；`pnpm install`、`--force`、删 `.modules.yaml` 都只比对锁文件，报 “Already up to date” 而不清理。官方开发启动器 `development-project.ts` 的 `mirrorDependencyLinks` 会遍历该目录并对每条链接 `realpathSync` 再读目标里的 `package.json`，因此一条死链就让整个启动 `ENOENT` 失败。判定只认两种失效：目标不存在，或目标不是包目录；链接名与包名不同的正常别名保留。

**Windows exe 图标。** 上游既无 `app.setAppUserModelId` 也未给主窗口指定 `icon`，任务栏与 exe 图标全部来自 Electron 可执行文件。这里**就地**盖章 `dist\electron.exe`，而不是复制改名：Electron 在 Windows 上按可执行文件名判定 `app.isPackaged`，改名会让官方桌面走打包分支（`development = !app.isPackaged` 变 false），转而去读 `apps/desktop/dsh/desktop-runtime.json` 并启动失败。幂等依据是 `dist\.dsh-icon-stamp.json` 里的图标摘要与盖章后的 exe 大小；重装依赖还原 exe 字节后大小变化，下次启动自动重盖。图标用本仓库自带的 `assets/deepseek-win.ico`，不用上游 `resources` 里的图。

正在运行的实例会锁住 exe，此时盖章失败只告警不阻断启动；因为标记记录的摘要没更新，下次启动会自动补上。

## 更新流程

1. `git status --porcelain --untracked-files=no`：有 tracked 改动则跳过更新、只启动。未跟踪文件不算，避免误判。
2. `git fetch --prune --no-tags origin master`：失败按离线处理，只启动。
3. 本地与 `FETCH_HEAD` 相同即已是最新；否则 `merge-base --is-ancestor HEAD FETCH_HEAD` 判定可快进，分叉则跳过更新、只启动。
4. `git diff --name-only preSha FETCH_HEAD` 得到变更集，`plan = selectDesktopBuildPlan(changed)`；`pnpm-lock.yaml` 在变更集内才 `pnpm install`。
5. `git merge --ff-only FETCH_HEAD`，`preflight()` 修好死链与 exe 图标，然后按 plan 顺序跑构建，最后 `start:desktop`。

`--check` 在第 4 步之后打印结论并退出，不做任何修改。

## 增量构建的边界

- 文档与仓库元数据（`docs/`、`.agents/`、`snapshots/`、`.github/`、`website/`、`benchmarks/`、`examples/`、`*.md`、`LICENSE`）不进入任何产物，跳过全部构建。
- `packages/client/**` 同时算 lib 与 web：前者编译 client 面，后者打前端 bundle。
- `native/**` 额外跑 `build:native-system`（宿主 addon）。
- 认不出的新区域回退完整 `build`；规则判断错时用 `--full`。
- `apps/desktop/lib/main.js` 与 `apps/desktop-host/lib/index.js` 缺失时无视增量判断，强制完整构建。

## 测试

```sh
node --test
```

纯逻辑（构建规划、git 判定、路径转换）全覆盖。嵌套在上游检出内时额外校验：规划出的每个 `pnpm run` 脚本名都真实存在于官方 `package.json`。
