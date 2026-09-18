'use strict';

/* ================= 基础工具 ================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** 解析时间字符串为秒，非法返回 NaN（与服务端保持同规则） */
function parseTime(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const s = String(input).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':');
  if (parts.length < 1 || parts.length > 3) return NaN;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return NaN;
  let v = 0;
  for (const p of parts) v = v * 60 + Number(p);
  return v;
}

function hms(sec) {
  if (!Number.isFinite(sec)) return '--:--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  if (Number.isInteger(sec)) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${s.toFixed(1).padStart(4, '0')}`;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = isError ? 'toast error' : 'toast';
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ================= 状态与 API ================= */

let state = { areas: [], edges: [], actors: [], cues: [] };
let report = null;
let selectedSegment = null; // { actorId, index }
let saveTimer = null;
let recheckTimer = null;
let saving = false;

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

async function loadInitial() {
  state = await api('/api/state');
  report = await api('/api/check');
}

/**
 * 本地已经先改好 state，调用此函数：
 * 防抖保存 -> 保存成功后重算；编辑密集时只发一次 PUT。
 */
function schedulePersistAndRecheck() {
  setSaveStatus('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}

async function persist() {
  clearTimeout(recheckTimer);
  saving = true;
  try {
    const data = await api('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    state = data.state;
    setSaveStatus('saved');
    await refreshReport();
  } catch (err) {
    setSaveStatus('error');
    toast(err.message, true);
  } finally {
    saving = false;
  }
}

async function refreshReport() {
  report = await api('/api/check');
  renderResults();
  renderGraph(); // 路径高亮依赖校验结果
}

function setSaveStatus(kind) {
  const el = $('#save-status');
  if (kind === 'pending') { el.textContent = '● 编辑中，待保存…'; el.className = 'save-status'; }
  else if (kind === 'saved') { el.textContent = '✓ 已保存并完成校验'; el.className = 'save-status saved'; }
  else if (kind === 'error') { el.textContent = '✗ 保存失败'; el.className = 'save-status error'; }
}

/* ================= 标签页切换 =================

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
  });
});

/* ================= 区域 ================= */

function renderAreaOptions(sel, chosenId, placeholder) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    state.areas.map((a) => `<option value="${esc(a.id)}"${a.id === chosenId ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
}

function renderAreas() {
  const ul = $('#list-areas');
  if (!state.areas.length) {
    ul.innerHTML = '<li class="empty">还没有区域，先在上方添加一个吧。</li>';
  } else {
    ul.innerHTML = '';
    state.areas.forEach((area) => {
      const usedBy = state.cues.filter((c) => c.areaId === area.id).length;
      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = `
        <span class="grow">
          <span class="name" data-name>${esc(area.name)}</span>
          <span class="sub">${usedBy} 条口令 · (${Math.round(area.x)}, ${Math.round(area.y)})</span>
        </span>
        <button class="icon-btn" title="重命名" data-rename>✎</button>
        <button class="icon-btn" title="删除区域" data-del>🗑</button>`;
      li.querySelector('[data-rename]').addEventListener('click', () => renameArea(area.id));
      li.querySelector('[data-del]').addEventListener('click', () => deleteArea(area.id));
      ul.appendChild(li);
    });
  }
  // 同步连接表单下拉
  renderAreaOptions($('#form-edge').elements.from, '', '选择起点');
  renderAreaOptions($('#form-edge').elements.to, '', '选择终点');
  renderAreaOptions($('#form-cue').elements.areaId, '', '选择区域');
}

function renameArea(id) {
  const area = state.areas.find((a) => a.id === id);
  const name = prompt('区域名称：', area.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return toast('名称不能为空', true);
  area.name = trimmed.slice(0, 40);
  afterModelChange();
}

function deleteArea(id) {
  const used = state.cues.filter((c) => c.areaId === id).length;
  const msg = used
    ? `删除该区域将同时移除 ${used} 条相关口令和对应连接，确定吗？`
    : '确定删除该区域及其连接吗？';
  if (!confirm(msg)) return;
  state.areas = state.areas.filter((a) => a.id !== id);
  state.edges = state.edges.filter((e) => e.from !== id && e.to !== id);
  state.cues = state.cues.filter((c) => c.areaId !== id);
  afterModelChange();
}

$('#form-area').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const name = f.name.value.trim();
  if (!name) return;
  state.areas.push({
    id: uid('a'),
    name: name.slice(0, 40),
    // 随机但避开边缘的落位
    x: 100 + Math.random() * 600,
    y: 80 + Math.random() * 320,
  });
  ev.target.reset();
  afterModelChange();
});

/* ================= 连接 ================= */

function edgeText(e) {
  const a = state.areas.find((x) => x.id === e.from);
  const b = state.areas.find((x) => x.id === e.to);
  return `${a ? a.name : '?'} ${e.directed ? '→' : '↔'} ${b ? b.name : '?'}`;
}

function renderEdges() {
  const ul = $('#list-edges');
  if (!state.edges.length) {
    ul.innerHTML = '<li class="empty">还没有连接。连接定义两个区域之间的通行秒数。</li>';
    return;
  }
  ul.innerHTML = '';
  state.edges.forEach((e) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <div class="grow">
        <div class="name">${esc(edgeText(e))}</div>
        <div class="sub">
          <label>耗时 <input type="number" min="0" step="1" value="${Number(e.seconds)}" data-sec style="width:64px"> 秒</label>
          <label style="margin-left:8px"><input type="checkbox" data-dir ${e.directed ? 'checked' : ''}> 单向</label>
        </div>
      </div>
      <button class="icon-btn" title="删除连接" data-del>🗑</button>`;
    li.querySelector('[data-sec]').addEventListener('change', (ev2) => {
      const v = Number(ev2.target.value);
      if (!Number.isFinite(v) || v < 0) return toast('耗时需为非负数字', true);
      e.seconds = v;
      afterModelChange();
    });
    li.querySelector('[data-dir]').addEventListener('change', (ev2) => {
      e.directed = ev2.target.checked;
      afterModelChange();
    });
    li.querySelector('[data-del]').addEventListener('click', () => {
      if (!confirm('删除这条连接？')) return;
      state.edges = state.edges.filter((x) => x.id !== e.id);
      afterModelChange();
    });
    ul.appendChild(li);
  });
}

$('#form-edge').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  if (f.from.value === f.to.value) return toast('起点和终点不能相同', true);
  state.edges.push({
    id: uid('e'),
    from: f.from.value,
    to: f.to.value,
    seconds: Math.max(0, Number(f.seconds.value) || 0),
    directed: f.directed.checked,
  });
  afterModelChange();
});

