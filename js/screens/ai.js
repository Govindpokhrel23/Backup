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

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
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
      h("div", { class: "screen-body" },
        statusCard(ready),
        modeCard(),
        privacyCard(),
        learnCard(),
      ),
    );
  }

  /** ① 今の状態 */
  function statusCard(ready) {
    return h("section", { class: `card ai-status ${ready.ok ? "is-ok" : "is-ng"}` },
      h("div", { class: "ai-status__row" },
        h("span", { class: "ai-result__mark", "aria-hidden": "true" }, ready.ok ? "✓" : "!"),
        h("div", null,
          h("strong", null, ready.ok ? "AIを使う設定になっています" : "AIはまだ使えません"),
          h("div", { class: "home-muted" }, ready.ok ? `モデル：${settings.model}（${settings.mode === "worker" ? "Cloudflare Worker 経由" : "この機械から直接"}）` : `${ready.why}。それまでは簡易版で下書きを作ります`))),
      status ? h("div", { class: `notice ${status.ok ? "notice--ok" : "notice--danger"}` }, status.text) : null,
      ready.ok ? h("button", { class: "btn btn--small", onclick: runTest }, "つながるか試す") : null,
    );
  }

  /** ② つなぎ方 */
  function modeCard() {
    /** つなぎ方のボタン1つ */
    const modeBtn = (mode, title, text) => h("button", {
      class: "card menu-item mode-btn", "aria-pressed": String(settings.mode === mode),
      onclick: () => { settings = saveAiSettings({ mode }); status = null; draw(); },
    }, h("strong", null, title), h("span", { class: "home-muted" }, text));

    const key = h("input", { class: "input", type: "password", value: settings.apiKey, placeholder: "AIza… で始まる鍵", autocomplete: "off", "aria-label": "Gemini の鍵" });   // 鍵の欄
    // モデル：決まったものから選ぶ。ほかの名前も入れられる
    const known = MODEL_CHOICES.some((m) => m.value === settings.model);
    const model = h("select", { class: "select", "aria-label": "モデル" },   // モデルを選ぶ欄
      MODEL_CHOICES.map((m) => h("option", { value: m.value, selected: m.value === settings.model }, m.label)),
      h("option", { value: "__other", selected: !known }, "ほかの名前を入れる"));
    const modelOther = h("input", { class: "input", value: known ? "" : settings.model, placeholder: "例 gemini-3-flash", hidden: known, "aria-label": "モデルの名前" });   // ほかのモデルの名前を入れる欄
    model.addEventListener("change", () => { modelOther.hidden = model.value !== "__other"; });
    const showKey = h("button", { class: "btn btn--small", onclick: () => { key.type = key.type === "password" ? "text" : "password"; } }, "表示");   // 鍵を見せる／かくすボタン

    /** 保存ボタン */
    const saveBtn = h("button", { class: "btn btn--primary btn--block", onclick: () => {
      settings = saveAiSettings({
        apiKey: key.value.trim(),
        model: model.value === "__other" ? modelOther.value.trim() : model.value,
      });
      status = null;
      toast("保存しました");
      draw();
    } }, "保存する");

    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, "つなぎ方"),
      h("div", { class: "mode-list" },
        modeBtn("gemini", "今すぐ試す", "この機械から直接 Gemini を使う。鍵はこの機械にだけ保存"),
        modeBtn("worker", "本番（おすすめ）", "Cloudflare Worker を通す。鍵はサーバーにだけ置くので安全"),
        modeBtn("local", "AIを使わない", "簡易版だけで下書きを作る")),
      settings.mode === "gemini"
        ? h("div", { class: "mode-form" },
            h("label", { class: "field" }, "Gemini の鍵（API key）", h("div", { class: "time-range" }, key, showKey)),
            h("div", { class: "home-muted" }, "鍵は Google AI Studio（aistudio.google.com）の「Get API key」で無料で作れます。鍵はこの機械にだけ保存し、ほかの人に見せないでください。"),
            h("label", { class: "field" }, "モデル", model), modelOther,
            saveBtn)
        : settings.mode === "worker"
          ? h("div", { class: "mode-form" },
              workerReady()
                ? h("div", { class: "notice notice--ok" }, "サーバー（Cloudflare Worker）を通して使います。鍵はサーバーにあります")
                : h("div", { class: "notice notice--warn", style: { fontWeight: 400 } }, "まだ使えません。Supabase と Worker の準備をして、config.js に SUPABASE_URL と API_WORKER_URL を入れてください（README.md の「本番の準備」）"),
              h("label", { class: "field" }, "モデル", model), modelOther,
              saveBtn)
          : null,
    );
  }

  /** ③ 個人情報について */
  function privacyCard() {
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, "AIに送るもの・送らないもの"),
      h("ul", { class: "plain-list" },
        h("li", null, "名前は送りません。「S1」「S2」のような番号に置きかえます"),
        h("li", null, "時給・交通費・電話番号などは送りません"),
        h("li", null, "送るのは：立場・できること％・希望の時間・必要人数・営業時間・人ごとのルール（名前は番号にする）"),
        h("li", null, "Gemini の無料枠では、送った内容が Google のサービス改善に使われることがあります。気になる時は有料枠にしてください")),
    );
  }

  /** ④ AIが覚えたこと */
  function learnCard() {
    const sum = summarize(rows, members);                             // まとめた学び
    return h("section", { class: "card" },
      h("div", { class: "screen-header__row" },
        h("h2", { class: "card__title" }, `AIが覚えたこと（${sum.notes.filter((n) => n.strong).length}件）`),
        rows.length ? h("button", { class: "btn btn--small btn--danger", onclick: clearAll }, "全部わすれる") : null),
      h("div", { class: "home-muted" }, `シフトを公開すると、AIの下書きから店長が直した所を覚えます。同じ直しが${LEARN_MIN_COUNT}回あると「覚えた」になり、次の下書きから最初からそうします。`),
      sum.notes.length
        ? h("ul", { class: "learn-list" }, sum.notes.map((n) => h("li", { class: n.strong ? "is-strong" : "" },
            h("span", { class: `badge ${n.strong ? "badge--hall" : ""}` }, n.strong ? "覚えた" : "様子見"),
            h("span", { class: "learn-list__text" }, n.text),
            h("span", { class: "home-muted num" }, `${n.count}回`),
            h("button", { class: "btn btn--small", "aria-label": "わすれる", onclick: async () => {
              await api.deleteLearnings(n.ids);
              rows = rows.filter((r) => !n.ids.includes(r.id));
              toast("わすれました");
              draw();
            } }, "わすれる"))))
        : h("div", { class: "notice notice--info", style: { fontWeight: 400 } }, "まだ覚えたことはありません。「AIで作成」→ 直して → 公開 をくり返すと増えていきます"),
    );
  }

  /** 「つながるか試す」 */
  async function runTest() {
    status = { ok: true, text: "試しています…" };
    draw();
    try {
      const r = await testGemini(settings);   // 試した結果
      status = { ok: !!r.ok, text: r.ok ? `つながりました（${settings.model}）` : "返事はありましたが、形がちがいました" };
    } catch (e) {
      // 1つ目のモデルがだめなら、次のモデルも試してみる
      if (/このモデルは使えません/.test(e.message) && CONFIG.AI_MODEL_FALLBACK !== settings.model) {
        status = { ok: false, text: `${e.message}。「${CONFIG.AI_MODEL_FALLBACK}」に変えて、もう一度試してください` };
      } else {
        status = { ok: false, text: e.message };
      }
    }
    draw();
  }

  /** 「全部わすれる」 */
  async function clearAll() {
    const ok = await confirmDialog({ title: "AIが覚えたことを全部わすれますか？", body: h("p", { style: { margin: 0 } }, "この店舗の分だけ消えます。元には戻せません。"), yes: "全部わすれる", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;
    await api.deleteLearnings(rows.map((r) => r.id));
    rows = [];
    toast("全部わすれました");
    draw();
  }
}
