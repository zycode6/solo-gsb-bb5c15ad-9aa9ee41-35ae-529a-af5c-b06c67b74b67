'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const { evaluate } = require('./lib/checker');
const { toMarkdown, stamp } = require('./lib/report');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SAMPLE_FILE = path.join(DATA_DIR, 'sample-state.json');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- 数据存取与规范化 ---------- */

function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const ACTOR_COLORS = ['#6366f1', '#ec4899', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6'];

/** 规整并校验客户端提交的数据；非法时抛 Error(中文提示) */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('请求体必须是 JSON 对象');
  const pick = (x) => (x && typeof x === 'object' ? x : {});
  const areas = Array.isArray(raw.areas) ? raw.areas : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const actors = Array.isArray(raw.actors) ? raw.actors : [];
  const cues = Array.isArray(raw.cues) ? raw.cues : [];

  const state = { areas: [], edges: [], actors: [], cues: [] };

  for (const a0 of areas.map(pick)) {
    const id = String(a0.id || uid('a'));
    if (state.areas.some((a) => a.id === id)) throw new Error(`区域 id 重复：${id}`);
    const x = Number(a0.x);
    const y = Number(a0.y);
    state.areas.push({
      id,
      name: String(a0.name || '未命名区域').slice(0, 40),
      x: Number.isFinite(x) ? x : 400,
      y: Number.isFinite(y) ? y : 240,
    });
  }

  const areaIds = new Set(state.areas.map((a) => a.id));
  for (const e0 of edges.map(pick)) {
    const from = String(e0.from || '');
    const to = String(e0.to || '');
    if (!areaIds.has(from) || !areaIds.has(to)) continue; // 丢弃悬空连接
    if (from === to) continue;
    const seconds = Number(e0.seconds);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('存在无效的通行耗时（需为非负数字）');
    state.edges.push({
      id: String(e0.id || uid('e')),
      from,
      to,
      seconds,
      directed: Boolean(e0.directed),
    });
  }

  const actorIds = new Set();
  actors.forEach((p0raw, i) => {
    const p0 = pick(p0raw);
    const id = String(p0.id || uid('p'));
    if (actorIds.has(id)) throw new Error(`演员 id 重复：${id}`);
    actorIds.add(id);
    state.actors.push({
      id,
      name: String(p0.name || `演员${i + 1}`).slice(0, 40),
      color: /^#[0-9a-fA-F]{6}$/.test(p0.color || '') ? p0.color : ACTOR_COLORS[i % ACTOR_COLORS.length],
    });
  });

  for (const c0raw of cues) {
    const c0 = pick(c0raw);
    const actorId = String(c0.actorId || '');
    const areaId = String(c0.areaId || '');
    if (!actorIds.has(actorId) || !areaIds.has(areaId)) continue; // 丢弃悬空口令
    state.cues.push({
      id: String(c0.id || uid('c')),
      actorId,
      areaId,
      time: String(c0.time || '00:00:00').slice(0, 20),
      note: String(c0.note || '').slice(0, 200),
    });
  }
  return state;
}

function loadState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch (err) {
    // 状态缺失或损坏时回退到随容器分发的示例数据
    const sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
    saveState(sample);
    return normalizeState(sample);
  }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

let state = loadState();

/* ---------- REST API ---------- */

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 读取当前数据
app.get('/api/state', (_req, res) => res.json(state));

// 整体保存（编辑后即时调用）
app.put('/api/state', (req, res) => {
  try {
    state = normalizeState(req.body);
    saveState(state);
    res.json({ ok: true, state });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 实时校验
app.get('/api/check', (_req, res) => {
  res.json(evaluate(state));
});

// 恢复出厂示例数据
app.post('/api/reset', (_req, res) => {
  const sample = normalizeState(JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')));
  state = sample;
  saveState(state);
  res.json({ ok: true, state });
});

// 导出校验报告：?format=markdown（默认）或 json
app.get('/api/report', (req, res) => {
  const report = evaluate(state);
  const format = String(req.query.format || 'markdown').toLowerCase();
  const name = `stage-walk-report-${stamp()}`;
  if (format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify({ state, report }, null, 2));
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.md"`);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(toMarkdown(state, report));
  }
});

// 兜底：非 API 路由返回单页应用
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`[stage-walk-check] 舞台走位校验应用已启动: http://localhost:${PORT}`);
  console.log(`[stage-walk-check] 数据文件: ${STATE_FILE}`);
});
