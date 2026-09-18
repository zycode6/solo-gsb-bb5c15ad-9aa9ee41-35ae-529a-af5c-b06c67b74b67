/* 舞台走位校验系统 —— 前端逻辑（原生 JS） */

const state = {
  data: { areas: [], edges: [], actors: [], cues: [] },
  validation: null,
};

/* ---------- 工具 ---------- */

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtTime(sec) {
  const sign = sec < 0 ? '-' : '';
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 解析 "90" 或 "01:30" 形式的时间输入，返回秒数；非法返回 NaN */
function parseTime(str) {
  const s = String(str).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return NaN;
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `请求失败（${res.status}）`);
  }
  return res.status === 204 ? null : res.json();
}

function areaName(id) {
  const a = state.data.areas.find((x) => x.id === id);
  return a ? a.name : '（已删除）';
}

function actorName(id) {
  const a = state.data.actors.find((x) => x.id === id);
  return a ? a.name : '（已删除）';
}

/* ---------- 数据加载与渲染 ---------- */

async function refresh() {
  const [data, validation] = await Promise.all([api('/api/data'), api('/api/validate')]);
  state.data = data;
  state.validation = validation;
  renderAreas();
  renderEdges();
  renderActors();
  renderCues();
  renderValidation();
}

function renderAreas() {
  const tbody = $('areas-tbody');
  tbody.innerHTML = state.data.areas
    .map(
      (a) => `<tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.description || '')}</td>
        <td class="col-ops">
          <button class="btn btn-small" data-edit-area="${a.id}">编辑</button>
          <button class="btn btn-danger" data-del-area="${a.id}">删除</button>
        </td>
      </tr>`
    )
    .join('') || '<tr><td colspan="3" class="empty-hint">暂无区域</td></tr>';
}

function renderEdges() {
  const tbody = $('edges-tbody');
  tbody.innerHTML = state.data.edges
    .map(
      (e) => `<tr>
        <td>${escapeHtml(areaName(e.a))}</td>
        <td>${escapeHtml(areaName(e.b))}</td>
        <td>${e.seconds} 秒</td>
        <td class="col-ops">
          <button class="btn btn-small" data-edit-edge="${e.id}">编辑</button>
          <button class="btn btn-danger" data-del-edge="${e.id}">删除</button>
        </td>
      </tr>`
    )
    .join('') || '<tr><td colspan="4" class="empty-hint">暂无连接</td></tr>';
}

function renderActors() {
  const tbody = $('actors-tbody');
  tbody.innerHTML = state.data.actors
    .map(
      (a) => `<tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.role || '')}</td>
        <td class="col-ops">
          <button class="btn btn-small" data-edit-actor="${a.id}">编辑</button>
          <button class="btn btn-danger" data-del-actor="${a.id}">删除</button>
        </td>
      </tr>`
    )
    .join('') || '<tr><td colspan="3" class="empty-hint">暂无演员</td></tr>';
}

function renderCues() {
  const tbody = $('cues-tbody');
  const sorted = state.data.cues
    .slice()
    .sort((x, y) => actorName(x.actorId).localeCompare(actorName(y.actorId), 'zh') || x.time - y.time);
  tbody.innerHTML = sorted
    .map(
      (c) => `<tr>
        <td>${escapeHtml(actorName(c.actorId))}</td>
        <td>${fmtTime(c.time)}</td>
        <td>${escapeHtml(areaName(c.areaId))}</td>
        <td>${escapeHtml(c.note || '')}</td>
        <td class="col-ops">
          <button class="btn btn-small" data-edit-cue="${c.id}">编辑</button>
          <button class="btn btn-danger" data-del-cue="${c.id}">删除</button>
        </td>
      </tr>`
    )
    .join('') || '<tr><td colspan="5" class="empty-hint">暂无口令</td></tr>';
}

const STATUS_LABEL = { ok: '✅ 可达', fail: '❌ 超时', unreachable: '⛔ 不可达' };

