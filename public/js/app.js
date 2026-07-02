'use strict';

/* ======================= 定数 ======================= */
const STEP_STATUS = {
  not_started: { label: '未着手', color: '#64748b' },
  wip: { label: '作業中', color: '#38bdf8' },
  review: { label: '確認待ち', color: '#a855f7' },
  retake: { label: 'リテイク', color: '#f59e0b' },
  approved: { label: 'OK', color: '#22c55e' },
};
const REVIEW_STATUS = {
  pending: { label: 'チェック待ち', cls: 'pending' },
  approved: { label: 'OK', cls: 'approved' },
  retake: { label: 'リテイク', cls: 'retake' },
  rejected: { label: 'NG', cls: 'rejected' },
};

/* ======================= 状態 ======================= */
const state = {
  view: 'projects', // 'projects' | 'project'
  projectId: null,
  project: null,
  shots: [],
  templates: [],
  search: '',
  activeShotId: null,
  activeVersionId: null,
};

/* ======================= API ======================= */
const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
  async send(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
  post: (url, body) => api.send('POST', url, body),
  patch: (url, body) => api.send('PATCH', url, body),
  del: (url) => api.send('DELETE', url),
};

/* ======================= ユーティリティ ======================= */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const currentUser = () => ($('#currentUser').value || '').trim() || 'anonymous';

