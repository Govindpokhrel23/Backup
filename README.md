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
│  └─ screens.css          画面ごとの見た目
├─ js/
│  ├─ main.js              最初に動く（ログインが残っているか確かめる）
│  ├─ config.js            設定（見本／本物の切り替え、営業時間、立場の名前など）
│  ├─ router.js            画面の切り替え・タブバー・店長だけの画面の制限
│  ├─ store.js             ログイン中の人
│  ├─ api/
│  │  ├─ index.js          データのやりとりの入口（画面はここだけを使う）
│  │  ├─ mock-api.js       見本データで動く「にせものサーバー」
│  │  └─ mock-data.js      見本データ（スタッフA など）
│  ├─ rules/
│  │  └─ shift-rules.js    ルールチェック（必要人数・立ち上げ・締め・休憩・希望・週1休み…）
│  ├─ ai/
│  │  └─ simple-draft.js   下書きを作る（今は簡易版。段階4で Gemini に入れ替え）
│  ├─ components/
│  │  ├─ header.js         画面の見出し
│  │  ├─ assignment-panel.js シフト作成の右の欄（1人分の勤務を直す）
│  │  ├─ my-shifts.js      自分のシフト（今日・明日・明後日…。ホームで使う）
│  │  ├─ day-list.js       その日の一覧（名前と何時から何時まで）
│  │  ├─ print-week.js     1週間のシフトを紙に印刷（お店に貼る用・PDFにも）
│  │  └─ timeline.js       シフト表（時間の目盛り＋線、ドラッグ）
│  ├─ lib/                 小さな道具（時刻・日付・週・HTML要素づくり・元に戻す・休憩の決まり・スマホへの保存）
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
│     └─ settings.js       設定・ログアウト
└─ tests/
   ├─ rules.test.mjs       ルールチェックの自動テスト
   ├─ breaks.test.mjs      休憩の決まりのテスト
   └─ labor.test.mjs       働いた時間・人件費の目安のテスト
```

## 決まりごと（コードを書く時）

- 時刻は「0:00から何分か」で持つ（7:00＝420、22:00＝1320）。15分刻み
- 日付は `"2026-11-09"` の文字で持つ
- 画面のファイルは `api` 以外からデータを取らない（あとで本物に差し替えるため）
- 人の名前などを画面に出す時は `h()` を使う（`innerHTML` は使わない＝安全のため）
- 希望は店長だけが見られる。人ごとのルールも店長だけ
- 店長は3店舗を切り替えて使う。どの画面も「今見ている店舗」（state.storeId）のデータを出す
- スタッフの「行ける店舗と順番」：メイン（1）・2nd・3rd。人が足りない時、AIは2nd・3rd の人を入れる
- 休憩は朝11:00より前に入れない（lib/breaks.js）
- 自分のシフトはスマホにも保存する（2年分。lib/offline-cache.js）
- 人件費の目安は lib/labor.js（休憩：6時間超45分・8時間超60分を引く、22:00〜翌5:00は1.25倍、交通費は1日1回、社員は入れない）
- シフト交代：本人が「お願い」→ 行ける人が「代わります」→ 店長が「承認」で入れ替わる

## 次にやること（ロードマップ）

1. 段階1：Supabase をつなぐ（`api/supabase-api.js` を作って `config.js` を切り替える）
2. Cloudflare Workers（アカウント作成・パスワードリセット・AI・通知）
3. Gemini で本物のAI下書き
4. プッシュ通知・バックアップ
