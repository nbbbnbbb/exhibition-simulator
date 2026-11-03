const port = Number(process.env.PORT || 5173);
try {
  const response = await fetch(`http://127.0.0.1:${port}/__ma_health`, {
    signal: AbortSignal.timeout(2000),
  });
  const status = await response.json();
  if (status.app !== 'ma-exhibition-planner' || !Number.isInteger(status.pid) || status.pid <= 0)
    throw new Error('MAのサーバーではありません');
  process.kill(status.pid, 'SIGTERM');
  console.log('間 MAのローカルサーバーを停止しました。');
} catch (err) {
  console.error(`MAの停止対象が見つかりません：${err.message}`);
  process.exitCode = 1;
}