/* ================= 演员 ================= */

function renderActors() {
  const ul = $('#list-actors');
  if (!state.actors.length) {
    ul.innerHTML = '<li class="empty">还没有演员。</li>';
  } else {
    ul.innerHTML = '';
    state.actors.forEach((p) => {
      const count = state.cues.filter((c) => c.actorId === p.id).length;
      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = `
        <span class="color-dot" style="background:${esc(p.color)}"></span>
        <span class="grow">
          <span class="name" data-name>${esc(p.name)}</span>
          <span class="sub">${count} 条口令</span>
        </span>
        <input type="color" value="${esc(p.color)}" data-color title="颜色" style="width:30px;height:26px;padding:0;border:none;background:none">
        <button class="icon-btn" title="重命名" data-rename>✎</button>
        <button class="icon-btn" title="删除演员" data-del>🗑</button>`;
      li.querySelector('[data-color]').addEventListener('input', (ev2) => {
        p.color = ev2.target.value;
        li.querySelector('.color-dot').style.background = p.color;
        afterModelChange();
      });
      li.querySelector('[data-rename]').addEventListener('click', () => {
        const name = prompt('演员名称：', p.name);
        if (name && name.trim()) { p.name = name.trim().slice(0, 40); afterModelChange(); }
      });
      li.querySelector('[data-del]').addEventListener('click', () => {
        const n = state.cues.filter((c) => c.actorId === p.id).length;
        if (!confirm(`删除演员将同时删除其 ${n} 条口令，确定吗？`)) return;
        state.actors = state.actors.filter((x) => x.id !== p.id);
        state.cues = state.cues.filter((c) => c.actorId !== p.id);
        afterModelChange();
      });
      ul.appendChild(li);
    });
  }
  renderActorOptions();
}

function renderActorOptions() {
  const sel = $('#form-cue').elements.actorId;
  sel.innerHTML = '<option value="">选择演员</option>' +
    state.actors.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
}

$('#form-actor').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const name = f.name.value.trim();
  if (!name) return;
  state.actors.push({ id: uid('p'), name: name.slice(0, 40), color: f.color.value });
  ev.target.reset();
  f.color.value = '#6366f1';
  afterModelChange();
});

