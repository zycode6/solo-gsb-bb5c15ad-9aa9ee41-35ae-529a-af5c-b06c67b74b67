const { shortestPath } = require('./graph');

/**
 * 走位校验：
 * 对每位演员，将其到位口令按时间升序排列，
 * 计算相邻两条口令之间“图上最短通行耗时”与“可用时间（时间差）”，
 * 所需 > 可用 标记为 fail，图上不可达标记为 unreachable。
 */
function validate(data) {
  const areaName = new Map(data.areas.map((a) => [a.id, a.name]));
  const actors = [];
  let ok = 0;
  let failed = 0;
  let unreachable = 0;

  for (const actor of data.actors) {
    const cues = data.cues
      .filter((c) => c.actorId === actor.id && areaName.has(c.areaId))
      .slice()
      .sort((x, y) => x.time - y.time);

    const segments = [];
    for (let i = 0; i + 1 < cues.length; i++) {
      const from = cues[i];
      const to = cues[i + 1];
      const available = to.time - from.time;
      const sp = shortestPath(data.edges, from.areaId, to.areaId);

      let status;
      let required = null;
      let slack = null;
      let routePath = [];

      if (!sp) {
        status = 'unreachable';
        unreachable++;
      } else {
        required = sp.seconds;
        slack = available - required;
        routePath = sp.path.map((id) => areaName.get(id) || id);
        if (required <= available) {
          status = 'ok';
          ok++;
        } else {
          status = 'fail';
          failed++;
        }
      }

      segments.push({
        index: i + 1,
        from: { time: from.time, areaName: areaName.get(from.areaId), note: from.note || '' },
        to: { time: to.time, areaName: areaName.get(to.areaId), note: to.note || '' },
        availableSeconds: available,
        requiredSeconds: required,
        slackSeconds: slack,
        path: routePath,
        status,
      });
    }

    actors.push({
      actorId: actor.id,
      actorName: actor.name,
      cueCount: cues.length,
      segments,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      actors: data.actors.length,
      segments: ok + failed + unreachable,
      ok,
      failed,
      unreachable,
    },
    actors,
  };
}

module.exports = { validate };