function renderValidation() {
  const v = state.validation;
  if (!v) return;
  const s = v.summary;

  $('summary').innerHTML = `
    <div class="badge"><span class="num">${s.actors}</span><span class="label">演员</span></div>
    <div class="badge"><span class="num">${s.segments}</span><span class="label">校验区段</span></div>
    <div class="badge ok"><span class="num">${s.ok}</span><span class="label">按时可达</span></div>
    <div class="badge fail"><span class="num">${s.failed}</span><span class="label">无法按时抵达</span></div>
    <div class="badge warn"><span class="num">${s.unreachable}</span><span class="label">区域不可达</span></div>
  `;

  const container = $('validation-results');
  if (v.actors.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无演员，请先添加演员与到位口令。</p>';
    return;
  }

  container.innerHTML = v.actors
    .map((actor) => {
      if (actor.segments.length === 0) {
        return `<div class="actor-block">
          <h3>${escapeHtml(actor.actorName)} <span class="cue-count">（${actor.cueCount} 条口令，不足两条，无需校验）</span></h3>
        </div>`;
      }
      const rows = actor.segments
        .map((seg) => {
          let timeCell;
          if (seg.status === 'unreachable') {
            timeCell = `<span class="time-detail">可用 ${seg.availableSeconds} 秒</span>
                        <span class="time-detail"><strong>两区域间无连通路径</strong></span>`;
          } else if (seg.status === 'fail') {
            timeCell = `<span class="time-detail">所需 <strong>${seg.requiredSeconds} 秒</strong> / 可用 ${seg.availableSeconds} 秒</span>
                        <span class="time-detail"><strong>缺口 ${-seg.slackSeconds} 秒</strong></span>`;
          } else {
            timeCell = `<span class="time-detail">所需 ${seg.requiredSeconds} 秒 / 可用 ${seg.availableSeconds} 秒</span>
                        <span class="time-detail">余量 ${seg.slackSeconds} 秒</span>`;
          }
          const route = seg.path.length > 0 ? escapeHtml(seg.path.join(' → ')) : '—';
          return `<tr class="seg-${seg.status}">
            <td>${seg.index}</td>
            <td>${escapeHtml(seg.from.areaName)}<span class="time-detail">${fmtTime(seg.from.time)}${seg.from.note ? ' · ' + escapeHtml(seg.from.note) : ''}</span></td>
            <td>${escapeHtml(seg.to.areaName)}<span class="time-detail">${fmtTime(seg.to.time)}${seg.to.note ? ' · ' + escapeHtml(seg.to.note) : ''}</span></td>
            <td>${timeCell}</td>
            <td class="route">${route}</td>
            <td><span class="status-pill ${seg.status}">${STATUS_LABEL[seg.status]}</span></td>
          </tr>`;
        })
        .join('');
      return `<div class="actor-block">
        <h3>${escapeHtml(actor.actorName)} <span class="cue-count">（${actor.cueCount} 条口令 / ${actor.segments.length} 个区段）</span></h3>
        <table>
          <thead><tr><th>#</th><th>起点</th><th>终点</th><th>耗时校验</th><th>最短路线</th><th>结论</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join('');
}

/* ---------- 下拉框选项 ---------- */

function fillSelect(el, items, placeholder) {
  const current = el.value;
  el.innerHTML =
    `<option value="" disabled selected>${placeholder}</option>` +
    items.map((it) => `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join('');
  if (items.some((it) => it.id === current)) el.value = current;
}

function refreshSelects() {
  fillSelect($('edge-a'), state.data.areas, '选择区域 A');
  fillSelect($('edge-b'), state.data.areas, '选择区域 B');
  fillSelect($('cue-actor'), state.data.actors, '选择演员');
  fillSelect($('cue-area'), state.data.areas, '选择目标区域');
}

/* ---------- 编辑模式 ---------- */

function setEditing(prefix, submitBtn, cancelBtn, isEditing, addText, updateText) {
  $(submitBtn).textContent = isEditing ? updateText : addText;
  $(cancelBtn).classList.toggle('hidden', !isEditing);
  if (!isEditing) $(prefix).value = '';
}

function clearAreaForm() {
  $('form-area').reset();
  setEditing('area-id', 'area-submit', 'area-cancel', false, '添加区域', '保存修改');
}
function clearEdgeForm() {
  $('form-edge').reset();
  setEditing('edge-id', 'edge-submit', 'edge-cancel', false, '添加连接', '保存修改');
}
function clearActorForm() {
  $('form-actor').reset();
  setEditing('actor-id', 'actor-submit', 'actor-cancel', false, '添加演员', '保存修改');
}
function clearCueForm() {
  $('form-cue').reset();
  setEditing('cue-id', 'cue-submit', 'cue-cancel', false, '添加口令', '保存修改');
}

/* ---------- 提交与变更 ---------- */

async function mutate(fn, successMsg) {
  try {
    await fn();
    await refresh();
    refreshSelects();
    if (successMsg) toast(successMsg);
  } catch (err) {
    toast(err.message, true);
  }
}

function bindForms() {
  $('form-area').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('area-id').value;
    const body = { name: $('area-name').value.trim(), description: $('area-desc').value.trim() };
    mutate(async () => {
      if (id) await api(`/api/areas/${id}`, 'PUT', body);
      else await api('/api/areas', 'POST', body);
      clearAreaForm();
    }, id ? '区域已更新' : '区域已添加');
  });

  $('form-edge').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('edge-id').value;
    const body = { a: $('edge-a').value, b: $('edge-b').value, seconds: Number($('edge-seconds').value) };
    mutate(async () => {
      if (id) await api(`/api/edges/${id}`, 'PUT', body);
      else await api('/api/edges', 'POST', body);
      clearEdgeForm();
    }, id ? '连接已更新' : '连接已添加');
  });

  $('form-actor').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('actor-id').value;
    const body = { name: $('actor-name').value.trim(), role: $('actor-role').value.trim() };
    mutate(async () => {
      if (id) await api(`/api/actors/${id}`, 'PUT', body);
      else await api('/api/actors', 'POST', body);
      clearActorForm();
    }, id ? '演员已更新' : '演员已添加');
  });

  $('form-cue').addEventListener('submit', (e) => {
    e.preventDefault();
    const time = parseTime($('cue-time').value);
    if (Number.isNaN(time)) {
      toast('时间格式不正确，请输入秒数（如 90）或 mm:ss（如 01:30）', true);
      return;
    }
    const id = $('cue-id').value;
    const body = { actorId: $('cue-actor').value, areaId: $('cue-area').value, time, note: $('cue-note').value.trim() };
    mutate(async () => {
      if (id) await api(`/api/cues/${id}`, 'PUT', body);
      else await api('/api/cues', 'POST', body);
      clearCueForm();
    }, id ? '口令已更新' : '口令已添加');
  });

  $('area-cancel').addEventListener('click', clearAreaForm);
  $('edge-cancel').addEventListener('click', clearEdgeForm);
  $('actor-cancel').addEventListener('click', clearActorForm);
  $('cue-cancel').addEventListener('click', clearCueForm);
}