/* ================= 口令 ================= */

function cueTimeValue(c) {
  const v = parseTime(c.time);
  return Number.isFinite(v) ? v : Infinity;
}

/** 供列表展示：按演员分组、时间排序 */
function sortedCues() {
  return [...state.cues].sort(
    (a, b) => cueTimeValue(a) - cueTimeValue(b) || a.actorId.localeCompare(b.actorId) || String(a.id).localeCompare(String(b.id))
  );
}

function renderCues() {
  const ul = $('#list-cues');
  if (!state.cues.length) {
    ul.innerHTML = '<li class="empty">还没有到位口令。</li>';
    return;
  }
  const areaName = new Map(state.areas.map((a) => [a.id, a.name]));
  const actorName = new Map(state.actors.map((p) => [p.id, p]));
  ul.innerHTML = '';
  sortedCues().forEach((c) => {
    const actor = actorName.get(c.actorId);
    const timeOk = Number.isFinite(parseTime(c.time));
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <span class="color-dot" style="background:${esc(actor ? actor.color : '#999')}"></span>
      <div class="grow">
        <div class="name">${esc(actor ? actor.name : '?')} · ${esc(c.time)} <span style="color:${timeOk ? '#16a34a' : '#dc2626'}">${timeOk ? '' : '(时间格式有误)'}</span></div>
        <div class="sub">
          <select data-area style="margin-top:3px">
            ${state.areas.map((a) => `<option value="${esc(a.id)}"${a.id === c.areaId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
          <input value="${esc(c.note)}" data-note placeholder="备注" style="margin-top:4px">
        </div>
      </div>
      <button class="icon-btn" title="删除口令" data-del>🗑</button>`;
    li.querySelector('[data-area]').addEventListener('change', (ev2) => {
      c.areaId = ev2.target.value;
      afterModelChange();
    });
    li.querySelector('[data-note]').addEventListener('change', (ev2) => {
      c.note = ev2.target.value.slice(0, 200);
      afterModelChange();
    });
    li.querySelector('[data-del]').addEventListener('click', () => {
      state.cues = state.cues.filter((x) => x.id !== c.id);
      afterModelChange();
    });
    ul.appendChild(li);
  });
}

$('#form-cue').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const time = f.time.value.trim();
  if (!Number.isFinite(parseTime(time))) return toast('时间格式无效：支持 HH:MM:SS、MM:SS 或纯秒数', true);
  state.cues.push({
    id: uid('c'),
    actorId: f.actorId.value,
    areaId: f.areaId.value,
    time,
    note: f.note.value.trim().slice(0, 200),
  });
  ev.target.reset();
  afterModelChange();
});

/* ================= SVG 连接图 ================= */

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = $('#stage-svg');

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** 当前高亮区段涉及的边 -> 状态映射 */
function highlightEdgeMap() {
  const map = new Map();
  if (selectedSegment && report) {
    const ar = report.actors.find((a) => a.actorId === selectedSegment.actorId);
    const seg = ar && ar.segments.find((s) => s.index === selectedSegment.index);
    if (seg) seg.pathEdgeIds.forEach((id) => map.set(id, seg.feasible ? 'ok' : 'bad'));
  }
  return map;
}

