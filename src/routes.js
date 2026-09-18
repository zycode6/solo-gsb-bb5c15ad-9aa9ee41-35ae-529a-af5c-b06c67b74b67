const express = require('express');
const crypto = require('crypto');
const store = require('./store');
const { validate } = require('./validate');
const { toMarkdown } = require('./report');

const router = express.Router();

/* ---------- 入参校验 ---------- */

function isNonEmptyString(v, max = 60) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

const validators = {
  areas(body) {
    if (!isNonEmptyString(body.name, 30)) return '区域名称必填且不超过 30 字';
    if (body.description !== undefined && typeof body.description !== 'string') return '备注格式不正确';
    return null;
  },
  actors(body) {
    if (!isNonEmptyString(body.name, 30)) return '演员姓名必填且不超过 30 字';
    if (body.role !== undefined && typeof body.role !== 'string') return '角色格式不正确';
    return null;
  },
  edges(body, data) {
    const ids = new Set(data.areas.map((a) => a.id));
    if (!ids.has(body.a) || !ids.has(body.b)) return '连接两端必须是已存在的区域';
    if (body.a === body.b) return '连接两端不能是同一区域';
    if (!isNonNegativeInt(body.seconds)) return '通行耗时必须是不小于 0 的整数秒';
    return null;
  },
  cues(body, data) {
    if (!data.actors.some((a) => a.id === body.actorId)) return '必须选择已存在的演员';
    if (!data.areas.some((a) => a.id === body.areaId)) return '必须选择已存在的区域';
    if (!isNonNegativeInt(body.time)) return '时间必须是不小于 0 的整数秒';
    if (body.note !== undefined && typeof body.note !== 'string') return '口令说明格式不正确';
    return null;
  },
};

function sanitize(collection, body) {
  switch (collection) {
    case 'areas':
      return { name: body.name.trim(), description: (body.description || '').trim() };
    case 'actors':
      return { name: body.name.trim(), role: (body.role || '').trim() };
    case 'edges':
      return { a: body.a, b: body.b, seconds: body.seconds };
    case 'cues':
      return { actorId: body.actorId, areaId: body.areaId, time: body.time, note: (body.note || '').trim() };
    default:
      return {};
  }
}

/* ---------- 查询 ---------- */

router.get('/data', (req, res) => {
  res.json(store.load());
});

router.get('/validate', (req, res) => {
  res.json(validate(store.load()));
});

router.get('/report', (req, res) => {
  const md = toMarkdown(validate(store.load()));
  const filename = encodeURIComponent('舞台走位校验报告.md');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=report.md; filename*=UTF-8''${filename}`);
  res.send(md);
});

router.post('/reset', (req, res) => {
  store.reset();
  res.json(store.load());
});

/* ---------- 通用 CRUD ---------- */

const COLLECTIONS = ['areas', 'edges', 'actors', 'cues'];

router.post('/:collection', (req, res) => {
  const { collection } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(404).json({ error: '未知资源类型' });

  const data = store.load();
  const err = validators[collection](req.body || {}, data);
  if (err) return res.status(400).json({ error: err });

  const item = { id: crypto.randomUUID(), ...sanitize(collection, req.body) };

  if (collection === 'edges') {
    const dup = data.edges.some(
      (e) => (e.a === item.a && e.b === item.b) || (e.a === item.b && e.b === item.a)
    );
    if (dup) return res.status(409).json({ error: '两个区域之间已存在连接，可直接编辑耗时' });
  }

  data[collection].push(item);
  store.save();
  res.status(201).json(item);
});

router.put('/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(404).json({ error: '未知资源类型' });

  const data = store.load();
  const item = data[collection].find((x) => x.id === id);
  if (!item) return res.status(404).json({ error: '记录不存在' });

  const err = validators[collection](req.body || {}, data);
  if (err) return res.status(400).json({ error: err });

  Object.assign(item, sanitize(collection, req.body));

  if (collection === 'edges') {
    const dup = data.edges.some(
      (e) => e.id !== id && ((e.a === item.a && e.b === item.b) || (e.a === item.b && e.b === item.a))
    );
    if (dup) return res.status(409).json({ error: '两个区域之间已存在连接' });
  }

  store.save();
  res.json(item);
});

router.delete('/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(404).json({ error: '未知资源类型' });

  const data = store.load();
  const idx = data[collection].findIndex((x) => x.id === id);
  if (idx === -1) return res.status(404).json({ error: '记录不存在' });

  data[collection].splice(idx, 1);

  // 级联清理，保证校验数据一致
  if (collection === 'areas') {
    data.edges = data.edges.filter((e) => e.a !== id && e.b !== id);
    data.cues = data.cues.filter((c) => c.areaId !== id);
  } else if (collection === 'actors') {
    data.cues = data.cues.filter((c) => c.actorId !== id);
  }

  store.save();
  res.status(204).end();
});

module.exports = router;
