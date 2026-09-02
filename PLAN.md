# DSH Electron 桌面版实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `D:\AI\DSH\desktop\` 建一个 Electron 壳，把本地 dsh web 服务（127.0.0.1:3080）包成独立桌面应用，并内置「检测 upstream 新版本 → 提示 → 用户确认 → git 拉取+重建+重启」的更新链路；桌面快捷方式改为启动它。

**Architecture:** Electron 主进程 spawn 本地 node 服务器（隐藏控制台）、轮询 3080 就绪后开窗加载；托盘控制显隐/退出；updater 通过 Git Bash 执行 git/pnpm/npm 命令（复用已验证的 PATH 环境）。`desktop/` 被外层仓库 `.git/info/exclude` 忽略，自身是独立嵌套 git 仓库以便逐任务提交。

**Tech Stack:** Electron（Windows，经 npmmirror 镜像安装）、Node 内置 `node:test`（零额外测试依赖）、`D:\Compile\Node\node.exe` v24。

**Spec:** `D:\AI\DSH\desktop\DESIGN.md`

## Global Constraints

- 服务器启动命令（固定）：`"D:\Compile\Node\node.exe" D:\AI\DSH\apps\cli\lib\bin.js web`
- Node/electron 可执行路径与仓库路径一律从 `desktop/config.json` 读取，不在代码里硬编码。
- `D:\AI\DSH` 外层 git：**只允许 ff**；有 tracked 改动必须中止更新。`desktop/` 已忽略，pull 永不触碰。
- 所有 git/pnpm/npm 命令经 Git Bash `bash -lc` 执行（PATH 已含 corepack/pnpm/tsdown），不依赖系统 PATH。
- 构建命令：仓库内 `npm run build`（完整构建）。
- pnpm 安装命令：`corepack pnpm install --config.confirmModulesPurge=false`。
- Electron 安装镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- 交互语言：中文提示。
- 更新检测网络失败：静默，下一轮重试，不打扰用户。

---

### Task 0: 环境探测与骨架

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/config.json`
- Create: `desktop/.gitignore`
- Modify: `D:\AI\DSH\.git\info\exclude`（追加 `desktop/`）
- Create: `desktop/tests/.gitkeep`

**Interfaces:**
- Produces: `desktop/config.json`（字段见 Step 3），后续任务全部从此文件读配置。

- [ ] **Step 1: 记录三个环境可执行路径**
  用 bash 探测并记录：Git Bash 完整路径（`which bash` 的 Windows 路径）、`D:\Compile\Node\node.exe` 存在、corepack/pnpm 经 `corepack pnpm --version` 可用、system PATH 里无 npm/pnpm（决定为何要走 bash）。把这些写进本任务结论，供 Step 3 填 config。

- [ ] **Step 2: 忽略 + 嵌套 git**
  - 向 `D:\AI\DSH\.git\info\exclude` 追加一行 `desktop/`（用 bash 追加，保留已有内容）。
  - 在 `desktop/` 内 `git init`（嵌套仓库，供逐任务提交）。`desktop/.gitignore` 内容：`node_modules/`、`*.log`。
  - 验证：外层 `git -C D:\AI\DSH status --porcelain` 不含 desktop 相关行。

- [ ] **Step 3: 写 config.json 与 package.json**
  `config.json`：
  ```json
  {
    "repo": "D:\\AI\\DSH",
    "nodeExe": "D:\\Compile\\Node\\node.exe",
    "bashExe": "<Step1 探测到的 Git Bash 完整路径>",
    "serverArgs": ["apps/cli/lib/bin.js", "web"],
    "port": 3080,
    "url": "http://127.0.0.1:3080",
    "icon": "D:\\AI\\DSH\\deepseek.ico",
    "checkIntervalMs": 1800000
  }
  ```
  `package.json`：`{ "name": "dsh-desktop", "private": true, "version": "0.1.0", "main": "main.js", "scripts": { "start": "electron .", "test": "D:\\Compile\\Node\\node.exe --test tests/" } }`，`devDependencies: { "electron": "^33" }`（按当前稳定版）。

- [ ] **Step 4: 安装 Electron（走镜像）**
  在 `desktop/` 内：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ corepack pnpm install`（只装 devDep electron）。验证 `desktop/node_modules/electron/dist/electron.exe` 存在。
  若镜像失败，换官方源重试，并记录。

- [ ] **Step 5: 验证 `npm run build` 可经 bash 执行**
  在 `D:\AI\DSH` 内执行 `bash -lc 'npm run build'` 一次（首次较慢，作为环境证明；若因时长超时，改为 `bash -lc 'npm run build:lib:host'` 快速片段验证 npm 脚本链路可用即可，完整构建留到 Task 3 集成验证）。

- [ ] **Step 6: Commit（desktop 嵌套仓库）**
  `git add -A && git commit -m "chore: scaffold dsh-desktop shell"`（在 desktop/ 内）。

---

### Task 1: 进程执行与 git 判定纯函数

**Files:**
- Create: `desktop/proc.js`
- Create: `desktop/gitup.js`
- Test: `desktop/tests/gitup.test.js`

