# AIシフト（コメダ珈琲 シフト管理）

飲食店向けのAIシフト管理Webアプリ（PWA）。
いまは **見本データで動く版**（Supabase・Cloudflare・Gemini はまだつないでいない）。

## 動かし方（VS Code）

1. このフォルダを VS Code で開く
2. `index.html` を右クリック →「Open with Live Server」
3. ブラウザでログイン（パスワードは全部 `1234`）
   - 店長（3店舗を管理）`1000` ／ 福釜の社員 `2001` ／ 福釜のバイト（2nd：安城）`2004` ／ 安城のバイト `3004`
4. 見本データを最初に戻したい時：設定 →「見本データを最初に戻す」

> ※ `index.html` をダブルクリックで開くと動きません（type="module" のため）。必ず Live Server で開く。

## iPhone で試す（MacBook と同じ Wi-Fi で）

1. MacBook で Live Server を動かしておく
2. MacBook の IP を調べる：システム設定 → Wi-Fi → つないでいるWi-Fiの「詳細」→「IPアドレス」（例 192.168.1.23）
3. iPhone の Safari で `http://192.168.1.23:5500/` を開く（数字は自分のIP。5500 は Live Server の番号）
4. 開けない時：VS Code の設定で `liveServer.settings.host` を `0.0.0.0` にして、Live Server を動かし直す

> ※ 見本データは「その機械のブラウザの中」に保存される。iPhone と MacBook では別々のデータになる（Supabase をつなぐと共通になる）。

## 本番の準備（Supabase ＋ Cloudflare）2026年11月6日

全部で6つ。上から順に。どれも無料プランでできる。

### ① Supabase：データベースを作る
1. supabase.com でアカウントを作る →「New project」（Region は Tokyo）
2. 左の「SQL Editor」→ `supabase/schema.sql` の中身を全部貼って「Run」
3. もう一度「New query」→ `supabase/seed.sql` を貼って「Run」→ 下に出る **初回コード（6桁）をメモ**（店長 ID 1000 用。7日以内に使う）
4. 左の「Authentication」→「Sign In / Providers」→「Allow new users to sign up」を **オフ**（アカウントは Worker だけが作る。知らない人が勝手に登録できないように）
5. 次の3つをメモ：
   - Project URL（「Project Settings」→「Data API」。例 `https://abcd.supabase.co`）
   - Publishable key（「Project Settings」→「API Keys」。`sb_publishable_…`。古い画面なら anon key）
   - Secret key（同じ所。`sb_secret_…`。古い画面なら service_role key）← **これは秘密**

### ② Cloudflare：Worker（サーバー）を作る
1. dash.cloudflare.com →「Workers & Pages」→「Create」→「Create Worker」→ 名前 `shiftapp-api` →「Deploy」
2. 「Edit code」→ `workers/api/worker.js` の中身を全部貼って「Deploy」
3. 「Settings」→「Variables and Secrets」に入れる：
   - `SUPABASE_URL`（Text）… ①の Project URL
   - `SUPABASE_SERVICE_KEY`（Secret）… ①の Secret key
   - `GEMINI_API_KEY`（Secret）… Google AI Studio の鍵
   - `LOGIN_EMAIL_DOMAIN`（Text）… `login.shiftapp.example.com`
   - `ALLOWED_ORIGIN`（Text）… ④でできるアプリのURL（④のあとに入れる）
   - 通知を使う時（あとでもよい）：`tools/make-vapid.html` をブラウザで開いて「鍵を作る」→
     `VAPID_PUBLIC_KEY`（Text）・`VAPID_PRIVATE_JWK`（Secret）・`VAPID_SUBJECT`（Text。`mailto:自分のメール`）
4. Worker のURL（例 `https://shiftapp-api.〇〇.workers.dev`）をメモ

### ③ アプリの設定を書く
`js/config.js` の一番上に入れる：`SUPABASE_URL`（①）・`SUPABASE_ANON_KEY`（①の Publishable key）・`API_WORKER_URL`（②）・`VAPID_PUBLIC_KEY`（通知を使う時。②で作った公開してよい方）
> Publishable key は「画面に置いてよい鍵」。Secret key と Gemini の鍵は、ここには **絶対に書かない**。

