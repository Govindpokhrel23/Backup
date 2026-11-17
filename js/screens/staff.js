// ============================================================
// screens/staff.js — スタッフの登録・設定（店長）
// ------------------------------------------------------------
// このファイルは、スタッフの登録・設定（店長）のファイルです。
// アカウントを作る時に、店長がこれを決める（あとで変えられる）：
//   ・立場：社員／バイト／フルで入るバイト（F-45）
//   ・できること：ホール・キッチン・立ち上げ・締め を 0〜100％（F-46）
//   ・人ごとのルール：文章で自由に。店長だけが見られる（F-47）
//   ・行ける店舗と順番：メイン／2nd／3rd（2026年11月3日）
//     人が足りない時、2nd・3rd の人を AI がその店舗に入れる
// 作ると「ID」と「初回コード（6桁）」が出るので、本人に渡す。
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { state, isDeveloper } from "../store.js";   // アプリの状態・開発者か調べる道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む

/** 順番の呼び方 */
const rankWord = (rank) => ({ 1: "メイン", 2: "2nd", 3: "3rd" }[rank] || "");   // 順位の文字（1→メイン）

/** スタッフの登録・設定の画面を描く（店長） */
export async function renderStaff(app) {   // スタッフの登録・設定の画面を描く関数
  let members = await api.listMembers();   // この店舗で働ける人
  let rules = await api.listMemberRules();   // 人ごとのルール
  let wages = await api.listWages();          // 時給・交通費（店長だけ。人件費の目安に使う）
  let developers = await api.listDevelopers();   // 開発者アカウント（シフトには出ない。2026年11月12日）
  // 行ける店舗の選択には、営業している店舗だけを出す（休止した店舗は出さない）
  const stores = state.stores.filter((store) => store.active !== false);   // 営業中の店舗
  let editing = null;      // 直している店員（新しく作る時は "new"）

  draw();   // はじめに描く

  /** 画面を描く */
  function draw() {   // 画面を描く関数
    mount(app,   // 画面に入れる
      screenHeader({   // 見出し
        title: "スタッフの登録・設定",   // タイトル
        sub: `${members.filter((member) => member.active).length}人`,   // 人数
        right: createElement("button", { class: "btn btn--small btn--primary", onclick: () => { editing = "new"; draw(); } }, "＋ アカウント作成"),   // アカウントを作るボタン
      }),
      createElement("div", { class: "screen-body" },   // 本文
        editing ? form(editing === "new" ? null : members.find((member) => member.id === editing)) : null,   // 編集中なら入力の所
        ...["shain", "full", "baito"].map((kind) => group(kind)),   // 社員・フル・バイトのまとまり
        helpers(),   // 応援に来られる人
        developerCard(),   // 開発者アカウント
      ),
    );
  }

  /** 立場ごとのまとまり（社員を上に）。この店舗がメインの人だけ */
  function group(kind) {   // 立場ごとのまとまりを作る関数
    const list = members.filter((member) => member.kind === kind && member.rankHere === 1);   // その立場の人（この店舗がメイン）
    if (!list.length) return null;   // いなければ出さない
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, `${CONFIG.KIND_LABEL[kind]}（${list.length}人）`),   // 見出し（人数）
      list.map((member) => createElement("button", { class: `staff-row ${member.active ? "" : "is-stopped"}`, onclick: () => { editing = member.id; draw(); window.scrollTo(0, 0); } },   // 1人ずつ（押すと編集）
        createElement("div", null,   // 1行目
          createElement("strong", null, member.name), " ",   // 名前
          createElement("span", { class: "home-muted num" }, `ID ${member.loginId}`),   // ID
          member.role === "manager" ? createElement("span", { class: "badge", style: { marginLeft: "6px" } }, "店長") : null,   // 店長の印
          !member.active ? createElement("span", { class: "badge", style: { marginLeft: "6px", background: "var(--danger)" } }, "停止中") : null,   // 停止中の印
          // シフト作成の「人を追加」で登録して、まだアカウント（ログイン）がない人（2026年11月5日）
          member.account === "none" ? createElement("span", { class: "badge badge--warn", style: { marginLeft: "6px" } }, "アカウントなし") : null,   // アカウントなしの印
        ),
        createElement("div", { class: "home-muted" }, CONFIG.SKILLS.map((skill) => `${skill.label}${member.skills[skill.key]}`).join("・")),   // できること％
        createElement("div", { class: "home-muted" }, `行ける店舗：${storesText(member)}`),   // 行ける店舗
      )),
    );
  }

  /** ほかの店舗がメインで、この店舗に応援に来られる人（2nd・3rd） */
  function helpers() {   // 応援に来られる人のカードを作る関数
    const list = members.filter((member) => member.rankHere > 1);   // 応援に来られる人
    if (!list.length) return null;   // いなければ出さない
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, `応援に来られる人（${list.length}人）`),   // 見出し
      list.map((member) => createElement("button", { class: "staff-row", onclick: () => { editing = member.id; draw(); window.scrollTo(0, 0); } },   // 1人ずつ
        createElement("div", null, createElement("strong", null, member.name), " ", createElement("span", { class: "home-muted" }, `この店舗は ${rankWord(member.rankHere)}`)),   // 名前とID
        createElement("div", { class: "home-muted" }, `行ける店舗：${storesText(member)}`),   // 行ける店舗
      )),
    );
  }

  /** 「安城福釜店（メイン）・安城店（2nd）」の形 */
  function storesText(member) {   // 行ける店舗の文を作る関数
    return [...(member.stores || [{ storeId: member.storeId, rank: 1 }])]   // 働ける店舗
      .sort((storeRankA, storeRankB) => storeRankA.rank - storeRankB.rank)   // 順位の順
      .map((storeRank) => `${stores.find((store) => store.id === storeRank.storeId)?.short || ""}（${rankWord(storeRank.rank)}）`)   // 「福釜（メイン）」
      .join("・");   // ・でつなぐ
  }

  /** 作る／直すフォーム */
  function form(member) {   // 入力の所を作る関数
    // フォームの中の「今の入力」
    const draft = member   // 直している内容
      ? { ...member, skills: { ...member.skills }, rule: rules.find((rule) => rule.memberId === member.id)?.text || "",   // 今の情報・できること・メモ
          stores: (member.stores || [{ storeId: member.storeId, rank: 1 }]).map((storeRank) => ({ ...storeRank })),   // 働ける店舗
          hourly: wages.find((wage) => wage.memberId === member.id)?.hourly ?? 0,   // 時給
          transport: wages.find((wage) => wage.memberId === member.id)?.transport ?? 0,   // 交通費
          // 働き方のルール（2026年11月6日）
          minor: !!wages.find((wage) => wage.memberId === member.id)?.minor,                  // 18歳未満か
          monthHoursMax: wages.find((wage) => wage.memberId === member.id)?.monthHoursMax ?? "",   // 月の上限時間
          yearYenMax: wages.find((wage) => wage.memberId === member.id)?.yearYenMax ?? "" }       // 年の上限金額
      : { name: "", kind: "baito", everyday: false, skills: { hall: 0, kitchen: 0, open: 0, close: 0 }, rule: "",   // 新しい人のはじめの内容
          stores: [{ storeId: state.storeId, rank: 1 }], hourly: 1100, transport: 0, minor: false, monthHoursMax: "", yearYenMax: "" };   // 今の店舗がメイン・時給1100円

    const box = createElement("section", { class: "card staff-form" });   // フォームの入れ物
    /** フォームの中だけ描き直す */
    const redraw = () => mount(box, ...fields());   // 描きなおす関数
    redraw();   // はじめに描く
    return box;   // 返す

    /**
     * 行ける店舗と順番（メイン＝1、2nd、3rd、行かない）
     * 人が足りない時、2nd・3rd の人を AI がその店舗に入れる
     */
    function storeRanks() {   // 店舗と順番の欄を作る関数
      /** その店舗の順番（0＝行かない） */
      const rankOf = (id) => draft.stores.find((store) => store.storeId === id)?.rank ?? 0;   // その店舗の順位（行かないなら0）
      /** その店舗の順番を決める */
      const setRank = (id, rank) => {   // 順位を変える関数
        // 同じ順番は1店舗だけ。選んだ順番を持っていた店舗は「行かない」にする
        draft.stores = draft.stores.filter((storeRank) => storeRank.storeId !== id && (rank === 0 || storeRank.rank !== rank));   // その店舗と、同じ順位のほかの店舗を外す
        if (rank) draft.stores.push({ storeId: id, rank });   // 0でなければ足す
        redraw();   // 描きなおす
      };
      return createElement("div", { class: "field" }, "行ける店舗と順番（メインは1つ）",   // 欄
        stores.map((eachStore) => createElement("div", { class: "skill-row" },   // 店舗ごとに
          createElement("span", { class: "skill-row__label" }, eachStore.name),   // 店舗の名前
          createElement("div", { class: "chip-row" },   // ボタンの行
            [[1, "メイン"], [2, "2nd"], [3, "3rd"], [0, "行かない"]].map(([rank, text]) =>   // メイン・2nd・3rd・行かない
              createElement("button", { class: "chip chip--small", "aria-pressed": String(rankOf(eachStore.id) === rank), onclick: () => setRank(eachStore.id, rank) }, text))),   // ボタン
        )));
    }

    /** フォームの中身 */
    function fields() {   // 入力の所の中身を作る関数
      const name = createElement("input", { class: "input", value: draft.name, placeholder: "名前", oninput: (event) => { draft.name = event.target.value; } });   // 名前の欄
      return [   // 返す
        createElement("h2", { class: "card__title" }, member ? `${member.name} を直す` : "アカウントを作る"),   // 見出し
        createElement("label", { class: "field" }, "名前", name),   // 名前

        createElement("div", { class: "field" }, "立場",   // 立場
          createElement("div", { class: "chip-row" },   // ボタンの行
            Object.entries(CONFIG.KIND_LABEL).map(([key, text]) =>   // 立場ごとに
              createElement("button", { class: "chip", "aria-pressed": String(draft.kind === key), onclick: () => { draft.kind = key; redraw(); } }, text)))),   // ボタン

        createElement("label", { class: "check" },   // 毎日入るか
          createElement("input", { type: "checkbox", checked: draft.everyday, onchange: (event) => { draft.everyday = event.target.checked; } }),   // チェック
          "毎日入ってくれる人（優先順①）"),   // 文字

        createElement("div", { class: "field" }, "できること（一人でどこまでできるか）",   // できること％
          CONFIG.SKILLS.map((skill) => createElement("div", { class: "skill-row" },   // 種類ごとに
            createElement("span", { class: "skill-row__label" }, skill.label),   // 名前
            createElement("div", { class: "chip-row" },   // ボタンの行
              CONFIG.SKILL_LEVELS.map((level) =>   // 0〜100%
                createElement("button", { class: "chip chip--small", "aria-pressed": String(draft.skills[skill.key] === level), onclick: () => { draft.skills[skill.key] = level; redraw(); } }, `${level}%`))),   // ボタン
          ))),

        storeRanks(),   // 店舗と順番

        // 時給・交通費：人件費の目安に使う（店長だけが見られる。社員は0にしておく）
        createElement("div", { class: "field" }, "時給・交通費（店長だけが見られる。社員は0）",   // 時給・交通費
          createElement("div", { class: "time-range" },   // 横に並べる
            createElement("label", { class: "field", style: { flex: 1 } }, "時給（円）",   // 時給
              createElement("input", { class: "input num", type: "number", min: "0", step: "10", value: String(draft.hourly), oninput: (event) => { draft.hourly = event.target.value; } })),   // 時給の欄
            createElement("label", { class: "field", style: { flex: 1 } }, "交通費（1日・円）",   // 交通費
              createElement("input", { class: "input num", type: "number", min: "0", step: "10", value: String(draft.transport), oninput: (event) => { draft.transport = event.target.value; } })),   // 交通費の欄
          )),

        // 働き方のルール（店長だけが見られる）：シフト作成のチェックとAIが守る（rules/labor-rules.js）
        createElement("div", { class: "field" }, "働き方のルール（店長だけが見られる。空なら決めない）",   // 働き方のルール
          createElement("label", { class: "check-line" },   // 18歳未満
            createElement("input", { type: "checkbox", checked: draft.minor, onchange: (event) => { draft.minor = event.target.checked; } }),   // チェック
            "18歳未満（22時〜朝5時は入れない）"),   // 文字
          createElement("div", { class: "time-range" },   // 横に並べる
            createElement("label", { class: "field", style: { flex: 1 } }, "月の上限（時間）",   // 月の上限
              createElement("input", { class: "input num", type: "number", min: "0", step: "1", placeholder: "例 80", value: String(draft.monthHoursMax), oninput: (event) => { draft.monthHoursMax = event.target.value; } })),   // 月の上限の欄
            createElement("label", { class: "field", style: { flex: 1 } }, "年の上限（円・扶養など）",   // 年の上限
              createElement("input", { class: "input num", type: "number", min: "0", step: "10000", placeholder: "例 1030000", value: String(draft.yearYenMax), oninput: (event) => { draft.yearYenMax = event.target.value; } })),   // 年の上限の欄
          ),
          createElement("div", { class: "home-muted" }, "年の上限は「時給×時間＋交通費」の目安で数えます。上限の金額は本人と決めてください")),   // 説明

        createElement("label", { class: "field" }, "人ごとのルール（店長だけが見られる）",   // 人ごとのルールのメモ
          createElement("textarea", { class: "textarea", placeholder: "例：土曜はNG、週20時間まで", oninput: (event) => { draft.rule = event.target.value; } }, draft.rule)),   // メモの欄

        createElement("div", { class: "chip-row" },   // ボタンの行
          createElement("button", { class: "btn btn--primary", onclick: () => save(member, draft) }, member ? "保存" : "作成して初回コードを出す"),   // 保存・作る
          createElement("button", { class: "btn", onclick: () => { editing = null; draw(); } }, "閉じる"),   // 閉じる
        ),

        // 店員は店長が直す。店長のパスワードは開発者がリセットできる（店長が忘れた時用。2026年11月12日）
        member && (member.role !== "manager" || (isDeveloper() && member.id !== state.user.id))   // 直す時（店員、または開発者が見る店長）
          ? createElement("div", { class: "chip-row" },   // ボタンの行
              // アカウントがない人は「アカウントを作る」（初回コードを出す）。ある人は「パスワードをリセット」
              createElement("button", { class: `btn btn--small ${member.account === "none" ? "btn--primary" : ""}`, onclick: () => reset(member) },   // アカウントを作る・パスワードをリセット
                member.account === "none" ? "アカウントを作る（初回コードを出す）" : "パスワードをリセット"),   // 文字
              member.role !== "manager"   // 店長は止めない（開発者がまちがえて止めないように）
                ? createElement("button", { class: "btn btn--small btn--danger", onclick: () => toggleActive(member) }, member.active ? "停止する（やめた人）" : "再開する")   // 停止・再開
                : null,   // 店長には出さない
            )
          : null,   // 新しい時は出さない
      ];
    }
  }

  /** 保存（新しい人なら作って、初回コードを見せる） */
  async function save(member, draft) {   // 保存する関数
    if (!draft.name.trim()) { toast("名前を入れてください"); return; }   // 名前がなければ止める
    if (!draft.stores.some((storeRank) => storeRank.rank === 1)) { toast("メインの店舗を1つ選んでください"); return; }   // メインの店舗がなければ止める
    const data = { name: draft.name.trim(), kind: draft.kind, everyday: draft.everyday, skills: draft.skills, stores: draft.stores };   // 保存する中身
    if (member) {   // 直す時
      await api.saveMember({ ...member, ...data });   // 店員を保存
      await api.saveMemberRule(member.id, draft.rule);   // メモを保存
      await api.saveWage(member.id, draft.hourly, draft.transport, draft);   // 時給とルールを保存
      toast("保存しました");   // お知らせ
    } else {   // 新しい時
      const { member: created, code } = await api.createMember(data);   // 作る
      await api.saveMemberRule(created.id, draft.rule);   // メモを保存
      await api.saveWage(created.id, draft.hourly, draft.transport, draft);   // 時給とルールを保存
      await showCode(created.name, created.loginId, code);   // 初回コードを見せる
    }
    members = await api.listMembers();   // 店員を読みなおす
    rules = await api.listMemberRules();   // メモを読みなおす
    wages = await api.listWages();   // 時給を読みなおす
    editing = null;   // 編集を閉じる
    draw();   // 描きなおす
  }

  /**
   * 開発者アカウントのカード（2026年11月12日）
   * 開発者＝アプリを直す人。店長と同じことができるが、シフト・店員の一覧には出ない
   * 店長はここで止められる（止めると、その人はログインできなくなる）
   */
  function developerCard() {   // 開発者のカードを作る関数
    if (!developers.length) return null;   // いなければ出さない
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, "開発者（アプリを直す人）"),   // 見出し
      createElement("div", { class: "home-muted" }, "店長と同じことができます。シフトには出ません。"),   // 説明
      developers.map((developer) => createElement("div", { class: "staff-row" },   // 1人ずつ
        createElement("div", { class: "staff-row__name" },   // 名前の所
          createElement("strong", null, developer.name), ` ID ${developer.loginId}`,   // 名前とID
          developer.active ? null : createElement("span", { class: "badge", style: { marginLeft: "6px" } }, "停止中")),   // 止めていれば印
        // 2026年11月17日：「停止する」ボタンは出さない（店長の希望）。前に止めてあった時だけ「再開する」を出す
        developer.active || developer.id === state.user.id   // 動いている・自分なら
          ? null   // ボタンなし
          : createElement("button", { class: "btn btn--small", onclick: async () => {   // 再開のボタン
              await api.saveMember({ ...developer, active: true });   // 保存
              developers = await api.listDevelopers();   // 読みなおす
              toast("再開しました");   // お知らせ
              draw();   // 描きなおす
            } }, "再開する"))));   // ボタンの文字
  }

  /** パスワードのリセット／アカウントを作る：新しい初回コードを出して見せる */
  async function reset(member) {   // アカウントを作る・パスワードをリセットする関数
    const { loginId, code } = await api.resetPassword(member.id);   // IDと新しい初回コード
    await showCode(member.name, loginId, code);   // 初回コードを見せる
    members = await api.listMembers();                       // 「アカウントなし」の印を消すため読み直す
    draw();   // 描きなおす
  }

  /** 停止する／再開する */
  async function toggleActive(member) {   // 停止・再開する関数
    await api.saveMember({ ...member, active: !member.active });   // 保存
    members = await api.listMembers();   // 読みなおす
    editing = null;   // 編集を閉じる
    toast(member.active ? "停止しました" : "再開しました");   // お知らせ
    draw();   // 描きなおす
  }

  /** 本人に渡す ID と初回コードを見せる */
  function showCode(name, loginId, code) {   // 初回コードを見せる関数
    return confirmDialog({   // 小さい画面で出す
      title: `${name}さんに渡してください`,   // タイトル
      body: createElement("div", { class: "code-box" },   // 中身
        createElement("div", null, "ID", createElement("strong", { class: "num" }, loginId)),   // ID
        createElement("div", null, "初回コード", createElement("strong", { class: "num" }, code)),   // 初回コード
        createElement("p", { class: "home-muted", style: { margin: 0 } }, "本人がログイン画面の「はじめての方」で入れて、自分のパスワードを決めます。コードは1回だけ使えます。"),   // 説明
      ),
      yes: "OK（メモしました）", no: null,   // OK ボタンだけ
    });
  }
}
