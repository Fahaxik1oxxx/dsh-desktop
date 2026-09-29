// start.js — 启动入口：先修环境，再走快速或完整启动。
//
// `start-official.cmd` 与 `launch-hidden.vbs` 都调用这里，避免启动逻辑分散在批处理里。
// `--check` 只打印启动决策，不启动任何进程，便于排查“为什么这次要完整准备”。
const { preflight } = require('./preflight.js');
const { launchDesktop, planLaunch, markPrepared } = require('./launch.js');

const log = (m) => process.stdout.write(`[start] ${m}\n`);
const warn = (m) => process.stdout.write(`[start] 注意: ${m}\n`);

async function main() {
  const { pruned, stamp, stampError } = preflight();
  if (pruned.length > 0) log(`清理失效依赖链接 ${pruned.length} 个`);
  log(`exe 图标: ${stamp.reason}`);
  if (stampError !== '') warn('exe 图标本次未更新，下次启动重试');

  if (process.argv.includes('--mark-prepared')) {
    const state = await markPrepared();
    log(`已记录准备状态：HEAD ${state.head.slice(0, 8)}；下次启动走快速路径`);
    return 0;
  }

  if (process.argv.includes('--check')) {
    const { state, plan } = await planLaunch();
    log(`启动方式: ${plan.fast ? '快速（跳过镜像与冒烟）' : '完整'} — ${plan.reason}`);
    log(`桌面版本 ${state.desktopRelease}，一次性项目 ${String(state.preparedRelease)}，HEAD ${state.head.slice(0, 8)}`);
    return 0;
  }
  return launchDesktop(log, warn);
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    process.stderr.write(`[start] 失败: ${error.message}\n`);
    process.exitCode = 1;
  });
