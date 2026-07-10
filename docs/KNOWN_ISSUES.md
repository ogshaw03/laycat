# 既知の問題・修正候補メモ（LayCAT / Layna.html）

全文コードレビュー（2026-07-10）で洗い出した問題点の記録。
このセッションで対応した分と、未対応で残している分を分けて記載する。
※ 行番号はレビュー時点の目安。編集で前後にずれることがある。

## 設計方針（このセッションで確定）

- **REEL・データはプロジェクトを跨がない。** すべてのデータはプロジェクトごとに完全に分離してよい。
  - → 下記の「REELがロックを迂回」「REELメンションのプロジェクト不一致」は、
    REEL をカレントプロジェクト内に限定する方針で解消する（横断機能は持たせない）。

## 対応済み（このセッション）

- **[高] レビュー窓のリスナー/rAFループ解放漏れ** … 再オープン・外部クローズ・resize/ResizeObserver・sync ループを
  単一の `cleanup()`（`_fbCleanup`）に集約。`sync` の停止判定を DOM id から生存フラグ `alive` に変更。
  `close()`/`closeReviewOverlay()`/再オープンすべてが cleanup を通る。`seekGuard` クリアと `exitCompare` も cleanup で実施。
- **[高] 起動時 `projRoot` がジェスチャ外で `requestPermission`** … 起動時は `queryPermission` のみ（`interactive` 引数）。
  権限未許可は `_pendingGrant` に記録し、保存先インジケータのクリック（ユーザー操作）で `grantProjectAccess()` により再接続＆再読込。
- **[高] フォルダ書込失敗時の無言 localStorage フォールバック** … フォルダ設定済みプロジェクトは書込失敗を明示エラーにし、
  古い内容で localStorage を上書きしない（`hasFolderConfigured`）。`persist` は保存成功時のみキャッシュ更新（失敗は再試行）。
- **[中] 「戻る」でドロワーが閉じない** … `applyHash` の `'n'` 分岐で drawer セグメントが無ければ `tabDrawers[key]` を削除。
- **[中] `deleteLayer` のレイヤー番号ズレ** … 保存済み（`v.review.notes`）と `redoStack` も同レイヤー除去・繰り下げ、変更時は保存。
- **[中] 顔ガイド操作が画面回転を無視** … `pt()` の逆変換座標系で操作量・ロール角を計算。
- **[中] 描画中の Space で再生トグル** … stroke/erase/head 操作中は Space タップ再生を抑止。
- **[中] `deleteNode` がクリップ1つの巻き添えでリール全削除** … 該当クリップのみ除去、空リールのみ削除。
- **[中] 未解錠プロジェクトのコメントが通知に漏れる** … `scanMentionsForMe` でロック中ルートをスキップ。
- **[中] 既読キーが受信者非依存** … `mn:`/`rq:` キーに受信者識別子（selfTag）を付与。

## 未対応（残す）

### 高
- **パスワード保護が「表示ゲート」のみ**（`projectLocked` 3293 / `renderBodyMain` 1859）
  全ノードが `DB` に平文でロードされ、DevTools や IndexedDB 直読みで閲覧可能。`hashPass` も SHA-256 1ラウンド。
  真の保護には内容の暗号化が必要。当面は「機密保護ではなく軽い隠し」である旨の明示を検討。
- **REEL が `projectLocked` を迂回**（`openReelFromSaved` 5443 / `reelAddClip` 5339 / `vcard-reel` 2537）
  → 上記方針（REEL をプロジェクト内限定）に合わせ、ロック中プロジェクトのクリップは REEL に載せない実装を追加する。

### 中
- **`persist()` に直列化がない**（915-931）… 並行呼び出しで同一 fileHandle への `createWritable` が競合し得る。単一の直列キューにする。
- **REEL メンションの候補提示と解決がプロジェクト不一致**（`attachMention` 4703 / `buildNotes` 4954）
  → REEL をプロジェクト内限定にすれば解消。候補・抽出・描画を「クリップ所属プロジェクト（＝カレント）」に統一。
- **REEL コメントが tracked mention id を捨てる**（`buildNotes` 4954）… `buildFrameNotes` に `mentions`（`cta._mentions`）を渡す。
- **`newId` が Date.now＋カウンタのみで複数ユーザー衝突あり**（810）… ユーザー/セッション由来のソルトや `crypto.randomUUID()` を混ぜる。
- **再帰/ループ系に循環 parentId ガードなし**（`pathOf`/`rootOf`/`descendants`/`renderTreeNode`/`nodeStatus` 944-949 他）
  破損 JSON で無限ループ／スタックオーバーフロー。visited セットで防御。

### 低
- **`eraseAt`・既存ヘッド再編集で `redoStack` 未クリア**（3941-3962）… 破壊的編集後に `redoStack=[]`。
- **Undo/Redo が `pending` の push/pop のみ**（4010-4013）… ヘッドの in-place 変形・確定線の消しゴム編集を戻せない。操作単位ヒストリが必要。
- **`urlCache` が無制限**（`getURL` 884 / `disconnectProject` 1590）… 接続解除時に該当 ref を revoke、または LRU 上限。
- **`idbOpen` に `onblocked` なし・接続を毎回開いて閉じない**（814）… `onblocked` を reject、接続を 1 つキャッシュ。
- **プロジェクト間で node.id 衝突すると後勝ちで無言破棄**（`boot` 1063）… projectId スコープで名前空間化、または警告。
- **`_saveSeenMentions` を通知 push 前に呼ぶ**（1074 / 1269-1273）… `persist()` 成功後に既読保存する順序へ。
- **`deleteNode` が version 由来でないメディア（`node.thumbnail` 等）を取り残す**（3390 / 3397）… version 以外の参照も掃除。
- **`cloneDrawItem` が `points` を参照コピー**（2701）… `points:p.points.map(q=>q.slice())` で深いコピー。
- **`w:brushW/canvas.width` が `canvas.width===0` で Infinity**（3992）… `Math.max(1,canvas.width)` でガード。
- **チェック待ちスナップショットが判定後も滞留**（`checkSnap` 2000-2002）… 現状は仕様（誤操作防止）。同時進行時の整合性は要確認。

## 問題なしを確認した点
- XSS：名前・コメント・メンション挿入はすべて `textContent`/`createTextNode` 経由。`innerHTML=` は静的アイコン/SVG のみ。
- 比較再生：`exitCompare` の後始末は適切。`cmpFrameSync`/`syncBToA` は `cmpOn`/`bSeekBusy` で正しくガード。
- `pt(e)`：回転・ズーム・パンの逆変換とアスペクト正規化は一貫。
