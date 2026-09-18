// 舞台区域连接图的最短通行耗时计算（Dijkstra）

function buildAdjacency(edges) {
  const adj = new Map();
  const add = (from, to, seconds) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, seconds });
  };
  for (const e of edges) {
    if (e.a === e.b) continue;
    // 无向边：两个方向耗时相同
    add(e.a, e.b, e.seconds);
    add(e.b, e.a, e.seconds);
  }
  return adj;
}

/**
 * 计算两区域间的最短通行耗时。
 * @returns {{seconds: number, path: string[]} | null} 不可达时返回 null
 */
function shortestPath(edges, fromId, toId) {
  if (fromId === toId) return { seconds: 0, path: [fromId] };

  const adj = buildAdjacency(edges);
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const queue = [{ id: fromId, d: 0 }];

  while (queue.length > 0) {
    // 图规模小，直接线性取最小值
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].d < queue[bestIdx].d) bestIdx = i;
    }
    const { id, d } = queue.splice(bestIdx, 1)[0];
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === toId) break;

    for (const { to, seconds } of adj.get(id) || []) {
      const nd = d + seconds;
      if (nd < (dist.has(to) ? dist.get(to) : Infinity)) {
        dist.set(to, nd);
        prev.set(to, id);
        queue.push({ id: to, d: nd });
      }
    }
  }

  if (!dist.has(toId)) return null;

  const path = [];
  let cur = toId;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return { seconds: dist.get(toId), path };
}

module.exports = { shortestPath };
