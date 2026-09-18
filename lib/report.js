'use strict';

const { formatTime, formatDuration } = require('./checker');

/** 生成 Markdown 格式的校验报告 */
function toMarkdown(state, report) {
  const L = [];
  L.push('# 舞台走位校验报告');
  L.push('');
  L.push(`- 生成时间：${new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}`);
  L.push(`- 舞台区域：${report.areaCount} 个　连接：${report.edgeCount} 条`);
  L.push(`- 演员：${report.actorCount} 人　到位口令：${report.cueCount} 条`);
  L.push(`- 校验区段：${report.totals.segments} 段　不可按时抵达：${report.totals.violations} 段（其中完全不连通：${report.totals.unreachable} 段）`);
  L.push(`- 总体结论：**${report.ok ? '✅ 全部口令可以按时抵达' : '❌ 存在无法按时抵达的走位区段'}**`);
  L.push('');

  L.push('## 区域连接图');
  L.push('');
  L.push('| 连接 | 通行耗时(秒) | 方向 |');
  L.push('| --- | ---: | --- |');
  const areaName = new Map((state.areas || []).map((a) => [a.id, a.name]));
  for (const e of state.edges || []) {
    const a = areaName.get(e.from) || '(已删除)';
    const b = areaName.get(e.to) || '(已删除)';
    L.push(`| ${a} ${e.directed ? '→' : '↔'} ${b} | ${e.seconds} | ${e.directed ? '单向' : '双向'} |`);
  }
  L.push('');

  for (const actor of report.actors) {
    L.push(`## 演员：${actor.actorName}`);
    L.push('');
    if (actor.cueCount === 0) {
      L.push('_该演员暂无到位口令。_');
      L.push('');
      continue;
    }
    L.push('### 到位口令（按时间）');
    L.push('');
    L.push('| 序号 | 时间 | 到位区域 | 备注 |');
    L.push('| ---: | --- | --- | --- |');
    actor.cues.forEach((c, i) => {
      const t = Number.isFinite(c.seconds) ? formatTime(c.seconds) : `${c.time}（格式有误）`;
      L.push(`| ${i + 1} | ${t} | ${c.areaName} | ${(c.note || '').replace(/\|/g, '\\|')} |`);
    });
    L.push('');

    if (actor.segments.length === 0) {
      L.push('_口令不足两条，无区段需要校验。_');
      L.push('');
      continue;
    }

    L.push('### 区段校验');
    L.push('');
    L.push('| 区段 | 时间窗口 | 起点 → 终点 | 最短路径 | 所需(秒) | 可用(秒) | 结果 | 说明 |');
    L.push('| ---: | --- | --- | --- | ---: | ---: | --- | --- |');
    for (const s of actor.segments) {
      const win = `${s.fromTime} → ${s.toTime}`;
      const endpoints = `${s.fromAreaName} → ${s.toAreaName}`;
      const path = s.pathNodeIds
        .map((id) => areaName.get(id) || '?')
        .join(' → ') || '—';
      const need = s.requiredSeconds === null ? '∞' : String(s.requiredSeconds);
      const avail = s.availableSeconds === null ? '—' : String(s.availableSeconds);
      const verdict = s.feasible ? '✅ 可抵达' : '❌ 无法按时抵达';
      L.push(`| ${s.index} | ${win} | ${endpoints} | ${path} | ${need} | ${avail} | ${verdict} | ${s.reason.replace(/\|/g, '\\|')} |`);
    }
    L.push('');
    if (actor.violations > 0) {
      L.push(`> ⚠️ 该演员有 **${actor.violations}** 个区段无法按时抵达。`);
    } else {
      L.push('> ✅ 该演员全部区段均可按时抵达。');
    }
    L.push('');
  }

  L.push('---');
  L.push(`共 ${report.totals.violations} 个违规区段：其中 ${report.totals.unreachable} 个因区域不连通，其余为时间窗口不足。`);
  return L.join('\n');
}

/** JSON 报告文件名时间戳，如 20260918-153012 */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

module.exports = { toMarkdown, stamp, formatDuration };
