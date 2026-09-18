function fmtTime(sec) {
  const sign = sec < 0 ? '-' : '';
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const STATUS_TEXT = {
  ok: '✅ 可达',
  fail: '❌ 无法按时抵达',
  unreachable: '⛔ 区域不可达',
};

/** 将校验结果渲染为 Markdown 报告 */
function toMarkdown(result) {
  const lines = [];
  const s = result.summary;

  lines.push('# 舞台走位校验报告');
  lines.push('');
  lines.push(`生成时间：${new Date(result.generatedAt).toLocaleString('zh-CN', { hour12: false })}`);
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 演员数 | ${s.actors} |`);
  lines.push(`| 校验区段数 | ${s.segments} |`);
  lines.push(`| ✅ 按时可达 | ${s.ok} |`);
  lines.push(`| ❌ 无法按时抵达 | ${s.failed} |`);
  lines.push(`| ⛔ 区域不可达 | ${s.unreachable} |`);
  lines.push('');

  for (const actor of result.actors) {
    lines.push(`## ${actor.actorName}`);
    lines.push('');
    if (actor.segments.length === 0) {
      lines.push(`（口令数 ${actor.cueCount}，不足两条，无需校验区段）`);
      lines.push('');
      continue;
    }
    lines.push('| # | 起点 | 终点 | 可用时间 | 所需时间 | 结论 | 最短路线 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const seg of actor.segments) {
      const from = `${seg.from.areaName}（${fmtTime(seg.from.time)}）`;
      const to = `${seg.to.areaName}（${fmtTime(seg.to.time)}）`;
      const available = `${seg.availableSeconds} 秒`;
      const required = seg.requiredSeconds === null ? '—' : `${seg.requiredSeconds} 秒`;
      let verdict = STATUS_TEXT[seg.status];
      if (seg.status === 'ok') verdict += `（余 ${seg.slackSeconds} 秒）`;
      if (seg.status === 'fail') verdict += `（缺 ${-seg.slackSeconds} 秒）`;
      const route = seg.path.length > 0 ? seg.path.join(' → ') : '—';
      lines.push(`| ${seg.index} | ${from} | ${to} | ${available} | ${required} | ${verdict} | ${route} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { toMarkdown, fmtTime };