/** 计算边在节点边界上的起止点，避免箭头扎进圆里 */
function edgeEndpoints(from, to, directed) {
  const R = 26;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x1 = from.x + ux * (directed ? R : R);
  const y1 = from.y + uy * (directed ? R : R);
  const x2 = to.x - ux * R;
  const y2 = to.y - uy * R;
  return { x1, y1, x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

function renderGraph() {
  const gEdges = $('#g-edges');
  const gLabels = $('#g-edge-labels');
  const gAreas = $('#g-areas');
  gEdges.innerHTML = '';
  gLabels.innerHTML = '';
  gAreas.innerHTML = '';

  const areaById = new Map(state.areas.map((a) => [a.id, a]));
  const hl = highlightEdgeMap();

  state.edges.forEach((e) => {
    const from = areaById.get(e.from);
    const to = areaById.get(e.to);
    if (!from || !to) return;
    const { x1, y1, x2, y2, mx, my } = edgeEndpoints(from, to, e.directed);
    const hlState = hl.get(e.id);

    const line = svg('line', {
      x1, y1, x2, y2,
      class: `edge-line${e.directed ? ' directed' : ''}${hlState ? ` hl-${hlState}` : ''}`,
      'marker-end': e.directed ? `url(#arrow${hlState ? `-${hlState}` : ''})` : '',
      'data-edge-id': e.id,
    });
    line.addEventListener('click', () => {
      if (confirm('删除这条连接？')) {
        state.edges = state.edges.filter((x) => x.id !== e.id);
        afterModelChange();
      }
    });
    gEdges.appendChild(line);

    // 耗时标签（白底胶囊）
    const labelW = 34 + String(e.seconds).length * 7;
    const labelRect = svg('rect', {
      x: mx - labelW / 2, y: my - 10, width: labelW, height: 20, rx: 10,
      class: 'edge-label-bg', 'data-edge-id': e.id, 'data-w': labelW,
    });
    gLabels.appendChild(labelRect);
    const txt = svg('text', {
      x: mx, y: my + 0.5,
      class: `edge-label${hlState ? ` hl-${hlState}` : ''}`,
      'data-edge-id': e.id,
    });
    txt.textContent = `${e.seconds}s${e.directed ? ' →' : ''}`;
    gLabels.appendChild(txt);
  });

  // 每个区域上的演员口令小色点
  const cuesByArea = new Map();
  if (report) {
    for (const ar of report.actors) {
      for (const c of ar.cues) {
        if (!cuesByArea.has(c.areaId)) cuesByArea.set(c.areaId, []);
        cuesByArea.get(c.areaId).push({ color: ar.color, time: c.time });
      }
    }
  }

  state.areas.forEach((area) => {
    const g = svg('g', { class: 'area-node', transform: `translate(${area.x},${area.y})`, 'data-area-id': area.id });
    g.appendChild(svg('circle', { r: 26, class: 'area-circle' }));
    const name = svg('text', { y: 2, class: 'area-name' });
    name.textContent = area.name.length > 6 ? area.name.slice(0, 6) + '…' : area.name;
    g.appendChild(name);

    const badges = cuesByArea.get(area.id) || [];
    badges.slice(0, 6).forEach((b, i) => {
      const bx = -((badges.slice(0, 6).length - 1) * 9) / 2 + i * 9;
      const c = svg('circle', { cx: bx, cy: -38, r: 4.5, fill: b.color, stroke: '#fff', 'stroke-width': 1.2, class: 'area-cue-badges' });
      const t = svg('title', {});
      t.textContent = `${b.time}`;
      c.appendChild(t);
      g.appendChild(c);
    });

    const sub = svg('text', { y: 42, class: 'area-cues' });
    sub.textContent = badges.length ? `${badges.length} 次到位` : '';
    g.appendChild(sub);

    const title = svg('title', {});
    title.textContent = `${area.name}（拖动移动，双击改名）`;
    g.appendChild(title);

    g.addEventListener('dblclick', () => renameArea(area.id));
    bindDrag(g, area);
    gAreas.appendChild(g);
  });
}

/** 拖动区域节点：拖动过程中直接改坐标并重绘连线，松手后保存 */
function bindDrag(nodeEl, area) {
  let dragging = false;
  let startPt = null;
  let startXY = null;
  let moved = false;

  const toSvgPoint = (clientX, clientY) => {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svgEl.getScreenCTM().inverse());
  };

  nodeEl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    moved = false;
    startPt = toSvgPoint(ev.clientX, ev.clientY);
    startXY = { x: area.x, y: area.y };
    nodeEl.classList.add('dragging');
    nodeEl.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  nodeEl.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const p = toSvgPoint(ev.clientX, ev.clientY);
    const nx = Math.max(40, Math.min(760, startXY.x + (p.x - startPt.x)));
    const ny = Math.max(30, Math.min(450, startXY.y + (p.y - startPt.y)));
    if (Math.abs(nx - area.x) > 1 || Math.abs(ny - area.y) > 1) moved = true;
    area.x = nx;
    area.y = ny;
    nodeEl.setAttribute('transform', `translate(${nx},${ny})`);
    updateEdgeGeometryLive();
  });

  const finish = (ev) => {
    if (!dragging) return;
    dragging = false;
    nodeEl.classList.remove('dragging');
    try { nodeEl.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
    if (moved) schedulePersistAndRecheck(); // 坐标改变无需等防抖重绘，只做保存+校验
  };
  nodeEl.addEventListener('pointerup', finish);
  nodeEl.addEventListener('pointercancel', finish);
}

