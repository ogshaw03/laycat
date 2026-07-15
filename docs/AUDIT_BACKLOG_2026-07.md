# コード全文解析 バックログ（2026-07）

対象: `laycat.html`（6725行）＋ `access-console.html`。すべて**実コードで裏取り済みの確定所見**のみ掲載（誤検知は末尾に記録）。
運用前提: 社内チームが**共有フォルダ（Drive等）＋GitHub Pages 配信**でレビュー／進行管理に使用。

優先度の考え方:
- **P0 = 日々の運用に実害。速やかに対応推奨。**
- **P1 = 近いうちに（軽量な確定分・データ整合）。**
- **P2 = 今後（狭い条件・UX・理論上）。**

補足（緊急度の判断根拠）: 認証(S1/S2)は、実データが「ローカルフォルダ権限＋Firestoreルール」で別途保護されるため、UIゲートがオフでも第三者に見えるのは空のアプリ。よって緊急度は見た目より低く P1 とする。

---

## P0 — 速やかに対応推奨

### N1【中】共有URLに別タブの stale ドロワーが残り、無関係なドロワーが開く
- 場所: `laycat.html:1868`(go) / `2262`(renderBody で state.drawer 再計算) / `1881-1885`(hashOf)
- 症状: `go()` が `syncHash()` を `render()` の**前**に呼ぶため、`hashOf()` が直前タブの `state.drawer` を読み、URL に `/s/…` や `/t/…` が残る。そのURLをリロード/共有すると `applyHash` が無関係なドロワー（別サブミット等）を開く。
- 影響: **レビュー共有（URLで特定サブミット/工程を渡す）が核の機能なので実害大。**
- 修正案: `go()` とタスクタブ onclick(2206) で `syncHash()` を `render()` の**後**に呼ぶ（または render 後に再 syncHash）。
- 状態: 未対応

---

## P1 — 近いうちに

### C1【低】リールに同一クリップが重複追加される（await前の重複チェック）
- 場所: `laycat.html:6440-6443`（reelAddClip）
- 症状: 重複判定を `await storage.getURLRetry` の前に行い push は後。URL解決が遅い時に同一動画へ素早く2回「REELに送る」と両方通過し重複。
- 修正案: `await` 後に重複判定を再チェックしてから push。
- 状態: 未対応

### S4【低】コンソール初期化がメールを小文字化せず、管理者ロックアウトの芽
- 場所: `access-console.html:605`（`operatorEmails:[me.email]`。他経路は全て `lc()`）
- 症状: 大文字混じりメールで初期化すると、`setRole` の「最後の運営」保護(545)・重複排除(554)・自己降格確認(548)が一致せずすり抜け、全員ロックアウトや運営二重登録の恐れ。ルール `isStaff` 照合とも不一致になり得る。
- 修正案: 605 の `me.email` を `lc(me.email)` に（`updatedBy` は任意）。
- 状態: 未対応

### N3【低】サブミット作成モーダルを閉じると `thumbUrl`(ObjectURL) が revoke されずリーク
- 場所: `laycat.html:1639`(✕) / `1644`(背景) — remove するだけ。revoke は差し替え(1703)と成功時(1822)のみ。
- 修正案: 閉じる/背景クリック時に `blocks` の `thumbUrl` を全て revoke。
- 状態: 未対応

### D1【中】version / review-note / submit の「削除」に tombstone が無く、マージで復活し得る
- 場所: `_mergeNodeInto`(`4145-4160` versions/notes を id union) / `_unionRemoteIntoDB`(`4129` submits を id union)。削除は `4484`(version)・`3375`(note) が filter のみ、submit も記録なし。
- 症状: ノード削除は `_tomb` で伝播するが、version/note/submit 削除は記録が無い。Drive の競合コピー(`laycat (1).project.json`)復旧(`absorbConflictCopies`)や baseline 不明時の union で、削除した版/コメント/サブミットが復活する。
- 修正案: `_tomb` を version/note/submit にも拡張（例: `root._tomb` に `{kind:'ver'|'note'|'submit', id, at}` を追加し、`_applyTombstones` で各配列からも除去）。#5 の設計を踏襲。
- 状態: 未対応

### D4【低-中】union分岐（baseline無し＋remote読取不能）に保存見送りガードが無い
- 場所: `laycat.html:1126-1140`（_persistNow の else 分岐）
- 症状: baseline 未設定かつ `readProjectData` が null（読取失敗/未存在）だと union を経ずに `saveProject` へ到達。フォルダに実データがあるのに一時的に読めなかった場合、丸ごと上書きし得る（発生条件は狭い：接続時 seed も失敗しているケース）。
- 修正案: #4 と対称に、baseline 無し＋remote が「存在するのに読めない」場合は保存見送り（readProjectData がエラーと未存在を区別できるよう改修）。
- 状態: 未対応