**Interfaces:**
- `proc.js` exports `run(exe, args, { cwd, env, timeoutMs })` → `Promise<{code, stdout, stderr}>`（捕获输出，超时 kill，不抛异常，只返回对象）。
- `gitup.js` exports：
  - `hasTrackedChanges(porcelainText)` → `boolean`（任一行不以 `??` 开头即 true）。
  - `isBehind(localSha, remoteSha)` → `boolean`（不相等即视为可能落后；具体能否 ff 另查）。
  - `lockfileChanged(repo, runFn, head, fetchHead)` → `Promise<boolean>`（`git diff --name-only <head> <fetchHead> -- pnpm-lock.yaml` 非空）。
  - `ffPossible(repo, runFn)` → `Promise<boolean>`（`git merge-base --is-ancestor HEAD FETCH_HEAD` 退出码 0）。

- [ ] **Step 1: 写失败测试**（`gitup.test.js`，用系统 git 在 `fs.mkdtemp` 临时目录建 fixture 仓库）

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hasTrackedChanges, lockfileChanged, ffPossible } = require('../gitup.js');

test('hasTrackedChanges: 忽略纯未跟踪文件', () => {
  assert.equal(hasTrackedChanges('?? a.log\n?? desktop/\n'), false);
});
test('hasTrackedChanges: tracked 修改返回 true', () => {
  assert.equal(hasTrackedChanges(' M src/x.js\n?? b.log\n'), true);
});

test('lockfileChanged: 注入 runner diff 出 pnpm-lock 返回 true', async () => {
  const runFn = async () => ({ code: 0, stdout: 'pnpm-lock.yaml\n', stderr: '' });
  assert.equal(await lockfileChanged('/x', runFn, 'h', 'f'), true);
});
test('lockfileChanged: diff 为空返回 false', async () => {
  const runFn = async () => ({ code: 0, stdout: '', stderr: '' });
  assert.equal(await lockfileChanged('/x', runFn, 'h', 'f'), false);
});
```

- [ ] **Step 2: 跑测试确认失败**：`D:\Compile\Node\node.exe --test tests/gitup.test.js` → FAIL（`cannot find module '../gitup.js'`）。

- [ ] **Step 3: 实现 proc.js + gitup.js**

```js
// proc.js
const { spawn } = require('node:child_process');
function run(exe, args, { cwd, env, timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, env, windowsHide: true, shell: false });
    let stdout = '', stderr = '';
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, stdout, stderr: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}
module.exports = { run };