/** 拖动时实时更新连线与标签坐标（不重建 DOM） */
function updateEdgeGeometryLive() {
  const areaById = new Map(state.areas.map((a) => [a.id, a]));
  state.edges.forEach((e) => {
    const from = areaById.get(e.from);
    const to = areaById.get(e.to);
    if (!from || !to) return;
    const line = $(`.edge-line[data-edge-id="${CSS.escape(e.id)}"]`);
    if (!line) return;
    const { x1, y1, x2, y2, mx, my } = edgeEndpoints(from, to, e.directed);
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    const labelLayer = $('#g-edge-labels');
    const rect = labelLayer.querySelector(`rect[data-edge-id="${CSS.escape(e.id)}"]`);
    const text = labelLayer.querySelector(`text[data-edge-id="${CSS.escape(e.id)}"]`);
    // 首次 renderGraph 时标签未带 data-edge-id 时直接整体重绘
    if (!rect || !text) { renderGraph(); return; }
    rect.setAttribute('x', mx - parseFloat(rect.dataset.w) / 2);
    rect.setAttribute('y', my - 10);
    text.setAttribute('x', mx);
    text.setAttribute('y', my + 0.5);
  });
}

/* ================= 校验结果 ================= */

function renderResults() {
  if (!report) return;
  const t = report.totals;

  const summary = $('#summary');
  summary.innerHTML = `
    <div class="summary-card ${report.ok ? 'ok' : 'bad'}">
      <span class="big">${report.ok ? '✅ 全部走位均可按时抵达' : `❌ ${t.violations} 个区段无法按时抵达`}</span>
      ${report.ok
        ? `共校验 ${t.segments} 个相邻口令区段，全部满足最短通行耗时。`
        : `${t.violations} 个区段违规，其中 ${t.unreachable} 个区域间完全不连通；其余为时间窗口不足。`}
      <div class="summary-meta">
        ${report.areaCount} 区域 · ${report.edgeCount} 连接 · ${report.actorCount} 演员 · ${report.cueCount} 口令
        ｜最近校验 ${new Date(report.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
      </div>
    </div>`;

  const wrap = $('#actor-results');
  wrap.innerHTML = '';

  if (!report.actors.length) {
    wrap.innerHTML = '<p class="empty">添加演员和口令后，这里会出现按时间排列的校验结果。</p>';
    return;
  }

  report.actors.forEach((ar) => {
    const block = document.createElement('div');
    block.className = 'actor-block';

    const head = document.createElement('div');
    head.className = 'actor-head';
    head.innerHTML = `
      <span class="color-dot" style="background:${esc(ar.color)}"></span>
      <span>${esc(ar.actorName)}</span>
      <span class="badge ${ar.violations ? 'bad' : 'ok'}">${ar.violations ? `${ar.violations} 违规` : '通过'}</span>
      <span class="count">${ar.cueCount} 条口令 · ${ar.segments.length} 区段</span>`;
    block.appendChild(head);

    // 口令时间轴（可折叠）
    const cueBox = document.createElement('div');
    cueBox.hidden = true;
    if (!ar.cues.length) {
      cueBox.innerHTML = '<div class="cue-line" style="color:var(--muted)">暂无口令</div>';
    } else {
      ar.cues.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'cue-line';
        row.innerHTML = `
          <span class="t">${esc(c.time)}</span>
          <span class="n">${i + 1}. ${esc(c.areaName)}</span>
          <span class="note">${esc(c.note)}</span>`;
        cueBox.appendChild(row);
      });
    }
    block.appendChild(cueBox);

    const toggle = document.createElement('button');
    toggle.className = 'cues-toggle';
    toggle.textContent = cueBox.hidden ? '▸ 查看口令时间轴' : '▾ 收起口令时间轴';
    toggle.addEventListener('click', () => {
      cueBox.hidden = !cueBox.hidden;
      toggle.textContent = cueBox.hidden ? '▸ 查看口令时间轴' : '▾ 收起口令时间轴';
    });
    block.appendChild(toggle);

    // 区段
    ar.segments.forEach((s) => {
      const isSel = selectedSegment &&
        selectedSegment.actorId === ar.actorId && selectedSegment.index === s.index;
      const seg = document.createElement('div');
      seg.className = `segment ${s.feasible ? 'ok' : 'bad'}${isSel ? ' selected' : ''}`;
      const needTxt = s.kind === 'unreachable'
        ? '∞（不连通）'
        : s.requiredSeconds === null ? '—' : `${s.requiredSeconds} 秒`;
      const availTxt = s.availableSeconds === null ? '—' : `${s.availableSeconds} 秒`;
      const gap = s.reachable && s.availableSeconds !== null && s.requiredSeconds !== null
        ? s.requiredSeconds - s.availableSeconds : null;
      const kindTag = s.kind === 'unreachable'
        ? '<span class="badge bad">不连通</span>'
        : s.kind === 'shortfall'
          ? '<span class="badge bad">时间不足</span>'
          : s.kind === 'invalid'
            ? '<span class="badge bad">数据异常</span>'
            : '<span class="badge ok">可抵达</span>';
      seg.innerHTML = `
        <div class="seg-title">
          区段 ${s.index}：${esc(s.fromAreaName)} → ${esc(s.toAreaName)}
          ${kindTag}
          <span class="seg-window">${esc(s.fromTime)} → ${esc(s.toTime)}</span>
        </div>
        <div class="seg-metrics">
          <span class="${s.feasible ? '' : 'need-bad'}">所需最短：<b>${needTxt}</b></span>
          <span>可用：<b>${availTxt}</b></span>
          ${gap !== null && gap > 0 ? `<span style="color:var(--bad)">差 <b>${gap} 秒</b></span>` : ''}
          ${gap !== null && gap < 0 && s.fromAreaId !== s.toAreaId ? `<span style="color:var(--ok)">余 <b>${-gap} 秒</b></span>` : ''}
          ${gap === 0 ? '<span style="color:var(--ok)"><b>刚好抵达</b></span>' : ''}
        </div>
        <div class="seg-reason ${s.feasible ? 'ok' : 'bad'}">${s.feasible ? '✅' : '❌'} ${esc(s.reason)}</div>
        ${s.pathNodeIds.length > 1 ? `<div class="seg-path">路径：${s.pathNodeIds.map((id) => {
          const a = state.areas.find((x) => x.id === id);
          return esc(a ? a.name : '?');
        }).join(' → ')}</div>` : ''}`;
      seg.addEventListener('click', () => {
        if (isSel) {
          selectedSegment = null;
        } else {
          selectedSegment = { actorId: ar.actorId, index: s.index };
        }
        renderResults();
        renderGraph();
      });
      block.appendChild(seg);
    });

    if (!ar.segments.length) {
      const tip = document.createElement('div');
      tip.className = 'cue-line';
      tip.style.color = 'var(--muted)';
      tip.textContent = ar.cues.length ? '仅有 1 条口令，至少 2 条才能形成校验区段。' : '添加口令后自动校验。';
      block.appendChild(tip);
    }

    wrap.appendChild(block);
  });
}