function toast(msg) {
  const t = el('div', 'toast', msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function shotOverallReview(shot) {
  // 最新バージョンのレビュー状態をショットの代表ステータスとする
  const v = shot.versions[shot.versions.length - 1];
  return v ? v.review.status : 'pending';
}

/* ======================= ルーティング ======================= */
async function go(view, projectId) {
  state.view = view;
  state.projectId = projectId || null;
  if (view === 'projects') {
    await loadProjects();
  } else if (view === 'project') {
    await loadProject(projectId);
  }
  render();
}

async function loadProjects() {
  state.projects = await api.get('/api/projects');
  state.templates = await api.get('/api/pipeline-templates');
}

async function loadProject(id) {
  state.project = await api.get(`/api/projects/${id}`);
  state.shots = await api.get(`/api/projects/${id}/shots`);
}

/* ======================= レンダリング ======================= */
function render() {
  renderBreadcrumb();
  const view = $('#view');
  view.innerHTML = '';
  if (state.view === 'projects') view.appendChild(renderProjects());
  else if (state.view === 'project') view.appendChild(renderProject());
}

function renderBreadcrumb() {
  const bc = $('#breadcrumb');
  bc.innerHTML = '';
  const home = el('a', null, 'プロジェクト');
  home.onclick = () => go('projects');
  bc.appendChild(home);
  if (state.view === 'project' && state.project) {
    bc.appendChild(el('span', 'sep', '/'));
    bc.appendChild(el('span', null, state.project.name));
  }
}

/* ---- プロジェクト一覧 ---- */
function renderProjects() {
  const wrap = el('div');
  const head = el('div', 'page-head');
  head.appendChild(el('h1', null, 'プロジェクト'));
  head.appendChild(el('div', 'spacer'));
  const add = el('button', 'btn', '+ 新規プロジェクト');
  add.onclick = openProjectModal;
  head.appendChild(add);
  wrap.appendChild(head);

  const list = state.projects || [];
  if (!list.length) {
    wrap.appendChild(el('div', 'empty', 'プロジェクトがまだありません。「新規プロジェクト」から作成してください。'));
    return wrap;
  }
  const grid = el('div', 'grid-projects');
  const tpl = $('#tpl-project-card');
  for (const p of list) {
    const node = tpl.content.cloneNode(true);
    $('.pc-name', node).textContent = p.name;
    $('.pc-desc', node).textContent = p.description || '';
    const steps = $('.pc-steps', node);
    for (const s of p.steps || []) {
      const chip = el('span', 'step-chip', s.name);
      chip.style.background = s.color;
      steps.appendChild(chip);
    }
    $('.pc-count', node).textContent = `${p.shotCount || 0} ショット`;
    const card = $('.project-card', node);
    card.onclick = () => go('project', p.id);
    grid.appendChild(node);
  }
  wrap.appendChild(grid);
  return wrap;
}

/* ---- プロジェクト詳細（ショットタイル一覧） ---- */
function renderProject() {
  const wrap = el('div');
  const p = state.project;

  const head = el('div', 'page-head');
  const title = el('div');
  title.appendChild(el('h1', null, p.name));
  if (p.description) title.appendChild(el('div', 'sub', p.description));
  head.appendChild(title);
  head.appendChild(el('div', 'spacer'));
  const editBtn = el('button', 'btn ghost', '工程設定');
  editBtn.onclick = () => openPipelineEditor();
  const add = el('button', 'btn', '+ ショット追加');
  add.onclick = openShotModal;
  head.appendChild(editBtn);
  head.appendChild(add);
  wrap.appendChild(head);

  // 工程の表示
  const stepsBar = el('div', 'toolbar');
  for (const s of p.steps || []) {
    const chip = el('span', 'step-chip', s.name);
    chip.style.background = s.color;
    stepsBar.appendChild(chip);
  }
  wrap.appendChild(stepsBar);

  // 検索
  const toolbar = el('div', 'toolbar');
  const search = el('input', 'search');
  search.placeholder = 'ショットを検索...';
  search.value = state.search;
  search.oninput = () => {
    state.search = search.value;
    renderShotGrid(gridHolder);
  };
  toolbar.appendChild(search);
  wrap.appendChild(toolbar);

  const gridHolder = el('div');
  wrap.appendChild(gridHolder);
  renderShotGrid(gridHolder);
  return wrap;
}

function renderShotGrid(holder) {
  holder.innerHTML = '';
  const p = state.project;
  const q = state.search.trim().toLowerCase();
  const shots = state.shots.filter((s) => !q || s.name.toLowerCase().includes(q));

  if (!shots.length) {
    holder.appendChild(el('div', 'empty', state.shots.length ? '該当するショットがありません。' : 'ショットがまだありません。「ショット追加」から作成してください。'));
    return;
  }

  const grid = el('div', 'grid-shots');
  const tpl = $('#tpl-shot-tile');
  for (const shot of shots) {
    const node = tpl.content.cloneNode(true);
    const thumb = $('.st-thumb', node);
    if (shot.thumbnail) {
      thumb.style.backgroundImage = `url("${shot.thumbnail}")`;
      const latest = shot.versions[shot.versions.length - 1];
      if (latest && latest.type === 'video') thumb.appendChild(el('span', 'play', '▶'));
    } else {
      thumb.textContent = 'メディア未登録';
    }
    $('.st-name', node).textContent = shot.name;

    const badge = $('.st-badge', node);
    const rs = REVIEW_STATUS[shotOverallReview(shot)];
    badge.className = 'st-badge badge ' + rs.cls;
    badge.textContent = rs.label;

    const stepsWrap = $('.st-steps', node);
    for (const step of p.steps || []) {
      const st = shot.stepStatuses[step.id] || 'not_started';
      const info = STEP_STATUS[st];
      const chip = el('span', 'st-step');
      const dot = el('span', 'dot');
      dot.style.background = info.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(step.name));
      chip.title = `${step.name}: ${info.label}`;
      stepsWrap.appendChild(chip);
    }

    $('.shot-tile', node).onclick = () => openShotDetail(shot.id);
    grid.appendChild(node);
  }
  holder.appendChild(grid);
}

/* ======================= モーダル基盤 ======================= */
function openModal(builder) {
  const body = $('#modalBody');
  body.innerHTML = '';
  builder(body);
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
}
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

function modalHeader(body, titleText) {
  const head = el('div', 'modal-head');
  head.appendChild(el('h2', null, titleText));
  const x = el('button', 'icon-btn', '×');
  x.onclick = closeModal;
  head.appendChild(x);
  body.appendChild(head);
  const inner = el('div', 'modal-body');
  body.appendChild(inner);
  return inner;
}

/* ======================= 新規プロジェクト ======================= */
function openProjectModal() {
  openModal((body) => {
    const inner = modalHeader(body, '新規プロジェクト');

    const nameRow = formRow('プロジェクト名', 'input');
    const descRow = formRow('説明', 'textarea');
    const tplRow = formRow('工程テンプレート（OGPipeline の工程設定を流用）', 'select');
    const sel = tplRow.field;
    sel.appendChild(new Option('（工程なしで作成）', ''));
    for (const t of state.templates) {
      sel.appendChild(new Option(`${t.name}（${t.steps.map((s) => s.name).join(' → ')}）`, t.id));
    }
    if (state.templates[0]) sel.value = state.templates[0].id;

    inner.appendChild(nameRow.row);
    inner.appendChild(descRow.row);
    inner.appendChild(tplRow.row);

    const actions = el('div', 'form-actions');
    const cancel = el('button', 'btn ghost', 'キャンセル');
    cancel.onclick = closeModal;
    const save = el('button', 'btn', '作成');
    save.onclick = async () => {
      if (!nameRow.field.value.trim()) return toast('プロジェクト名を入力してください');
      try {
        const created = await api.post('/api/projects', {
          name: nameRow.field.value.trim(),
          description: descRow.field.value.trim(),
          templateId: sel.value || undefined,
        });
        closeModal();
        await go('project', created.id);
      } catch (e) {
        toast('作成に失敗: ' + e.message);
      }
    };
    actions.appendChild(cancel);
    actions.appendChild(save);
    inner.appendChild(actions);
  });
}

/* ======================= 工程設定エディタ ======================= */
function openPipelineEditor() {
  openModal((body) => {
    const inner = modalHeader(body, '工程設定');
    inner.appendChild(el('p', 'sub', 'このプロジェクトの工程を編集します。テンプレートから流用した工程もここで調整できます。'));

    const listWrap = el('div', 'step-status-grid');
    let steps = (state.project.steps || []).map((s) => ({ ...s }));

    function redraw() {
      listWrap.innerHTML = '';
      steps.forEach((s, i) => {
        const row = el('div', 'step-status-row');
        const color = el('input');
        color.type = 'color';
        color.value = s.color;
        color.style.width = '38px';
        color.oninput = () => (s.color = color.value);
        const name = el('input');
        name.value = s.name;
        name.style.flex = '1';
        name.oninput = () => (s.name = name.value);
        const del = el('button', 'btn small danger', '削除');
        del.onclick = () => {
          steps.splice(i, 1);
          redraw();
        };
        row.appendChild(color);
        row.appendChild(name);
        row.appendChild(del);
        listWrap.appendChild(row);
      });
    }
    redraw();
    inner.appendChild(listWrap);

    const addStep = el('button', 'btn ghost small', '+ 工程を追加');
    addStep.onclick = () => {
      steps.push({ name: '新しい工程', color: '#38bdf8', order: steps.length + 1 });
      redraw();
    };
    inner.appendChild(addStep);

    const actions = el('div', 'form-actions');
    const cancel = el('button', 'btn ghost', 'キャンセル');
    cancel.onclick = closeModal;
    const save = el('button', 'btn', '保存');
    save.onclick = async () => {
      const payload = steps
        .filter((s) => s.name.trim())
        .map((s, i) => ({ id: s.id, name: s.name.trim(), color: s.color, order: i + 1 }));
      try {
        state.project = await api.patch(`/api/projects/${state.project.id}`, { steps: payload });
        state.shots = await api.get(`/api/projects/${state.project.id}/shots`);
        closeModal();
        render();
        toast('工程を保存しました');
      } catch (e) {
        toast('保存に失敗: ' + e.message);
      }
    };
    actions.appendChild(cancel);
    actions.appendChild(save);
    inner.appendChild(actions);
  });
}

/* ======================= 新規ショット ======================= */
function openShotModal() {
  openModal((body) => {
    const inner = modalHeader(body, 'ショット追加');
    const nameRow = formRow('ショット名（例: cut_010）', 'input');
    const descRow = formRow('説明', 'textarea');
    inner.appendChild(nameRow.row);
    inner.appendChild(descRow.row);

    const actions = el('div', 'form-actions');
    const cancel = el('button', 'btn ghost', 'キャンセル');
    cancel.onclick = closeModal;
    const save = el('button', 'btn', '追加');
    save.onclick = async () => {
      if (!nameRow.field.value.trim()) return toast('ショット名を入力してください');
      try {
        await api.post(`/api/projects/${state.project.id}/shots`, {
          name: nameRow.field.value.trim(),
          description: descRow.field.value.trim(),
        });
        state.shots = await api.get(`/api/projects/${state.project.id}/shots`);
        closeModal();
        render();
      } catch (e) {
        toast('追加に失敗: ' + e.message);
      }
    };
    actions.appendChild(cancel);
    actions.appendChild(save);
    inner.appendChild(actions);
  });
}

/* ======================= ショット詳細 / レビュー ======================= */
function openShotDetail(shotId) {
  state.activeShotId = shotId;
  const shot = state.shots.find((s) => s.id === shotId);
  state.activeVersionId = shot.versions.length ? shot.versions[shot.versions.length - 1].id : null;
  openModal((body) => renderShotDetail(body));
}

function refreshShotDetail() {
  const body = $('#modalBody');
  body.innerHTML = '';
  renderShotDetail(body);
}

function renderShotDetail(body) {
  const shot = state.shots.find((s) => s.id === state.activeShotId);
  const inner = modalHeader(body, shot.name);
  if (shot.description) inner.appendChild(el('p', 'sub', shot.description));

  /* --- メディアビューア --- */
  const version = shot.versions.find((v) => v.id === state.activeVersionId) || shot.versions[shot.versions.length - 1];
  const mediaBox = el('div', 'review-media');
  if (version) {
    if (version.type === 'video') {
      const v = el('video');
      v.src = version.file;
      v.controls = true;
      mediaBox.appendChild(v);
    } else {
      const img = el('img');
      img.src = version.file;
      mediaBox.appendChild(img);
    }
  } else {
    mediaBox.textContent = '';
    const ph = el('div', 'empty', 'メディアがまだアップロードされていません');
    inner.appendChild(ph);
  }
  if (version) inner.appendChild(mediaBox);

  /* --- バージョン一覧 --- */
  if (shot.versions.length) {
    const vlist = el('div', 'version-list');
    shot.versions.forEach((v) => {
      const chip = el('div', 'version-chip' + (v.id === (version && version.id) ? ' active' : ''));
      const dot = el('span', 'status-dot');
      dot.style.background = STEP_STATUS[reviewToStep(v.review.status)].color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(v.name));
      chip.onclick = () => {
        state.activeVersionId = v.id;
        refreshShotDetail();
      };
      vlist.appendChild(chip);
    });
    inner.appendChild(vlist);
  }

  /* --- ディレクターチェック --- */
  if (version) {
    inner.appendChild(el('div', 'section-title', 'ディレクターチェック'));
    const cur = REVIEW_STATUS[version.review.status];
    const statusLine = el('div');
    statusLine.style.marginBottom = '6px';
    const b = el('span', 'badge ' + cur.cls, cur.label);
    statusLine.appendChild(document.createTextNode('現在の判定: '));
    statusLine.appendChild(b);
    inner.appendChild(statusLine);

    const actions = el('div', 'review-actions');
    const mk = (label, cls, status) => {
      const btn = el('button', 'btn ' + cls, label);
      btn.onclick = () => setReview(version.id, status);
      return btn;
    };
    actions.appendChild(mk('OK（承認）', 'ok', 'approved'));
    actions.appendChild(mk('リテイク', 'retake', 'retake'));
    actions.appendChild(mk('NG', 'reject', 'rejected'));
    actions.appendChild(mk('保留', 'ghost', 'pending'));
    inner.appendChild(actions);

    /* --- コメント --- */
    inner.appendChild(el('div', 'section-title', 'コメント'));
    const notes = el('div', 'notes');
    if (!version.review.notes.length) {
      notes.appendChild(el('div', 'sub', 'コメントはまだありません。'));
    }
    for (const n of version.review.notes) {
      const note = el('div', 'note');
      note.appendChild(el('div', 'meta', `${n.author}・${formatTime(n.time)}`));
      note.appendChild(el('div', null, n.text));
      notes.appendChild(note);
    }
    const inputWrap = el('div', 'note-input');
    const input = el('input');
    input.placeholder = 'コメントを入力...';
    const sendBtn = el('button', 'btn', '送信');
    const send = async () => {
      if (!input.value.trim()) return;
      await addNote(version.id, input.value.trim());
      input.value = '';
    };
    sendBtn.onclick = send;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') send();
    };
    inputWrap.appendChild(input);
    inputWrap.appendChild(sendBtn);
    notes.appendChild(inputWrap);
    inner.appendChild(notes);
  }

  /* --- アップロード --- */
  inner.appendChild(el('div', 'section-title', 'バージョンをアップロード（動画・画像）'));
  const uploadRow = el('div');
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,video/*';
  const progress = el('div', 'uploading hidden');
  const bar = el('div', 'bar');
  const barI = el('i');
  bar.appendChild(barI);
  const pctText = el('span', null, '0%');
  progress.appendChild(bar);
  progress.appendChild(pctText);
  fileInput.onchange = () => {
    if (fileInput.files[0]) uploadVersion(shot.id, fileInput.files[0], { progress, barI, pctText });
  };
  uploadRow.appendChild(fileInput);
  uploadRow.appendChild(progress);
  inner.appendChild(uploadRow);

  /* --- 工程ステータス --- */
  inner.appendChild(el('div', 'section-title', '工程ステータス'));
  const grid = el('div', 'step-status-grid');
  for (const step of state.project.steps || []) {
    const row = el('div', 'step-status-row');
    const name = el('div', 'name');
    const dot = el('span', 'dot');
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + step.color;
    name.appendChild(dot);
    name.appendChild(document.createTextNode(step.name));
    const sel = el('select');
    for (const [key, info] of Object.entries(STEP_STATUS)) {
      sel.appendChild(new Option(info.label, key));
    }
    sel.value = shot.stepStatuses[step.id] || 'not_started';
    sel.onchange = () => setStepStatus(shot.id, step.id, sel.value);
    row.appendChild(name);
    row.appendChild(sel);
    grid.appendChild(row);
  }
  inner.appendChild(grid);

  /* --- 削除 --- */
  const footer = el('div', 'form-actions');
  const delBtn = el('button', 'btn ghost small', 'このショットを削除');
  delBtn.onclick = async () => {
    if (!confirm(`ショット「${shot.name}」を削除しますか？`)) return;
    await api.del(`/api/shots/${shot.id}`);
    state.shots = state.shots.filter((s) => s.id !== shot.id);
    closeModal();
    render();
  };
  footer.appendChild(delBtn);
  inner.appendChild(footer);
}

