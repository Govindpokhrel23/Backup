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

## AI（Gemini）をつなぐ（2026年11月5日）

### 今すぐ試す（この機械に鍵を入れる）
1. Google AI Studio（https://aistudio.google.com）に Google アカウントで入る
2. 「Get API key」→「Create API key」で鍵を作る（無料）
3. アプリに店長（1000）で入る → 店舗 →「AIの設定」→「今すぐ試す」に鍵を入れて「保存する」→「つながるか試す」
4. シフト作成 →「✨ AIで作成」

> ※ 鍵は、その機械のブラウザにだけ保存される。GitHub やプログラムには絶対に書かない。
> ※ 無料枠では、送った内容が Google の改善に使われることがある。だから名前は「S1」などの番号にして送っている（js/ai/prompt.js）。

### 本番（Cloudflare Worker を通す。鍵はサーバーにだけ置く）
1. Cloudflare に入る → Workers & Pages →「Create」→ Worker を作る
2. `workers/ai-proxy/worker.js` の中身を貼って「Deploy」
3. Settings → Variables and Secrets に入れる：`GEMINI_API_KEY`（鍵）・`APP_TOKEN`（自分で決めた合言葉）・`ALLOWED_ORIGIN`（アプリのURL）
4. アプリの「AIの設定」→「本番」に Worker のURLと合言葉を入れる

### AIの流れ（どのファイルか）
- 「AIで作成」→ `ai/draft-service.js`：たたき台（simple-draft.js）→ Gemini（prompt.js → gemini.js）→ 確かめる（validate.js）→ よい方を使う
- AIがつながらない・エラーの時は、たたき台をそのまま使う（止まらない）
- 公開すると、AIの下書きから店長が直した所を覚える（`ai/learning.js`）。同じ直しが2回で「覚えた」になり、次から最初からそうする
- 覚えたことは「AIの設定」の下で見られる・消せる

## ルールチェックのテスト

```bash
node --test tests/*.test.mjs
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
│  │  ├─ mock-api.js       見本データで動く「にせものサーバー」
│  │  ├─ mock-store.js     見本データの保存場所・共通の道具
│  │  ├─ mock-calls.js     人が足りない時の自動連絡
│  │  ├─ mock-ai.js        AIの下書き・学び・人の追加
│  │  └─ mock-data.js      見本データ（スタッフA など）
│  ├─ rules/
│  │  ├─ shift-rules.js    ルールチェック（必要人数・立ち上げ・締め・休憩・希望・週1休み…）
│  │  └─ candidates.js     人が足りない時に「入れそうな人」をさがす
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
│  ├─ lib/                 小さな道具（立ち上げ・締めの決まり・時刻・日付・週・HTML要素づくり・元に戻す・休憩の決まり・スマホへの保存）
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
│     └─ settings.js       設定・ログアウト
├─ workers/ai-proxy/       Gemini の鍵をかくす中つぎ（Cloudflare Worker）
└─ tests/
   ├─ rules.test.mjs       ルールチェックの自動テスト
   ├─ breaks.test.mjs      休憩の決まりのテスト
   ├─ labor.test.mjs       働いた時間・人件費の目安のテスト
   └─ ai.test.mjs          AI（確かめ・学び・送る文・流れ・入れそうな人）のテスト
```

## 決まりごと（コードを書く時）

- 時刻は「0:00から何分か」で持つ（7:00＝420、22:00＝1320）。15分刻み
- 日付は `"2026-11-09"` の文字で持つ
- 画面のファイルは `api` 以外からデータを取らない（あとで本物に差し替えるため）
- 人の名前などを画面に出す時は `h()` を使う（`innerHTML` は使わない＝安全のため）
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

## 次にやること（ロードマップ）

1. 段階1：Supabase をつなぐ（`api/supabase-api.js` を作って `config.js` を切り替える）
2. Cloudflare Workers（アカウント作成・パスワードリセット・AI・通知）
4. プッシュ通知・バックアップ