// gitup.js
const { run } = require('./proc.js');
function hasTrackedChanges(porcelainText) {
  return porcelainText.split('\n').some((l) => l.trim() !== '' && !l.startsWith('??'));
}
function isBehind(localSha, remoteSha) { return localSha !== remoteSha; }
async function lockfileChanged(repo, runFn, head, fetchHead) {
  const r = await runFn(['git', 'diff', '--name-only', head, fetchHead, '--', 'pnpm-lock.yaml'], repo);
  return r.code === 0 && r.stdout.trim().length > 0;
}
async function ffPossible(repo, runFn) {
  const r = await runFn(['git', 'merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], repo);
  return r.code === 0;
}
module.exports = { hasTrackedChanges, isBehind, lockfileChanged, ffPossible };
```

- [ ] **Step 4: 跑测试确认通过**：同上命令 → PASS。

- [ ] **Step 5: Commit**：desktop 内 `git add -A && git commit -m "feat: proc + git judgement helpers with tests"`。

---

### Task 2: updater 检测与执行编排

**Files:**
- Create: `desktop/updater.js`
- Create: `desktop/scripts/update-lib.js`（把可测的编排逻辑抽成函数）
- Test: `desktop/tests/updater.test.js`

**Interfaces:**
- `update-lib.js` 导出 `runUpdateChain(steps, runFn)`：`steps` 为 `{name, fn}[]`，顺序执行；某步返回 `{ok:false, reason}` 即短路返回 `{ok:false, reason, at:name}`；全过返回 `{ok:true}`。
- `updater.js`（被 main.js require）exports：
  - `checkForUpdate(cfg)` → `Promise<{ahead:boolean, localSha, remoteSha}>`（先 `bash -lc 'git fetch origin master'`，再比对 HEAD/FETCH_HEAD）。
  - `applyUpdate(cfg, onProgress)` → `Promise<{ok:true, sha} | {ok:false, reason}>`：按序 ① tracked 改动检查→中止 ② `git merge-base` 确保 ff → `git pull --ff-only` ③ `lockfileChanged`→若变则 `corepack pnpm install --config.confirmModulesPurge=false` ④ `npm run build` ⑤ 返回新 HEAD sha。每步失败回显 reason。

- [ ] **Step 1: 写失败测试**（`updater.test.js`）：`runUpdateChain` 短路与成功路径

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runUpdateChain } = require('../scripts/update-lib.js');

test('全步骤成功返回 ok', async () => {
  const steps = [1, 2, 3].map((n) => ({ name: 's' + n, fn: async () => ({ ok: true }) }));
  assert.deepEqual(await runUpdateChain(steps), { ok: true });
});
test('任一步失败即短路', async () => {
  const calls = [];
  const steps = [
    { name: 'a', fn: async () => { calls.push('a'); return { ok: true }; } },
    { name: 'b', fn: async () => { calls.push('b'); return { ok: false, reason: 'dirty' }; } },
    { name: 'c', fn: async () => { calls.push('c'); return { ok: true }; } },
  ];
  const res = await runUpdateChain(steps);
  assert.deepEqual(res, { ok: false, reason: 'dirty', at: 'b' });
  assert.deepEqual(calls, ['a', 'b']);
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。
- [ ] **Step 3: 实现 update-lib.js + updater.js**
  `update-lib.js` 按上述接口。`updater.js` 把 fetch/pull/install/build 封装为 `steps`；git/pnpm/npm 一律经 `bashExe -lc '<cmd>'`（cwd=`cfg.repo`，env 继承 + `ELECTRON_MIRROR` 无关）；`applyUpdate` 首步 dirty 检查：`git status --porcelain --untracked-files=no` 输出喂 `hasTrackedChanges`，命中即 `{ok:false, reason:'工作区有未提交改动，请先处理'}`。每步 stdout 尾部行通过 `onProgress` 回传。
- [ ] **Step 4: 跑测试确认通过** → PASS。
- [ ] **Step 5: Commit**：`feat: update orchestrator (detect + apply) with tests`。

---

### Task 3: Electron 主进程（服务器生命周期 + 窗口 + 托盘）

**Files:**
- Create: `desktop/main.js`
- Create: `desktop/server.js`（spawn/健康检查/退出，从 main.js 抽出，便于脚本验证）
- Create: `desktop/scripts/server-smoke.js`（非 GUI：spawn 服务器→等 3080→确认→kill→断言无残留 node 进程）

**Interfaces:**
- `server.js` exports：
  - `startServer(cfg)` → `{ child, ready: Promise<void>, stop(): Promise<void> }`；`ready` 用 `net.connect(cfg.port)` 轮询（~500ms 间隔），超时 90s reject。
  - `stop()`：`child.kill()`，若失败回退 `taskkill /pid <pid> /T /F`。
- `main.js`：app 单实例锁 → `startServer` → await ready → `BrowserWindow`(1280×800, icon=cfg.icon, loadURL cfg.url) → 托盘（icon；左键显隐；菜单：显示/隐藏、检查更新、退出）→ `window-all-closed` 不退出（托盘常驻）→ `before-quit` 调 `stop()`。
  - 服务器启动失败（ready reject 或 child exit≠0）→ `dialog.showErrorBox` 给子进程 stderr 尾部，托盘常驻供重试/退出。
  - 更新入口：启动 10s 后 + 每 `cfg.checkIntervalMs` 跑 `checkForUpdate`；`ahead` → `Notification`(标题「发现新版本」) + `dialog.showMessageBox`(按钮：更新/稍后) → 确认后 `applyUpdate`（进度经窗口 `webContents.send('update-progress', line)`；完成 `Notification('已更新到 <sha>')`，失败 `dialog.showErrorBox`）。

- [ ] **Step 1: 写 server.js + server-smoke.js 并跑**
  server-smoke.js：`startServer(cfg) → await ready → console.log('READY') → await stop() → 用 tasklist 断言无该 pid → process.exit(0)`。
  运行：`D:\Compile\Node\node.exe scripts/server-smoke.js`。预期打印 READY、退出码 0、无残留 node 进程。

- [ ] **Step 2: 写 main.js**（按上述职责；转发 server 子进程 stdout/stderr 追加到 `desktop/app.log`）

- [ ] **Step 3: 手动 GUI 冒烟（用户参与）**
  运行 `desktop\node_modules\electron\dist\electron.exe .`：预期出现带图标的独立窗口加载 `127.0.0.1:3080`；托盘出现；关窗后托盘/服务器仍在；托盘「退出」后无残留 node。

- [ ] **Step 4: Commit**：`feat: electron main with server lifecycle, tray, window`。

---

### Task 4: 快捷方式接线与收尾

**Files:**
- Create: `desktop/start-desktop.cmd`
- Modify: `D:\AI\DSH\make-shortcut.ps1`（Target 默认值改 `D:\AI\DSH\desktop\start-desktop.cmd`；其余不变）

**Interfaces:**
- `start-desktop.cmd`：`@echo off`；优先 `desktop\node_modules\electron\dist\electron.exe .`（cwd=desktop），electron 缺失则提示先安装并退出。

- [ ] **Step 1: 写 start-desktop.cmd**（见 Interfaces）。
- [ ] **Step 2: 更新 make-shortcut.ps1 的 Target 默认值**，并重跑生成桌面快捷方式（`powershell -ExecutionPolicy Bypass -File make-shortcut.ps1`）。
- [ ] **Step 3: 端到端**：双击桌面「DeepSeek Harness」→ 应用窗口出现（无浏览器/无黑窗）。
- [ ] **Step 4: Commit（desktop 内）**：`feat: desktop launcher + shortcut wiring`。
- [ ] **Step 5: 更新 DESIGN.md** 状态为已实现；向用户总结使用方式与「检测更新→确认」交互路径。