function reviewToStep(status) {
  return { approved: 'approved', retake: 'retake', rejected: 'retake', pending: 'review' }[status] || 'review';
}

/* ======================= アクション ======================= */
async function setReview(versionId, status) {
  const updated = await api.patch(`/api/versions/${versionId}/review`, { status });
  applyVersionUpdate(versionId, updated);
  refreshShotDetail();
  renderCurrentProjectGrid();
  toast('判定を更新しました: ' + REVIEW_STATUS[status].label);
}

async function addNote(versionId, text) {
  const updated = await api.patch(`/api/versions/${versionId}/review`, {
    note: { author: currentUser(), text },
  });
  applyVersionUpdate(versionId, updated);
  refreshShotDetail();
}

async function setStepStatus(shotId, stepId, value) {
  const updated = await api.patch(`/api/shots/${shotId}`, { stepStatuses: { [stepId]: value } });
  const idx = state.shots.findIndex((s) => s.id === shotId);
  if (idx !== -1) state.shots[idx] = updated;
  renderCurrentProjectGrid();
}

function applyVersionUpdate(versionId, updatedVersion) {
  for (const shot of state.shots) {
    const i = shot.versions.findIndex((v) => v.id === versionId);
    if (i !== -1) {
      shot.versions[i] = updatedVersion;
      return;
    }
  }
}