### ④ Cloudflare Pages：アプリを公開する
1. MacBook のターミナルでこのフォルダに入り `sh tools/make-site.sh` → `dist` フォルダができる
2. 「Workers & Pages」→「Create」→「Pages」→「Upload assets」→ 名前 `shiftapp` → `dist` フォルダを入れて「Deploy」
3. できたURL（例 `https://shiftapp.pages.dev`）を、②の `ALLOWED_ORIGIN` に入れる

### ⑤ 店長でログイン
iPhone の Safari でアプリのURLを開く →「はじめての方」→ ID `1000` と①の初回コード → パスワードを決める
→ Safari の共有ボタン →「ホーム画面に追加」→ ホーム画面のアプリから開いて「設定」→「通知を受け取る」

### ⑥ 店員を足す
「店舗」→「店員管理」→ 店員を作ると初回コードが出る → 本人に ID とコードを渡す（本人が「はじめての方」で決める）

> 直した時：③ のあと ④-1 → Pages の「Create deployment」で `dist` を入れ直す。
> 初回コードは7日・5回まちがえると使えない。その時は店員管理の「パスワードをリセット」で出し直す。

## AI（Gemini）をつなぐ（2026年11月5日）

### 今すぐ試す（この機械に鍵を入れる）
1. Google AI Studio（https://aistudio.google.com）に Google アカウントで入る
2. 「Get API key」→「Create API key」で鍵を作る（無料）
3. アプリに店長（1000）で入る → 店舗 →「AIの設定」→「今すぐ試す」に鍵を入れて「保存する」→「つながるか試す」
4. シフト作成 →「✨ AIで作成」

> ※ 鍵は、その機械のブラウザにだけ保存される。GitHub やプログラムには絶対に書かない。
> ※ 無料枠では、送った内容が Google の改善に使われることがある。だから名前は「S1」などの番号にして送っている（js/ai/prompt.js）。

### 本番（Cloudflare Worker を通す。鍵はサーバーにだけ置く）
下の「本番の準備」をしたあと、「AIの設定」→「本番」を選ぶ（Gemini の鍵は Worker に入れる）。

### AIの流れ（どのファイルか）
- 「AIで作成」→ `ai/draft-service.js`：たたき台（simple-draft.js）→ Gemini（prompt.js → gemini.js）→ 確かめる（validate.js）→ よい方を使う
- AIがつながらない・エラーの時は、たたき台をそのまま使う（止まらない）
- 公開すると、AIの下書きから店長が直した所を覚える（`ai/learning.js`）。同じ直しが2回で「覚えた」になり、次から最初からそうする
- 覚えたことは「AIの設定」の下で見られる・消せる

## ルールチェックのテスト

```bash
npm install   # はじめの1回（テスト用の Postgres が入る）
npm test
```

## フォルダの中身（どこに何があるか）

