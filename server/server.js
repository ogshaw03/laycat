'use strict';

/**
 * Layna - サーバー本体
 * ブラウザからプロジェクト／ショット／工程を管理し、動画・画像をローカルフォルダへ格納する。
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const store = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

// このツール用のローカル格納先
const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const MEDIA_DIR = path.join(STORAGE_DIR, 'media');
const THUMB_DIR = path.join(STORAGE_DIR, 'thumbnails');
for (const dir of [MEDIA_DIR, THUMB_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

store.load();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// アップロード済みメディアの配信
app.use('/media', express.static(MEDIA_DIR));
app.use('/thumbnails', express.static(THUMB_DIR));

// ---- アップロード設定（動画・画像をローカルフォルダに保存） ----
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${store.newId('media')}${ext}`);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    if ([...IMAGE_TYPES, ...VIDEO_TYPES].includes(file.mimetype)) return cb(null, true);
    cb(new Error(`未対応のファイル形式です: ${file.mimetype}`));
  },
});

// ============================================================
// 工程テンプレート（OGPipeline の工程設定を流用）
// ============================================================
app.get('/api/pipeline-templates', (req, res) => {
  res.json(store.get().pipelineTemplates);
});

app.post('/api/pipeline-templates', (req, res) => {
  const { name, description, steps } = req.body || {};
  if (!name || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'name と steps は必須です' });
  }
  const tpl = {
    id: store.newId('tpl'),
    name,
    description: description || '',
    steps: steps.map((s, i) => ({
      id: s.id || store.newId('step'),
      name: s.name,
      color: s.color || '#38bdf8',
      order: s.order != null ? s.order : i + 1,
    })),
  };
  store.get().pipelineTemplates.push(tpl);
  store.persist();
  res.status(201).json(tpl);
});

// ============================================================
// プロジェクト
// ============================================================
app.get('/api/projects', (req, res) => {
  const db = store.get();
  const list = db.projects.map((p) => ({
    ...p,
    shotCount: db.shots.filter((s) => s.projectId === p.id).length,
  }));
  res.json(list);
});

app.post('/api/projects', (req, res) => {
  const { name, description, templateId, steps } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name は必須です' });

  let projectSteps = [];
  if (templateId) {
    const tpl = store.get().pipelineTemplates.find((t) => t.id === templateId);
    if (!tpl) return res.status(400).json({ error: '指定された工程テンプレートが見つかりません' });
    // テンプレートの工程を「流用」（複製）してプロジェクトに持たせる
    projectSteps = tpl.steps.map((s) => ({ ...s }));
  } else if (Array.isArray(steps)) {
    projectSteps = steps.map((s, i) => ({
      id: s.id || store.newId('step'),
      name: s.name,
      color: s.color || '#38bdf8',
      order: s.order != null ? s.order : i + 1,
    }));
  }

  const project = {
    id: store.newId('prj'),
    name,
    description: description || '',
    steps: projectSteps.sort((a, b) => a.order - b.order),
    createdAt: nowIso(),
  };
  store.get().projects.push(project);
  store.persist();
  res.status(201).json(project);
});

app.get('/api/projects/:id', (req, res) => {
  const project = store.get().projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'プロジェクトが見つかりません' });
  res.json(project);
});

app.patch('/api/projects/:id', (req, res) => {
  const project = store.get().projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'プロジェクトが見つかりません' });
  const { name, description, steps } = req.body || {};
  if (name != null) project.name = name;
  if (description != null) project.description = description;
  if (Array.isArray(steps)) {
    project.steps = steps
      .map((s, i) => ({
        id: s.id || store.newId('step'),
        name: s.name,
        color: s.color || '#38bdf8',
        order: s.order != null ? s.order : i + 1,
      }))
      .sort((a, b) => a.order - b.order);
  }
  store.persist();
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  const db = store.get();
  const idx = db.projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'プロジェクトが見つかりません' });
  db.projects.splice(idx, 1);
  // 紐づくショットとメディアも削除
  const removed = db.shots.filter((s) => s.projectId === req.params.id);
  db.shots = db.shots.filter((s) => s.projectId !== req.params.id);
  for (const shot of removed) removeShotFiles(shot);
  store.persist();
  res.status(204).end();
});

// ============================================================
// ショット
// ============================================================
app.get('/api/projects/:id/shots', (req, res) => {
  const shots = store.get().shots.filter((s) => s.projectId === req.params.id);
  res.json(shots);
});

app.post('/api/projects/:id/shots', (req, res) => {
  const project = store.get().projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'プロジェクトが見つかりません' });
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name は必須です' });

  const stepStatuses = {};
  for (const step of project.steps) stepStatuses[step.id] = 'not_started';

  const shot = {
    id: store.newId('shot'),
    projectId: project.id,
    name,
    description: description || '',
    thumbnail: null,
    stepStatuses,
    versions: [],
    createdAt: nowIso(),
  };
  store.get().shots.push(shot);
  store.persist();
  res.status(201).json(shot);
});

app.patch('/api/shots/:id', (req, res) => {
  const shot = store.get().shots.find((s) => s.id === req.params.id);
  if (!shot) return res.status(404).json({ error: 'ショットが見つかりません' });
  const { name, description, stepStatuses } = req.body || {};
  if (name != null) shot.name = name;
  if (description != null) shot.description = description;
  if (stepStatuses && typeof stepStatuses === 'object') {
    shot.stepStatuses = { ...shot.stepStatuses, ...stepStatuses };
  }
  store.persist();
  res.json(shot);
});

app.delete('/api/shots/:id', (req, res) => {
  const db = store.get();
  const idx = db.shots.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ショットが見つかりません' });
  const [shot] = db.shots.splice(idx, 1);
  removeShotFiles(shot);
  store.persist();
  res.status(204).end();
});

// ============================================================
// バージョン（動画・画像アップロード）
// ============================================================
app.post('/api/shots/:id/versions', upload.single('file'), (req, res) => {
  const shot = store.get().shots.find((s) => s.id === req.params.id);
  if (!shot) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'ショットが見つかりません' });
  }
  if (!req.file) return res.status(400).json({ error: 'ファイルが必要です' });

  const isVideo = VIDEO_TYPES.includes(req.file.mimetype);
  const mediaFile = req.file.filename;

  // クライアントで生成したサムネイル(dataURL)があれば保存
  let thumbFile = null;
  const thumbData = req.body.thumbnail;
  if (thumbData && thumbData.startsWith('data:image/')) {
    thumbFile = saveThumbnail(thumbData);
  } else if (!isVideo) {
    // 画像はサムネ未指定なら実体をそのままサムネとして使う
    thumbFile = null;
  }

  const version = {
    id: store.newId('ver'),
    name: req.body.name || `v${shot.versions.length + 1}`,
    type: isVideo ? 'video' : 'image',
    file: `/media/${mediaFile}`,
    thumbnail: thumbFile ? `/thumbnails/${thumbFile}` : (!isVideo ? `/media/${mediaFile}` : null),
    uploadedBy: req.body.uploadedBy || 'unknown',
    uploadedAt: nowIso(),
    review: { status: 'pending', notes: [] },
  };
  shot.versions.push(version);
  // 最新バージョンのサムネをショットの代表サムネにする
  if (version.thumbnail) shot.thumbnail = version.thumbnail;
  store.persist();
  res.status(201).json(version);
});

// ディレクターチェック（レビュー結果の更新 / コメント追加）
app.patch('/api/versions/:id/review', (req, res) => {
  const db = store.get();
  let target = null;
  for (const shot of db.shots) {
    const v = shot.versions.find((ver) => ver.id === req.params.id);
    if (v) {
      target = v;
      break;
    }
  }
  if (!target) return res.status(404).json({ error: 'バージョンが見つかりません' });

  const { status, note } = req.body || {};
  const allowed = ['pending', 'approved', 'retake', 'rejected'];
  if (status) {
    if (!allowed.includes(status)) return res.status(400).json({ error: '不正な status です' });
    target.review.status = status;
  }
  if (note && note.text) {
    target.review.notes.push({
      author: note.author || 'director',
      text: note.text,
      time: nowIso(),
    });
  }
  store.persist();
  res.json(target);
});

app.delete('/api/versions/:id', (req, res) => {
  const db = store.get();
  for (const shot of db.shots) {
    const idx = shot.versions.findIndex((v) => v.id === req.params.id);
    if (idx !== -1) {
      const [v] = shot.versions.splice(idx, 1);
      removeMediaFiles(v);
      // 代表サムネを更新
      const last = shot.versions[shot.versions.length - 1];
      shot.thumbnail = last ? last.thumbnail : null;
      store.persist();
      return res.status(204).end();
    }
  }
  res.status(404).json({ error: 'バージョンが見つかりません' });
});

// ---- ヘルパ ----
function nowIso() {
  // Date は環境制約のある文脈でも動くよう try で保護
  try {
    return new Date().toISOString();
  } catch (_) {
    return '';
  }
}

function saveThumbnail(dataUrl) {
  const match = /^data:image\/(\w+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buf = Buffer.from(match[2], 'base64');
  const name = `${store.newId('thumb')}.${ext}`;
  fs.writeFileSync(path.join(THUMB_DIR, name), buf);
  return name;
}

function localPathFromUrl(url) {
  if (!url) return null;
  if (url.startsWith('/media/')) return path.join(MEDIA_DIR, url.slice('/media/'.length));
  if (url.startsWith('/thumbnails/')) return path.join(THUMB_DIR, url.slice('/thumbnails/'.length));
  return null;
}

function removeMediaFiles(version) {
  for (const url of [version.file, version.thumbnail]) {
    const p = localPathFromUrl(url);
    if (p && fs.existsSync(p)) fs.unlink(p, () => {});
  }
}

function removeShotFiles(shot) {
  for (const v of shot.versions || []) removeMediaFiles(v);
}

// multer などのエラーを JSON で返す
app.use((err, req, res, next) => {
  if (err) {
    console.error(err.message);
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Layna server listening on http://localhost:${PORT}`);
  console.log(`メディア格納先: ${MEDIA_DIR}`);
});

module.exports = app;
