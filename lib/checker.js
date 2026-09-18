'use strict';

/**
 * 走位校验核心逻辑（无 Express 依赖，方便单元测试与服务端复用）
 *
 * 数据模型：
 *   areas:    [{ id, name, x, y }]                         舞台区域节点
 *   edges:    [{ id, from, to, seconds, directed }]        区域连接（通行耗时，秒）
 *   actors:   [{ id, name, color }]                        演员
 *   cues:     [{ id, actorId, time, areaId, note }]        到位口令（按时间排序）
 */

/** 解析 "HH:MM:SS" / "MM:SS" / 纯秒数，返回秒；非法返回 NaN */
function parseTime(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'string') return NaN;
  const s = input.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':');
  if (parts.length < 1 || parts.length > 3) return NaN;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return NaN;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + Number(p);
  return secs;
}

/** 秒 -> HH:MM:SS（不足 1 秒保留一位小数） */
function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return '--:--:--';
  const negative = totalSeconds < 0;
  let v = Math.abs(totalSeconds);
  const h = Math.floor(v / 3600);
  v -= h * 3600;
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  let out;
  if (Number.isInteger(totalSeconds)) {
    out = `${pad(h)}:${pad(m)}:${pad(s)}`;
  } else {
    out = `${pad(h)}:${pad(m)}:${s.toFixed(1).padStart(4, '0')}`;
  }
  return negative ? `-${out}` : out;
}