### S1【中】認証 fail-open（access.json 取得失敗でゲート無効）
- 場所: `laycat.html:6668-6670`
- 症状: `access.json` の fetch/parse 失敗で `accessCfg=null`→`AUTH_ON=false`→`startAppFlow()`。本番ホストでも設定ファイルが取れないと素通し。
- 緩和済みの実態: データはフォルダ権限＋Firestoreルールで別途保護。UI入口の弱さ。
- 修正案: 本番ホストで access.json 取得失敗時は fail-closed（ログイン要求のまま）にする。
- 状態: 未対応

### S2【中】Firestoreルール：`invited` 自己登録が招待トークン検証なしで通る
- 場所: `access-console.html` の RULES（`laynaAccess/invited` の create/update）
- 症状: 署名済みユーザーが自分のキー1件を `invited` に書け、本体がそれを許可メンバー化する。ルールに「有効な招待トークンの存在」条件が無い（改ざん防止はできているが token 必須ではない）。
- 修正案: 自己登録時に `request.resource.data.emails[myKey()].byToken` が存在し、`laynaAccessInvites/<byToken>` が `active==true` であることを要求。**Firebase Rules Playground で必ず検証**してから公開。
- 状態: 未対応

---

## P2 — 今後

- **S3【低-中】** config 未作成時、任意の認証ユーザーが最初に作成しブート窓を奪える（RULES / initialize）。運用で即時初期化するなら実害小。
- **S5【低】** `redeemInvite` の `active===false`（未定義=有効扱い）・`expires` 文字列比較が形式依存（`laycat.html:6715-6716`）。※クライアント判定のみ、本命はルール。
- **D2【低】** プロジェクト(root)削除は tombstone 対象外＝共有相手へ削除が伝播しない（`4351`）。
- **D3【低】** `delProject` が `reels/<id>.json` を消さず孤児化（`1014`）。
- **N2【中・設計依存】** `buildTaskTabs`(`2195`) が `openTasks` を現ルートのみに破壊的に絞り→永続化で他プロジェクトの開きタブ消失。プロジェクト横断でタブ復元されない。
- **N4【低】** `saveLoc`(`2009`) に unload フラッシュ無し。遷移直後に閉じると位置復元を取りこぼす。
- **C2【低】** Firebase 初期化失敗時、ログインボタンが「初期化中」トーストのみで詰む（`6722`/`6628`）。再読込案内が無い。
- **C3【低】** ショット hover 自動再生の二重 play 競合（`2588-2593`）。
- **T1【低】** `isDoneStatus` 正規表現(`1200`)が英字カスタムラベル(`fixing`/`OK待ち`等)に部分一致し完了誤判定。既定の日本語ラベルでは発生せず。
- **T2【低/理論上】** `descendants`/`rootOf`/`nodeStatus`/`projStatuses`(`1164`ほか)に循環ガード無し。破損データ（parentId 循環）が union で混入すると無限ループ。防御的に visited ガードを入れる価値あり。
- **T3【低】** `migrate`(`1153`) が旧データの notifications 等をガードせず（レガシー移行時のみ）。

---

## 誤検知として棄却（記録）
精査エージェントの一部は実行環境不調で「読めないまま推測」し誤検知を出した。以下は**実コード確認の結果バグ無し**:
- `getURL` の `return url` 欠落 → 末尾に存在（`1051`）
- `refreshFromFolders` が tombstone 未適用 → `_unionRemoteIntoDB` 末尾の `normalizeNodes()`→`_applyTombstones()` で適用済み
- `projectData` の `exportedAt` 常時差分 → `exportedAt` は存在しない（`{v:3,id,name,nodes,submits}`）
- `repOf` の `n.status`（nodeStatus と整合）／`roleOf` メモ無効化（render単位で安全）／`taskAssignBadges(null)`（null安全）／RAF同期ループ（`alive` で停止）／`exitCompare`（共有URLキャッシュで revoke 不要）／コンソール onSnapshot 解除・ログイン画面 XSS・動画プール破棄 — いずれも問題なし。

---

## 補足
- 高（High）深刻度の項目は無し。
- 未精査で残った領域: 描画/プレイヤー(3000-4074)の一部（buildVPlayer・genThumb・downloadVersion・buildFrameNotes は別経路で確認済み）。必要なら追加精査。
