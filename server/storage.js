'use strict';

/**
 * ごく軽量な JSON 永続化レイヤ。
 * DB は使わず、このツール用のローカルフォルダ (data/db.json) にメタデータを保存する。
 * 初回起動時は data/seed.json（工程テンプレートの初期値）を元に db.json を生成する。
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const SEED_PATH = path.join(DATA_DIR, 'seed.json');

let db = null;
let writeChain = Promise.resolve();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultDb() {
  return {
    pipelineTemplates: [],
    projects: [],
    shots: [],
  };
}

function load() {
  ensureDataDir();
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } else if (fs.existsSync(SEED_PATH)) {
    db = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    persistSync();
  } else {
    db = defaultDb();
    persistSync();
  }
  // 後方互換: 欠けているトップレベルキーを補完
  for (const key of Object.keys(defaultDb())) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  return db;
}

function get() {
  if (!db) load();
  return db;
}

function persistSync() {
  ensureDataDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

/**
 * 直列化した非同期書き込み。同時リクエストでもファイル破損しないよう順番に書き出す。
 */
function persist() {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        ensureDataDir();
        const tmp = DB_PATH + '.tmp';
        fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8', (err) => {
          if (err) return reject(err);
          fs.rename(tmp, DB_PATH, (err2) => (err2 ? reject(err2) : resolve()));
        });
      })
  );
  return writeChain;
}

/**
 * 衝突しにくい ID を Date/Math.random 無しで生成する
 * （高精度時刻 + プロセスカウンタ）。
 */
let counter = 0;
function newId(prefix) {
  counter += 1;
  const t = process.hrtime.bigint().toString(36);
  return `${prefix}_${t}${counter.toString(36)}`;
}

module.exports = { load, get, persist, persistSync, newId, DB_PATH, DATA_DIR };