```
shift-app/
├─ index.html              アプリの入口（入れ物だけ）
├─ manifest.webmanifest    ホーム画面に追加した時の設定
├─ sw.js                   電波がない時もアプリを開けるようにする
├─ css/
│  ├─ base.css             色・文字（色を変えるならここ）
│  ├─ layout.css           ヘッダー・タブバーなど画面の枠
│  ├─ components.css       ボタン・カード・入力欄など何度も使う部品
│  ├─ screens.css          画面ごとの見た目
│  └─ ai.css               AIの結果・AIの設定・「待っています」
├─ js/
│  ├─ main.js              最初に動く（ログインが残っているか確かめる）
│  ├─ config.js            設定（見本／本物の切り替え、営業時間、立場の名前など）
│  ├─ router.js            画面の切り替え・タブバー・店長だけの画面の制限
│  ├─ store.js             ログイン中の人
│  ├─ api/
│  │  ├─ index.js          データのやりとりの入口（画面はここだけを使う）
│  │  ├─ supabase-api.js   本物（Supabase）につなぐ api（下の supabase/ をまとめる）
│  │  ├─ supabase/         本物用：core（道具・ログイン中の人）・auth・stores・members・periods・notices・calls・ai
│  │  ├─ mock-api.js       見本データで動く「にせものサーバー」
│  │  ├─ mock-store.js     見本データの保存場所・共通の道具
│  │  ├─ mock-calls.js     人が足りない時の自動連絡
│  │  ├─ mock-ai.js        AIの下書き・学び・人の追加
│  │  └─ mock-data.js      見本データ（スタッフA など）
│  ├─ rules/
│  │  ├─ shift-rules.js    ルールチェック（必要人数・立ち上げ・締め・休憩・希望・週1休み…）
│  │  ├─ candidates.js     人が足りない時に「入れそうな人」をさがす
│  │  └─ labor-rules.js    働き方のルール（18歳未満の深夜・連勤・月と年の上限）
│  ├─ ai/
│  │  ├─ draft-service.js  「AIで作成」「AIに直してもらう」の流れ
│  │  ├─ simple-draft.js   簡易版の下書き（AIのたたき台・AIなしの時）
│  │  ├─ prompt.js         Gemini に送る文（名前は番号にする）
│  │  ├─ gemini.js         Gemini を呼ぶ（直接／Worker）
│  │  ├─ validate.js       AIの答えを確かめる
│  │  ├─ learning.js       店長の直し方を覚える
│  │  └─ ai-settings.js    AIのつなぎ方の設定（この機械に保存）
│  ├─ components/
│  │  ├─ header.js         画面の見出し
│  │  ├─ assignment-panel.js シフト作成の右の欄（1人分の勤務を直す）
│  │  ├─ my-shifts.js      自分のシフト（今日・明日・明後日…。ホームで使う）
│  │  ├─ day-list.js       その日の一覧（名前と何時から何時まで）
│  │  ├─ ai-result.js      「AIの結果」のカード
│  │  ├─ add-person.js     「＋ 人を追加」のダイアログ
│  │  ├─ print-week.js     1週間のシフトを紙に印刷（お店に貼る用・PDFにも）
│  │  └─ timeline.js       シフト表（時間の目盛り＋線、ドラッグ）
│  ├─ lib/                 小さな道具（立ち上げ・締めの決まり・時刻・日付・週・HTML要素づくり・元に戻す・休憩の決まり・スマホへの保存・ファイル保存・通知）
│  └─ screens/             1画面＝1ファイル
│     ├─ login.js          ログイン／はじめての方
│     ├─ home.js           ホーム（店長・店員）
│     ├─ kibou.js          希望入力（バイト／社員で中身が変わる）
│     ├─ calendar.js       個人カレンダー
│     ├─ published.js      公開シフト（店全体・見るだけ）
│     ├─ shift-editor.js   シフト作成（店長）
│     ├─ store-menu.js     店舗メニュー（店長）
│     ├─ staff.js          店員管理（立場・できること％・人ごとのルール）
│     ├─ map.js            マップ・必要人数・営業時間
│     ├─ stores.js         店舗の管理（増やす・名前を変える・休止する）
│     ├─ ai.js             AIの設定・AIが覚えたこと
│     ├─ report.js         勤務時間の集計（月ごと・CSV）
│     └─ settings.js       設定・ログアウト
├─ _headers               Cloudflare Pages の安全の設定
├─ package.json           テストの道具（npm はテストの時だけ。アプリには要らない）
├─ supabase/
│  ├─ schema.sql          データベースの表と、見てよい人の決まり（RLS）
│  └─ seed.sql            最初のデータ（会社・3店舗・店長 1000・祝日）
├─ workers/api/           サーバー（Cloudflare Worker）：はじめての方・AI
├─ tools/make-site.sh     公開用の dist フォルダを作る
├─ tools/make-vapid.html  プッシュ通知の鍵を作るページ
├─ icons/                 ホーム画面・通知のアイコン
├─ docs/はじめに読む.md    初めてコードを読む人へ（どこに何があるか）
├─ docs/設定ファイルの説明.md  コメントを書けない JSON（manifest・package.json）の説明
└─ tests/
   ├─ rules.test.mjs       ルールチェックの自動テスト
   ├─ breaks.test.mjs      休憩の決まりのテスト
   ├─ labor.test.mjs       働いた時間・人件費の目安のテスト
   ├─ ai.test.mjs          AI（確かめ・学び・送る文・流れ・入れそうな人）のテスト
   ├─ supabase.test.mjs    本物用の api を、本物の Postgres（PGlite）＋決まり（RLS）で通して確かめる
   ├─ worker.test.mjs      Worker（はじめての方・AI）のテスト
   ├─ webpush.test.mjs     プッシュ通知の暗号と送り方のテスト
   ├─ labor-rules.test.mjs 働き方のルールのテスト
   └─ helpers/             テスト用の「にせもの Supabase」
```

