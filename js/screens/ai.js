// ============================================================
// screens/ai.js — AIの設定と「AIが覚えたこと」（店長）
// ------------------------------------------------------------
// このファイルは、AI（Gemini）のつなぎ方を決める画面と、
// 店長の直し方からAIが覚えたことを見て・消す画面のファイルです（2026年11月5日）。
//
// 上から：
//   ① 今の状態（つながっているか）と「試す」ボタン
//   ② つなぎ方：今すぐ試す（この機械に鍵）／本番（Cloudflare Worker）／使わない
//   ③ 個人情報について（名前は送らない など）
//   ④ AIが覚えたこと（2回以上＝覚えた、1回＝様子見）。いらないものは消せる
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { getAiSettings, saveAiSettings, aiReady, workerReady } from "../ai/ai-settings.js";   // AIの設定の道具を読む
import { testGemini } from "../ai/gemini.js";   // つながるか試す道具を読む
import { summarize, LEARN_MIN_COUNT } from "../ai/learning.js";   // 覚えたことをまとめる道具を読む
import { CONFIG } from "../config.js";   // 設定を読む

/** モデルの選びかた（Google AI Studio の無料枠で使えるもの。2026年11月時点） */
const MODEL_CHOICES = [   // 選べるモデル
  { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview（おすすめ・かしこい）" },   // かしこい方
  { value: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite（速い・回数を多く使える）" },   // 速い方
];

/** AIの設定の画面を描く（店長） */
export async function renderAi(app) {   // AIの設定の画面を描く関数
  let settings = getAiSettings();                                     // 今の設定
  let status = null;                                                  // 「試す」の結果 {ok, text}
  const [learnings, members] = await Promise.all([api.listLearnings(), api.listMembers()]);   // 保存してある学び と 店員（名前を出すため）
  let rows = learnings;                                               // 学び（消したら減る）
  draw();   // はじめに描く

  /** 画面を描く */
  function draw() {   // 画面を描く関数
    const ready = aiReady(settings);                                  // 使える設定か
    mount(app,   // 画面に入れる
      screenHeader({ title: "AIの設定", sub: "シフトの下書きを作るAI（Gemini）" }),   // 見出し
      createElement("div", { class: "screen-body" },   // 本文
        statusCard(ready),   // 今の状態のカード
        modeCard(),   // つなぎ方のカード
        privacyCard(),   // 送るもののカード
        learnCard(),   // 覚えたことのカード
      ),
    );
  }

  /** ① 今の状態 */
  function statusCard(ready) {   // 今の状態のカードを作る関数
    return createElement("section", { class: `card ai-status ${ready.ok ? "is-ok" : "is-ng"}` },   // カード（使えれば緑）
      createElement("div", { class: "ai-status__row" },   // 上の行
        createElement("span", { class: "ai-result__mark", "aria-hidden": "true" }, ready.ok ? "✓" : "!"),   // ✓ か !
        createElement("div", null,   // 文の部分
          createElement("strong", null, ready.ok ? "AIを使う設定になっています" : "AIはまだ使えません"),   // 使えるか
          createElement("div", { class: "home-muted" }, ready.ok ? `モデル：${settings.model}（${settings.mode === "worker" ? "Cloudflare Worker 経由" : "この機械から直接"}）` : `${ready.why}。それまでは簡易版で下書きを作ります`))),   // モデルとつなぎ方、または使えない理由
      status ? createElement("div", { class: `notice ${status.ok ? "notice--ok" : "notice--danger"}` }, status.text) : null,   // 試した結果
      ready.ok ? createElement("button", { class: "btn btn--small", onclick: runTest }, "つながるか試す") : null,   // 試すボタン
    );
  }

  /** ② つなぎ方 */
  function modeCard() {   // つなぎ方のカードを作る関数
    /** つなぎ方のボタン1つ */
    const modeBtn = (mode, title, text) => createElement("button", {   // つなぎ方を選ぶボタンを作る
      class: "card menu-item mode-btn", "aria-pressed": String(settings.mode === mode),   // 見た目・選んでいるか
      onclick: () => { settings = saveAiSettings({ mode }); status = null; draw(); },   // 押したら保存して描きなおす
    }, createElement("strong", null, title), createElement("span", { class: "home-muted" }, text));   // 名前と説明

    const key = createElement("input", { class: "input", type: "password", value: settings.apiKey, placeholder: "AIza… で始まる鍵", autocomplete: "off", "aria-label": "Gemini の鍵" });   // 鍵の欄
    // モデル：決まったものから選ぶ。ほかの名前も入れられる
    const known = MODEL_CHOICES.some((choice) => choice.value === settings.model);   // 今のモデルが一覧にあるか
    const model = createElement("select", { class: "select", "aria-label": "モデル" },   // モデルを選ぶ欄
      MODEL_CHOICES.map((choice) => createElement("option", { value: choice.value, selected: choice.value === settings.model }, choice.label)),   // 一覧のモデル
      createElement("option", { value: "__other", selected: !known }, "ほかの名前を入れる"));   // 自分で名前を入れる
    const modelOther = createElement("input", { class: "input", value: known ? "" : settings.model, placeholder: "例 gemini-3-flash", hidden: known, "aria-label": "モデルの名前" });   // ほかのモデルの名前を入れる欄
    model.addEventListener("change", () => { modelOther.hidden = model.value !== "__other"; });   // 「ほか」を選んだら名前の欄を出す
    const showKey = createElement("button", { class: "btn btn--small", onclick: () => { key.type = key.type === "password" ? "text" : "password"; } }, "表示");   // 鍵を見せる／かくすボタン

    /** 保存ボタン */
    const saveBtn = createElement("button", { class: "btn btn--primary btn--block", onclick: () => {   // 保存ボタン
      settings = saveAiSettings({   // 保存する
        apiKey: key.value.trim(),   // 鍵
        model: model.value === "__other" ? modelOther.value.trim() : model.value,   // モデル
      });
      status = null;   // 試した結果を消す
      toast("保存しました");   // お知らせ
      draw();   // 描きなおす
    } }, "保存する");   // ボタンの文字

    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, "つなぎ方"),   // 見出し
      createElement("div", { class: "mode-list" },   // つなぎ方のボタン
        workerReady() ? null : modeBtn("gemini", "今すぐ試す", "この機械から直接 Gemini を使う。鍵はこの機械にだけ保存"),   // 直接 Gemini（本番では出さない。鍵をスマホに置かないため）
        modeBtn("worker", "本番（おすすめ）", "Cloudflare Worker を通す。鍵はサーバーにだけ置くので安全"),   // Worker を通す
        modeBtn("local", "AIを使わない", "簡易版だけで下書きを作る")),   // AIを使わない
      settings.mode === "gemini"   // 直接 Gemini なら
        ? createElement("div", { class: "mode-form" },   // 入力欄
            createElement("label", { class: "field" }, "Gemini の鍵（API key）", createElement("div", { class: "time-range" }, key, showKey)),   // 鍵の欄
            createElement("div", { class: "home-muted" }, "鍵は Google AI Studio（aistudio.google.com）の「Get API key」で無料で作れます。鍵はこの機械にだけ保存し、ほかの人に見せないでください。"),   // 鍵のもらい方
            createElement("label", { class: "field" }, "モデル", model), modelOther,   // モデルの欄
            saveBtn)   // 保存ボタン
        : settings.mode === "worker"   // Worker なら
          ? createElement("div", { class: "mode-form" },   // 入力欄
              workerReady()   // 準備できていれば
                ? createElement("div", { class: "notice notice--ok" }, "サーバー（Cloudflare Worker）を通して使います。鍵はサーバーにあります")   // OK の説明
                : createElement("div", { class: "notice notice--warn", style: { fontWeight: 400 } }, "まだ使えません。Supabase と Worker の準備をして、config.js に SUPABASE_URL と API_WORKER_URL を入れてください（README.md の「本番の準備」）"),   // まだなら注意
              createElement("label", { class: "field" }, "モデル", model), modelOther,   // モデルの欄
              saveBtn)   // 保存ボタン
          : null,   // AIを使わないなら何も出さない
    );
  }

  /** ③ 個人情報について */
  function privacyCard() {   // 送るもののカードを作る関数
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, "AIに送るもの・送らないもの"),   // 見出し
      createElement("ul", { class: "plain-list" },   // 一覧
        createElement("li", null, "名前は送りません。「S1」「S2」のような番号に置きかえます"),   // 名前は送らない
        createElement("li", null, "時給・交通費・電話番号などは送りません"),   // 時給などは送らない
        createElement("li", null, "送るのは：立場・できること％・希望の時間・必要人数・営業時間・人ごとのルール（名前は番号にする）"),   // 送るもの
        createElement("li", null, "Gemini の無料枠では、送った内容が Google のサービス改善に使われることがあります。気になる時は有料枠にしてください")),   // 無料枠の注意
    );
  }

  /** ④ AIが覚えたこと */
  function learnCard() {   // 覚えたことのカードを作る関数
    const sum = summarize(rows, members);                             // まとめた学び
    return createElement("section", { class: "card" },   // カード
      createElement("div", { class: "screen-header__row" },   // 上の行
        createElement("h2", { class: "card__title" }, `AIが覚えたこと（${sum.notes.filter((note) => note.strong).length}件）`),   // 見出し（覚えた数）
        rows.length ? createElement("button", { class: "btn btn--small btn--danger", onclick: clearAll }, "全部わすれる") : null),   // 全部わすれるボタン
      createElement("div", { class: "home-muted" }, `シフトを公開すると、AIの下書きから店長が直した所を覚えます。同じ直しが${LEARN_MIN_COUNT}回あると「覚えた」になり、次の下書きから最初からそうします。`),   // 説明
      sum.notes.length   // あれば一覧
        ? createElement("ul", { class: "learn-list" }, sum.notes.map((note) => createElement("li", { class: note.strong ? "is-strong" : "" },   // 1つずつ
            createElement("span", { class: `badge ${note.strong ? "badge--hall" : ""}` }, note.strong ? "覚えた" : "様子見"),   // 覚えた・様子見の印
            createElement("span", { class: "learn-list__text" }, note.text),   // 説明
            createElement("span", { class: "home-muted num" }, `${note.count}回`),   // 回数
            createElement("button", { class: "btn btn--small", "aria-label": "わすれる", onclick: async () => {   // わすれるボタン
              await api.deleteLearnings(note.ids);   // 消す
              rows = rows.filter((row) => !note.ids.includes(row.id));   // 画面の一覧からも消す
              toast("わすれました");   // お知らせ
              draw();   // 描きなおす
            } }, "わすれる"))))   // ボタンの文字
        : createElement("div", { class: "notice notice--info", style: { fontWeight: 400 } }, "まだ覚えたことはありません。「AIで作成」→ 直して → 公開 をくり返すと増えていきます"),   // ない時の文
    );
  }

  /** 「つながるか試す」 */
  async function runTest() {   // つながるか試す関数
    status = { ok: true, text: "試しています…" };   // 試している途中の文
    draw();   // 描く
    try {   // 失敗しても止まらないように
      const result = await testGemini(settings);   // 試した結果
      status = { ok: !!result.ok, text: result.ok ? `つながりました（${settings.model}）` : "返事はありましたが、形がちがいました" };   // 結果
    } catch (error) {   // 失敗した時
      // 1つ目のモデルがだめなら、次のモデルも試してみる
      if (/このモデルは使えません/.test(error.message) && CONFIG.AI_MODEL_FALLBACK !== settings.model) {   // モデルが使えなければ
        status = { ok: false, text: `${error.message}。「${CONFIG.AI_MODEL_FALLBACK}」に変えて、もう一度試してください` };   // 軽いモデルをすすめる
      } else {   // それ以外
        status = { ok: false, text: error.message };   // エラーの文
      }
    }
    draw();   // 描く
  }

  /** 「全部わすれる」 */
  async function clearAll() {   // 全部わすれる関数
    const ok = await confirmDialog({ title: "AIが覚えたことを全部わすれますか？", body: createElement("p", { style: { margin: 0 } }, "この店舗の分だけ消えます。元には戻せません。"), yes: "全部わすれる", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;   // 「いいえ」なら止める
    await api.deleteLearnings(rows.map((row) => row.id));   // 全部消す
    rows = [];   // 画面の一覧も空に
    toast("全部わすれました");   // お知らせ
    draw();   // 描きなおす
  }
}
