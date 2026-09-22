# Novel Deadline Editor v5

v3/v4からの更新版です。

## v5の変更
- 締切は1件だけでも利用可能
- 最大3件の締切名称を自由変更可能（例: 早割り → A出版）
- 日時未設定の締切は上部に表示しない
- 本文 / アウトライン / キャラ設定 の3ページ
- アウトライン・キャラ設定は本文文字数、ページ数、TXT出力に影響しない
- 章タブから章へ移動
- 各章タブの `×` で章削除（最後の1章は削除不可）
- 作品一覧から作品削除
- 作品削除は2段階確認
- Firebase書込を「変更された章中心」にして書込回数を削減
- GitHub Pagesの作品別URL直アクセス時の読込処理を修正

## 更新方法
既にFirebase設定済みの場合は、まず `firebase-config.js` を上書きしないでください。

GitHubリポジトリで次のファイルをv5版へ置き換えます。
- `index.html`
- `style.css`
- `app.js`
- `404.html`

さらに、Firestore Rulesは `firestore.rules` の内容へ更新してFirebase Consoleで公開してください。

## Firestore Rules
今回のRulesには以下が含まれています。
- ownerだけが作品を読書き・削除可能
- ownerだけが章を読書き・削除可能
- 初回作品作成batch用 `getAfter()`
- slug存在確認用 `allow get`

## 注意
作品削除・章削除はFirestoreから実データを削除します。元に戻す機能はまだありません。