/* ================= 统一重渲染 ================= */

function renderAll() {
  renderAreas();
  renderEdges();
  renderActors();
  renderCues();
  renderGraph();
  renderResults();
}

/** 建模数据变更后：立即重绘 UI，防抖保存并自动重算 */
function afterModelChange() {
  renderAll();
  schedulePersistAndRecheck();
}

/* ================= 顶栏操作 ================= */

$('#btn-recheck').addEventListener('click', async () => {
  clearTimeout(saveTimer);
  try {
    await persist();
    renderGraph();
    toast('已重新校验');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('将放弃当前全部编辑并恢复内置示例数据，确定吗？')) return;
  try {
    const data = await api('/api/reset', { method: 'POST' });
    state = data.state;
    selectedSegment = null;
    await refreshReport();
    renderAll();
    toast('已恢复示例数据');
  } catch (err) {
    toast(err.message, true);
  }
});

function downloadReport(format) {
  const a = document.createElement('a');
  a.href = `/api/report?format=${encodeURIComponent(format)}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
$('#btn-report-md').addEventListener('click', () => downloadReport('markdown'));
$('#btn-report-json').addEventListener('click', () => downloadReport('json'));

/* ================= 启动 ================= */

(async function init() {
  try {
    await loadInitial();
    renderAll();
    setSaveStatus('saved');
  } catch (err) {
    toast('初始化失败：' + err.message, true);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<p style="padding:40px;color:#dc2626">无法连接服务端 API：${esc(err.message)}</p>`
    );
  }
})();
