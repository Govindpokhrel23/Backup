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

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { screenHeader } from "../components/header.js";
import { getAiSettings, saveAiSettings, aiReady, workerReady } from "../ai/ai-settings.js";
import { testGemini } from "../ai/gemini.js";
import { summarize, LEARN_MIN_COUNT } from "../ai/learning.js";
import { CONFIG } from "../config.js";

/** モデルの選びかた（Google AI Studio の無料枠で使えるもの。2026年11月時点） */
const MODEL_CHOICES = [
  { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview（おすすめ・かしこい）" },
  { value: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite（速い・回数を多く使える）" },
];

/** AIの設定の画面を描く（店長） */
export async function renderAi(app) {
  let settings = getAiSettings();                                     // 今の設定
  let status = null;                                                  // 「試す」の結果 {ok, text}
  const [learnings, members] = await Promise.all([api.listLearnings(), api.listMembers()]);   // 保存してある学び と 店員（名前を出すため）
  let rows = learnings;                                               // 学び（消したら減る）
  draw();

  /** 画面を描く */
  function draw() {
    const ready = aiReady(settings);                                  // 使える設定か
    mount(app,
      screenHeader({ title: "AIの設定", sub: "シフトの下書きを作るAI（Gemini）" }),
      createElement("div", { class: "screen-body" },
        statusCard(ready),
        modeCard(),
        privacyCard(),
        learnCard(),
      ),
    );
  }

  /** ① 今の状態 */
  function statusCard(ready) {
    return createElement("section", { class: `card ai-status ${ready.ok ? "is-ok" : "is-ng"}` },
      createElement("div", { class: "ai-status__row" },
        createElement("span", { class: "ai-result__mark", "aria-hidden": "true" }, ready.ok ? "✓" : "!"),
        createElement("div", null,
          createElement("strong", null, ready.ok ? "AIを使う設定になっています" : "AIはまだ使えません"),
          createElement("div", { class: "home-muted" }, ready.ok ? `モデル：${settings.model}（${settings.mode === "worker" ? "Cloudflare Worker 経由" : "この機械から直接"}）` : `${ready.why}。それまでは簡易版で下書きを作ります`))),
      status ? createElement("div", { class: `notice ${status.ok ? "notice--ok" : "notice--danger"}` }, status.text) : null,
      ready.ok ? createElement("button", { class: "btn btn--small", onclick: runTest }, "つながるか試す") : null,
    );
  }

  /** ② つなぎ方 */
  function modeCard() {
    /** つなぎ方のボタン1つ */
    const modeBtn = (mode, title, text) => createElement("button", {
      class: "card menu-item mode-btn", "aria-pressed": String(settings.mode === mode),
      onclick: () => { settings = saveAiSettings({ mode }); status = null; draw(); },
    }, createElement("strong", null, title), createElement("span", { class: "home-muted" }, text));

    const key = createElement("input", { class: "input", type: "password", value: settings.apiKey, placeholder: "AIza… で始まる鍵", autocomplete: "off", "aria-label": "Gemini の鍵" });   // 鍵の欄
    // モデル：決まったものから選ぶ。ほかの名前も入れられる
    const known = MODEL_CHOICES.some((choice) => choice.value === settings.model);
    const model = createElement("select", { class: "select", "aria-label": "モデル" },   // モデルを選ぶ欄
      MODEL_CHOICES.map((choice) => createElement("option", { value: choice.value, selected: choice.value === settings.model }, choice.label)),
      createElement("option", { value: "__other", selected: !known }, "ほかの名前を入れる"));
    const modelOther = createElement("input", { class: "input", value: known ? "" : settings.model, placeholder: "例 gemini-3-flash", hidden: known, "aria-label": "モデルの名前" });   // ほかのモデルの名前を入れる欄
    model.addEventListener("change", () => { modelOther.hidden = model.value !== "__other"; });
    const showKey = createElement("button", { class: "btn btn--small", onclick: () => { key.type = key.type === "password" ? "text" : "password"; } }, "表示");   // 鍵を見せる／かくすボタン

    /** 保存ボタン */
    const saveBtn = createElement("button", { class: "btn btn--primary btn--block", onclick: () => {
      settings = saveAiSettings({
        apiKey: key.value.trim(),
        model: model.value === "__other" ? modelOther.value.trim() : model.value,
      });
      status = null;
      toast("保存しました");
      draw();
    } }, "保存する");

    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, "つなぎ方"),
      createElement("div", { class: "mode-list" },
        modeBtn("gemini", "今すぐ試す", "この機械から直接 Gemini を使う。鍵はこの機械にだけ保存"),
        modeBtn("worker", "本番（おすすめ）", "Cloudflare Worker を通す。鍵はサーバーにだけ置くので安全"),
        modeBtn("local", "AIを使わない", "簡易版だけで下書きを作る")),
      settings.mode === "gemini"
        ? createElement("div", { class: "mode-form" },
            createElement("label", { class: "field" }, "Gemini の鍵（API key）", createElement("div", { class: "time-range" }, key, showKey)),
            createElement("div", { class: "home-muted" }, "鍵は Google AI Studio（aistudio.google.com）の「Get API key」で無料で作れます。鍵はこの機械にだけ保存し、ほかの人に見せないでください。"),
            createElement("label", { class: "field" }, "モデル", model), modelOther,
            saveBtn)
        : settings.mode === "worker"
          ? createElement("div", { class: "mode-form" },
              workerReady()
                ? createElement("div", { class: "notice notice--ok" }, "サーバー（Cloudflare Worker）を通して使います。鍵はサーバーにあります")
                : createElement("div", { class: "notice notice--warn", style: { fontWeight: 400 } }, "まだ使えません。Supabase と Worker の準備をして、config.js に SUPABASE_URL と API_WORKER_URL を入れてください（README.md の「本番の準備」）"),
              createElement("label", { class: "field" }, "モデル", model), modelOther,
              saveBtn)
          : null,
    );
  }

  /** ③ 個人情報について */
  function privacyCard() {
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, "AIに送るもの・送らないもの"),
      createElement("ul", { class: "plain-list" },
        createElement("li", null, "名前は送りません。「S1」「S2」のような番号に置きかえます"),
        createElement("li", null, "時給・交通費・電話番号などは送りません"),
        createElement("li", null, "送るのは：立場・できること％・希望の時間・必要人数・営業時間・人ごとのルール（名前は番号にする）"),
        createElement("li", null, "Gemini の無料枠では、送った内容が Google のサービス改善に使われることがあります。気になる時は有料枠にしてください")),
    );
  }

  /** ④ AIが覚えたこと */
  function learnCard() {
    const sum = summarize(rows, members);                             // まとめた学び
    return createElement("section", { class: "card" },
      createElement("div", { class: "screen-header__row" },
        createElement("h2", { class: "card__title" }, `AIが覚えたこと（${sum.notes.filter((note) => note.strong).length}件）`),
        rows.length ? createElement("button", { class: "btn btn--small btn--danger", onclick: clearAll }, "全部わすれる") : null),
      createElement("div", { class: "home-muted" }, `シフトを公開すると、AIの下書きから店長が直した所を覚えます。同じ直しが${LEARN_MIN_COUNT}回あると「覚えた」になり、次の下書きから最初からそうします。`),
      sum.notes.length
        ? createElement("ul", { class: "learn-list" }, sum.notes.map((note) => createElement("li", { class: note.strong ? "is-strong" : "" },
            createElement("span", { class: `badge ${note.strong ? "badge--hall" : ""}` }, note.strong ? "覚えた" : "様子見"),
            createElement("span", { class: "learn-list__text" }, note.text),
            createElement("span", { class: "home-muted num" }, `${note.count}回`),
            createElement("button", { class: "btn btn--small", "aria-label": "わすれる", onclick: async () => {
              await api.deleteLearnings(note.ids);
              rows = rows.filter((row) => !note.ids.includes(row.id));
              toast("わすれました");
              draw();
            } }, "わすれる"))))
        : createElement("div", { class: "notice notice--info", style: { fontWeight: 400 } }, "まだ覚えたことはありません。「AIで作成」→ 直して → 公開 をくり返すと増えていきます"),
    );
  }

  /** 「つながるか試す」 */
  async function runTest() {
    status = { ok: true, text: "試しています…" };
    draw();
    try {
      const result = await testGemini(settings);   // 試した結果
      status = { ok: !!result.ok, text: result.ok ? `つながりました（${settings.model}）` : "返事はありましたが、形がちがいました" };
    } catch (error) {
      // 1つ目のモデルがだめなら、次のモデルも試してみる
      if (/このモデルは使えません/.test(error.message) && CONFIG.AI_MODEL_FALLBACK !== settings.model) {
        status = { ok: false, text: `${error.message}。「${CONFIG.AI_MODEL_FALLBACK}」に変えて、もう一度試してください` };
      } else {
        status = { ok: false, text: error.message };
      }
    }
    draw();
  }

  /** 「全部わすれる」 */
  async function clearAll() {
    const ok = await confirmDialog({ title: "AIが覚えたことを全部わすれますか？", body: createElement("p", { style: { margin: 0 } }, "この店舗の分だけ消えます。元には戻せません。"), yes: "全部わすれる", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;
    await api.deleteLearnings(rows.map((row) => row.id));
    rows = [];
    toast("全部わすれました");
    draw();
  }
}