function bindTableActions() {
  document.body.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const d = t.dataset;
    if (d.editArea) {
      const a = state.data.areas.find((x) => x.id === d.editArea);
      if (!a) return;
      $('area-id').value = a.id;
      $('area-name').value = a.name;
      $('area-desc').value = a.description || '';
      setEditing('area-id', 'area-submit', 'area-cancel', true, '添加区域', '保存修改');
      $('area-name').focus();
    } else if (d.delArea) {
      if (!confirm('删除该区域将同时删除相关连接与口令，确定？')) return;
      mutate(() => api(`/api/areas/${d.delArea}`, 'DELETE'), '区域已删除');
    } else if (d.editEdge) {
      const ed = state.data.edges.find((x) => x.id === d.editEdge);
      if (!ed) return;
      $('edge-id').value = ed.id;
      $('edge-a').value = ed.a;
      $('edge-b').value = ed.b;
      $('edge-seconds').value = ed.seconds;
      setEditing('edge-id', 'edge-submit', 'edge-cancel', true, '添加连接', '保存修改');
    } else if (d.delEdge) {
      mutate(() => api(`/api/edges/${d.delEdge}`, 'DELETE'), '连接已删除');
    } else if (d.editActor) {
      const a = state.data.actors.find((x) => x.id === d.editActor);
      if (!a) return;
      $('actor-id').value = a.id;
      $('actor-name').value = a.name;
      $('actor-role').value = a.role || '';
      setEditing('actor-id', 'actor-submit', 'actor-cancel', true, '添加演员', '保存修改');
      $('actor-name').focus();
    } else if (d.delActor) {
      if (!confirm('删除该演员将同时删除其全部口令，确定？')) return;
      mutate(() => api(`/api/actors/${d.delActor}`, 'DELETE'), '演员已删除');
    } else if (d.editCue) {
      const c = state.data.cues.find((x) => x.id === d.editCue);
      if (!c) return;
      $('cue-id').value = c.id;
      $('cue-actor').value = c.actorId;
      $('cue-area').value = c.areaId;
      $('cue-time').value = fmtTime(c.time);
      $('cue-note').value = c.note || '';
      setEditing('cue-id', 'cue-submit', 'cue-cancel', true, '添加口令', '保存修改');
    } else if (d.delCue) {
      mutate(() => api(`/api/cues/${d.delCue}`, 'DELETE'), '口令已删除');
    }
  });
}

function bindHeaderActions() {
  $('btn-refresh').addEventListener('click', () =>
    mutate(async () => {}, '已重新校验')
  );
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('将丢弃当前全部修改并恢复为示例数据，确定？')) return;
    mutate(async () => {
      await api('/api/reset', 'POST');
      clearAreaForm();
      clearEdgeForm();
      clearActorForm();
      clearCueForm();
    }, '已恢复示例数据');
  });
}

/* ---------- 启动 ---------- */

(async function init() {
  bindForms();
  bindTableActions();
  bindHeaderActions();
  try {
    await refresh();
    refreshSelects();
  } catch (err) {
    toast('初始化失败：' + err.message, true);
  }
})();
