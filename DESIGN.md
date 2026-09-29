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
  start-official.cmd        只启动官方桌面（设置 DSH_HOME 与开发开关）
  update-and-start.cmd      更新 + 增量重建 + 启动
  update-and-start.js       编排：fetch → 脏检查 → ff 检查 → merge → install → build → launch
  build-plan.js             变更文件 → 构建步骤（纯函数）
  gitup.js                  dirty / behind / lockfile / ff 判定（纯逻辑）
  proc.js                   子进程执行器（超时杀进程树）
  assets/deepseek-official.ico  由官方 icon-windows.png 生成的多尺寸 ICO
  main.js 等                 原始自包含 Electron 壳（保留作参考与备选）
```

## 更新流程

1. `git status --porcelain --untracked-files=no`：有 tracked 改动则跳过更新、只启动。未跟踪文件不算，避免误判。
2. `git fetch --prune --no-tags origin master`：失败按离线处理，只启动。
3. 本地与 `FETCH_HEAD` 相同即已是最新；否则 `merge-base --is-ancestor HEAD FETCH_HEAD` 判定可快进，分叉则跳过更新、只启动。
4. `git diff --name-only preSha FETCH_HEAD` 得到变更集，`plan = selectDesktopBuildPlan(changed)`；`pnpm-lock.yaml` 在变更集内才 `pnpm install`。
5. `git merge --ff-only FETCH_HEAD`，然后按 plan 顺序跑构建，最后 `start:desktop`。

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