function uploadVersion(shotId, file, ui) {
  ui.progress.classList.remove('hidden');
  generateThumbnail(file)
    .then((thumbDataUrl) => {
      const form = new FormData();
      form.append('file', file);
      form.append('name', `v${(state.shots.find((s) => s.id === shotId).versions.length || 0) + 1}`);
      form.append('uploadedBy', currentUser());
      if (thumbDataUrl) form.append('thumbnail', thumbDataUrl);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/shots/${shotId}/versions`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          ui.barI.style.width = pct + '%';
          ui.pctText.textContent = pct + '%';
        }
      };
      xhr.onload = async () => {
        ui.progress.classList.add('hidden');
        if (xhr.status >= 200 && xhr.status < 300) {
          const created = JSON.parse(xhr.responseText);
          state.shots = await api.get(`/api/projects/${state.project.id}/shots`);
          state.activeVersionId = created.id;
          refreshShotDetail();
          renderCurrentProjectGrid();
          toast('アップロード完了');
        } else {
          let msg = xhr.statusText;
          try { msg = JSON.parse(xhr.responseText).error; } catch (_) {}
          toast('アップロード失敗: ' + msg);
        }
      };
      xhr.onerror = () => {
        ui.progress.classList.add('hidden');
        toast('アップロード中にエラーが発生しました');
      };
      xhr.send(form);
    })
    .catch(() => {
      ui.progress.classList.add('hidden');
      toast('サムネイル生成に失敗しました');
    });
}

/**
 * クライアント側でサムネイルを生成（動画は1秒地点のフレーム、画像は縮小）。
 * ffmpeg 等のサーバー依存を避けるため。
 */
function generateThumbnail(file) {
  return new Promise((resolve) => {
    const isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    const done = (canvas) => {
      URL.revokeObjectURL(url);
      resolve(canvas ? canvas.toDataURL('image/jpeg', 0.7) : null);
    };
    const drawToCanvas = (source, w, h) => {
      const maxW = 640;
      const scale = Math.min(1, maxW / w);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas;
    };
    if (isVideo) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = url;
      video.onloadeddata = () => {
        try { video.currentTime = Math.min(1, (video.duration || 2) / 2); } catch (_) {}
      };
      video.onseeked = () => {
        try { done(drawToCanvas(video, video.videoWidth, video.videoHeight)); }
        catch (_) { done(null); }
      };
      video.onerror = () => done(null);
    } else {
      const img = new Image();
      img.onload = () => done(drawToCanvas(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => done(null);
      img.src = url;
    }
  });
}

function renderCurrentProjectGrid() {
  if (state.view !== 'project') return;
  const holder = $('#view .grid-shots');
  if (holder && holder.parentElement) renderShotGrid(holder.parentElement);
}

/* ======================= フォーム部品 ======================= */
function formRow(label, type) {
  const row = el('div', 'form-row');
  row.appendChild(el('label', null, label));
  const field = type === 'textarea' ? el('textarea') : type === 'select' ? el('select') : el('input');
  row.appendChild(field);
  return { row, field };
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ======================= 起動 ======================= */
$('#brand').onclick = () => go('projects');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
go('projects').catch((e) => toast('読み込みに失敗: ' + e.message));