## 決まりごと（コードを書く時）

- 時刻は「0:00から何分か」で持つ（7:00＝420、22:00＝1320）。15分刻み
- 日付は `"2026-11-09"` の文字で持つ
- 画面のファイルは `api` 以外からデータを取らない（あとで本物に差し替えるため）
- 人の名前などを画面に出す時は `createElement()` を使う（`innerHTML` は使わない＝安全のため）
- 希望は店長だけが見られる。人ごとのルールも店長だけ
- 店舗は増やす・名前を変える・休止ができる（消さない。過去のシフトに店名が残るため）。休止した店舗は切り替えに出ない
- 店長は3店舗を切り替えて使う。どの画面も「今見ている店舗」（state.storeId）のデータを出す
- スタッフの「行ける店舗と順番」：メイン（1）・2nd・3rd。人が足りない時、AIは2nd・3rd の人を入れる
- 立ち上げは1人。開店30分前から入る（7:00開店→6:30。lib/roles.js、config の OPEN_PREP_MIN）
- 休憩は朝11:00より前に入れない（lib/breaks.js）
- 自分のシフトはスマホにも保存する（2年分。lib/offline-cache.js）
- 人件費の目安は lib/labor.js（休憩：6時間超45分・8時間超60分を引く、22:00〜翌5:00は1.25倍、交通費は1日1回、社員は入れない）
- シフト交代：本人が「お願い」→ 行ける人が「代わります」→ 店長が「承認」で入れ替わる
- 社員の休み希望：1日目はふつう、2日目は店長の特別許可、3日目は出せない（config の SHAIN_OFF_FREE・SHAIN_OFF_MAX）
- 人が足りない時：公開した時に、入れそうな人（rules/candidates.js）に自動で連絡 →「入れます」→ 店長が決める（api/mock-calls.js）
- シフト作成の「＋ 人を追加」：ほかの店舗の人（この週だけ応援／この店舗にも行ける）、まだアカウントがない人
- 店舗を増やす時は、ほかの店舗の営業時間・マップ・必要人数を写せる。行ける人もまとめて選べる
- どのファイルも一番上に「このファイルは〇〇のファイルです」、変数・関数にはそれぞれコメントをつける
- 働き方のルール（rules/labor-rules.js）：18歳未満は22時〜朝5時に入れない、連勤は6日まで、月の上限時間・年の上限金額（店長が人ごとに決める）
- 勤務時間の集計（screens/report.js）：公開したシフトだけを月ごとに数えて、CSV に書き出す（給与計算の元）
- バックアップ：設定 →「バックアップを保存する」（店長）。Supabase の無料プランは自動のバックアップがないので月1回
- プッシュ通知：お知らせを入れた時に Worker の /push が送る（lib/push.js・sw.js・workers/api/worker.js）

## 次にやること（ロードマップ）

1. 本番の準備（上の①〜⑥）
2. 各店舗の店内図の写真をマップの背景にする
3. 打刻（出勤・退勤）・有給の管理（必要になったら）