/** 把任意秒数差渲染成可读时长，如 "25 秒" / "1 分 05 秒" */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '不可达';
  const n = Math.ceil(seconds);
  if (n < 60) return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)} 秒`;
  const m = Math.floor(n / 60);
  const s = n - m * 60;
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}

/** 最小堆优先队列（元素 [节点id, 距离]） */
class MinHeap {
  constructor() {
    this.a = [];
  }
  size() {
    return this.a.length;
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * 构建邻接表。
 * directed=false（默认）的连接按双向处理；directed=true 仅 from -> to。
 * 同一对节点间允许多条边，取最短参与计算。
 */
function buildAdjacency(areas, edges) {
  const adj = new Map();
  for (const area of areas) adj.set(area.id, []);
  for (const e of edges) {
    const seconds = Number(e.seconds);
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    adj.get(e.from).push({ to: e.to, w: seconds });
    if (!e.directed) adj.get(e.to).push({ to: e.from, w: seconds });
  }
  return adj;
}

/** Dijkstra：返回 { dist, prev }；面积/边规模小，O((V+E)logV) 足够 */
function dijkstra(adj, source) {
  const dist = new Map();
  const prev = new Map();
  for (const id of adj.keys()) dist.set(id, Infinity);
  dist.set(source, 0);
  const heap = new MinHeap();
  heap.push([source, 0]);
  while (heap.size()) {
    const [u, d] = heap.pop();
    if (d > dist.get(u)) continue;
    for (const { to, w } of adj.get(u)) {
      const nd = d + w;
      if (nd < dist.get(to)) {
        dist.set(to, nd);
        prev.set(to, u);
        heap.push([to, nd]);
      }
    }
  }
  return { dist, prev };
}

/** 还原最短路径上的节点 id 序列（含起止） */
function reconstructPath(prev, source, target) {
  if (source === target) return [source];
  const path = [];
  let cur = target;
  let guard = 0;
  while (cur !== undefined) {
    path.push(cur);
    if (cur === source) break;
    cur = prev.get(cur);
    if (++guard > 10000) return null;
  }
  if (path[path.length - 1] !== source) return null;
  return path.reverse();
}

/** 由节点路径还原依次经过的边（选两节点间耗时最短的那条），返回 edge id 列表 */
function edgesOnPath(nodePath, edges) {
  const out = [];
  if (!nodePath) return out;
  for (let i = 0; i < nodePath.length - 1; i++) {
    const a = nodePath[i];
    const b = nodePath[i + 1];
    let best = null;
    for (const e of edges) {
      const fwd = e.from === a && e.to === b;
      const rev = !e.directed && e.from === b && e.to === a;
      if ((fwd || rev) && (best === null || Number(e.seconds) < Number(best.seconds))) best = e;
    }
    if (best) out.push(best.id);
  }
  return out;
}

/**
 * 执行全量走位校验。
 * @returns {
 *   generatedAt, areaCount, edgeCount, actorCount, cueCount,
 *   ok, actors: [{ actorId, actorName, color, cueCount, segments, violations }],
 *   totals: { segments, violations, unreachable }
 * }
 */
function evaluate(state) {
  const areas = state.areas || [];
  const edges = state.edges || [];
  const actors = state.actors || [];
  const cues = state.cues || [];
  const areaMap = new Map(areas.map((a) => [a.id, a]));
  const adj = buildAdjacency(areas, edges);

  const resultActors = [];
  let totalSegments = 0;
  let totalViolations = 0;
  let totalUnreachable = 0;

  for (const actor of actors) {
    const actorCues = cues
      .filter((c) => c.actorId === actor.id)
      .map((c) => ({ ...c, seconds: parseTime(c.time) }))
      // 同一时刻按 id 稳定排序，保证相邻关系确定
      .sort((a, b) => a.seconds - b.seconds || String(a.id).localeCompare(String(b.id)));

    const segments = [];
    for (let i = 0; i < actorCues.length - 1; i++) {
      const from = actorCues[i];
      const to = actorCues[i + 1];
      const available = to.seconds - from.seconds;
      const seg = {
        index: i + 1,
        fromCueId: from.id,
        toCueId: to.id,
        fromAreaId: from.areaId,
        toAreaId: to.areaId,
        fromAreaName: (areaMap.get(from.areaId) || {}).name || '(已删除区域)',
        toAreaName: (areaMap.get(to.areaId) || {}).name || '(已删除区域)',
        fromTime: from.time,
        toTime: to.time,
        availableSeconds: Number.isFinite(available) ? available : null,
        requiredSeconds: null,
        pathNodeIds: [],
        pathEdgeIds: [],
        reachable: false,
        feasible: false,
        // ok 可抵达 | shortfall 时间不足 | unreachable 不连通 | invalid 数据问题
        kind: 'invalid',
        reason: '',
      };

      const fromExists = areaMap.has(from.areaId);
      const toExists = areaMap.has(to.areaId);
      if (!fromExists || !toExists) {
        seg.kind = 'invalid';
        seg.reason = '口令引用的区域不存在，请检查已删除的区域';
      } else if (!Number.isFinite(from.seconds) || !Number.isFinite(to.seconds)) {
        seg.kind = 'invalid';
        seg.reason = '口令时间格式无效（支持 HH:MM:SS、MM:SS 或秒数）';
      } else if (available < 0) {
        seg.kind = 'invalid';
        seg.reason = '后一条口令时间早于前一条';
      } else {
        const { dist, prev } = dijkstra(adj, from.areaId);
        const need = dist.get(to.areaId);
        if (Number.isFinite(need)) {
          seg.reachable = true;
          seg.requiredSeconds = need;
          const nodePath = reconstructPath(prev, from.areaId, to.areaId);
          seg.pathNodeIds = nodePath || [];
          seg.pathEdgeIds = edgesOnPath(nodePath, edges);
          if (from.areaId === to.areaId) {
            seg.kind = 'ok';
            seg.feasible = true;
            seg.reason = '两条口令位于同一区域，无需移动';
          } else if (need <= available) {
            seg.kind = 'ok';
            seg.feasible = true;
            seg.reason = `最短通行 ${formatDuration(need)}，可用 ${formatDuration(available)}，` +
              (available - need === 0 ? '刚好按时抵达，无余量' : `余量 ${formatDuration(available - need)}`);
          } else {
            seg.kind = 'shortfall';
            seg.feasible = false;
            seg.reason = `最短通行 ${formatDuration(need)}，但仅有 ${formatDuration(available)}，缺口 ${formatDuration(need - available)}`;
          }
        } else {
          seg.kind = 'unreachable';
          seg.reachable = false;
          seg.feasible = false;
          seg.reason = '两个区域之间没有连通路径，无论多少时间都无法抵达';
        }
      }
      segments.push(seg);
    }

    const violations = segments.filter((s) => !s.feasible).length;
    const unreachable = segments.filter((s) => s.kind === 'unreachable').length;
    totalSegments += segments.length;
    totalViolations += violations;
    totalUnreachable += unreachable;
    resultActors.push({
      actorId: actor.id,
      actorName: actor.name,
      color: actor.color || '#6366f1',
      cueCount: actorCues.length,
      cues: actorCues.map((c) => ({
        id: c.id,
        time: c.time,
        seconds: Number.isFinite(c.seconds) ? c.seconds : null,
        areaId: c.areaId,
        areaName: (areaMap.get(c.areaId) || {}).name || '(已删除区域)',
        note: c.note || '',
      })),
      segments,
      violations,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    areaCount: areas.length,
    edgeCount: edges.length,
    actorCount: actors.length,
    cueCount: cues.length,
    actors: resultActors,
    totals: { segments: totalSegments, violations: totalViolations, unreachable: totalUnreachable },
    ok: totalViolations === 0,
  };
}

module.exports = { parseTime, formatTime, formatDuration, buildAdjacency, dijkstra, evaluate };
