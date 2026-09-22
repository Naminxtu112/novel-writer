# Novel Deadline Editor v3

Firebase Authentication + Cloud Firestore対応版です。

## 実装済み
- ログインID + 編集パスワード
- ユーザー別作品一覧
- 作品名／よみからURL候補を生成し、手動修正可能
- 作品別URL `/write/<slug>`
- PC / スマホ間のFirestore同期
- 入力停止約1.5秒後の自動クラウド保存
- localStorageへの即時一時保存
- 章タブ、TXT出力、ローカル校閲
- 早割り / 標準 / 特急
- A6 40字×16行 / A5 57字×23行
- ページ換算設定とブラウザ表示フォントサイズを分離

# Firebase Console 設定

## 1. プロジェクト
1. Firebase Consoleで「プロジェクトを作成」。
2. 無料のSparkプランのまま開始。
3. この用途だけならGoogle AnalyticsはOFFでも構いません。

## 2. Webアプリ
1. プロジェクト概要 → `</>` Web。
2. Webアプリを登録。
3. 表示された `firebaseConfig` をコピー。
4. `firebase-config.js` 内の `PASTE_...` を実値に置換。

## 3. Authentication
1. Build → Authentication → 始める。
2. Sign-in method → メール/パスワードを有効化。
3. Email linkは不要。

画面ではメールアドレスを要求しません。入力されたログインIDを内部で `ログインID@novel.local` に変換してFirebase Authenticationを使います。

## 4. Cloud Firestore
1. Build → Firestore Database → データベース作成。
2. 本番環境モードを選択。
3. ロケーションを選択。
4. Firestore → Rulesを開く。
5. 同梱の `firestore.rules` 全文へ置換。
6. 公開。

**テストモードのまま運用しないでください。**

# GitHub Pages 設定

## 1. リポジトリ
例: `novel-writer`

以下をリポジトリ直下へアップロードします。
- index.html
- 404.html
- style.css
- app.js
- firebase-config.js
- firestore.rules
- README.md

## 2. APP_BASE_PATH
公開URLが
`https://USERNAME.github.io/novel-writer/`
なら `firebase-config.js` を
`APP_BASE_PATH = "/novel-writer/";`
にします。

リポジトリ名が `write-app` なら `/write-app/`。
独自ドメイン直下なら `/`。

## 3. Pages有効化
GitHub → Settings → Pages → Build and deployment
- Source: Deploy from a branch
- Branch: main
- Folder: / (root)

# 初回利用
1. 公開トップURLへアクセス。
2. ログインIDを入力。
3. 6文字以上の編集パスワードを入力。
4. 「新規ユーザー作成」。
5. 「＋ 新しい作品」。
6. 作品名を入力。
7. 漢字タイトルなら必要に応じて「よみ」も入力。
8. URL名の自動候補を確認し、必要なら修正。
9. 作成。

作品URL例:
`https://USERNAME.github.io/novel-writer/write/yoakemae-no-honey-milk`

PCとスマホでこの同じURLを開き、同じログインID・編集パスワードでログインすると同じFirestoreデータを編集できます。

# URL候補
かな／カナの「よみ」は簡易ローマ字化します。漢字の読みをブラウザだけで正確に決めることはできないため、漢字タイトルでは「よみ」を入力するのが確実です。URL候補は常に手修正できます。

# 保存
本文入力中はlocalStorageへ一時保存し、約1.5秒入力が止まるとFirestoreへ保存します。画面右側に同期状態が表示されます。

# セキュリティ
Firestore Security Rulesで、認証済みかつ `ownerId == request.auth.uid` の作品のみ読書きできます。URLだけを知っている別ユーザーは原稿を取得できません。

## 注意
このv3は仮想メール方式なので、通常のメールによる「パスワードを忘れた」復旧はできません。復旧機能が必要になったら、実メールアドレス認証へ変更してください。


---
# v4 追加仕様
- 締切は1〜3件。1件のみでも可。
- 締切名を自由変更可能（例: 早割り → A出版）。
- 日時未設定の締切は上部に表示しません。
- 本文 / アウトライン / キャラ設定 の3ページを追加。
- アウトラインとキャラ設定は任意で、文字数・ページ数・TXT出力には含めません。
- これら2ページもFirestoreへ自動保存しPC/スマホ間同期します。
- v3の既存作品はそのまま開けます。Rules変更は不要です。
