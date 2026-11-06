// ============================================================
// screens/staff.js — 店員管理（店長）
// ------------------------------------------------------------
// このファイルは、店員管理（店長）のファイルです。
// アカウントを作る時に、店長がこれを決める（あとで変えられる）：
//   ・立場：社員／バイト／フルで入るバイト（F-45）
//   ・できること：ホール・キッチン・立ち上げ・締め を 0〜100％（F-46）
//   ・人ごとのルール：文章で自由に。店長だけが見られる（F-47）
//   ・行ける店舗と順番：メイン／2nd／3rd（2026年11月3日）
//     人が足りない時、2nd・3rd の人を AI がその店舗に入れる
// 作ると「ID」と「初回コード（6桁）」が出るので、本人に渡す。
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { CONFIG } from "../config.js";
import { state } from "../store.js";
import { screenHeader } from "../components/header.js";

/** 順番の呼び方 */
const rankWord = (rank) => ({ 1: "メイン", 2: "2nd", 3: "3rd" }[rank] || "");

/** 店員管理の画面を描く（店長） */
export async function renderStaff(app) {
  let members = await api.listMembers();   // この店舗で働ける人
  let rules = await api.listMemberRules();   // 人ごとのルール
  let wages = await api.listWages();          // 時給・交通費（店長だけ。人件費の目安に使う）
  // 行ける店舗の選択には、営業している店舗だけを出す（休止した店舗は出さない）
  const stores = state.stores.filter((store) => store.active !== false);
  let editing = null;      // 直している店員（新しく作る時は "new"）

  draw();

  /** 画面を描く */
  function draw() {
    mount(app,
      screenHeader({
        title: "店員管理",
        sub: `${members.filter((member) => member.active).length}人`,
        right: createElement("button", { class: "btn btn--small btn--primary", onclick: () => { editing = "new"; draw(); } }, "＋ アカウント作成"),
      }),
      createElement("div", { class: "screen-body" },
        editing ? form(editing === "new" ? null : members.find((member) => member.id === editing)) : null,
        ...["shain", "full", "baito"].map((kind) => group(kind)),
        helpers(),
      ),
    );
  }

  /** 立場ごとのまとまり（社員を上に）。この店舗がメインの人だけ */
  function group(kind) {
    const list = members.filter((member) => member.kind === kind && member.rankHere === 1);   // その立場の人（この店舗がメイン）
    if (!list.length) return null;
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, `${CONFIG.KIND_LABEL[kind]}（${list.length}人）`),
      list.map((member) => createElement("button", { class: `staff-row ${member.active ? "" : "is-stopped"}`, onclick: () => { editing = member.id; draw(); window.scrollTo(0, 0); } },
        createElement("div", null,
          createElement("strong", null, member.name), " ",
          createElement("span", { class: "home-muted num" }, `ID ${member.loginId}`),
          member.role === "manager" ? createElement("span", { class: "badge", style: { marginLeft: "6px" } }, "店長") : null,
          !member.active ? createElement("span", { class: "badge", style: { marginLeft: "6px", background: "var(--danger)" } }, "停止中") : null,
          // シフト作成の「人を追加」で登録して、まだアカウント（ログイン）がない人（2026年11月5日）
          member.account === "none" ? createElement("span", { class: "badge badge--warn", style: { marginLeft: "6px" } }, "アカウントなし") : null,
        ),
        createElement("div", { class: "home-muted" }, CONFIG.SKILLS.map((skill) => `${skill.label}${member.skills[skill.key]}`).join("・")),
        createElement("div", { class: "home-muted" }, `行ける店舗：${storesText(member)}`),
      )),
    );
  }

  /** ほかの店舗がメインで、この店舗に応援に来られる人（2nd・3rd） */
  function helpers() {
    const list = members.filter((member) => member.rankHere > 1);   // 応援に来られる人
    if (!list.length) return null;
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, `応援に来られる人（${list.length}人）`),
      list.map((member) => createElement("button", { class: "staff-row", onclick: () => { editing = member.id; draw(); window.scrollTo(0, 0); } },
        createElement("div", null, createElement("strong", null, member.name), " ", createElement("span", { class: "home-muted" }, `この店舗は ${rankWord(member.rankHere)}`)),
        createElement("div", { class: "home-muted" }, `行ける店舗：${storesText(member)}`),
      )),
    );
  }

  /** 「安城福釜店（メイン）・安城店（2nd）」の形 */
  function storesText(member) {
    return [...(member.stores || [{ storeId: member.storeId, rank: 1 }])]
      .sort((storeRankA, storeRankB) => storeRankA.rank - storeRankB.rank)
      .map((storeRank) => `${stores.find((store) => store.id === storeRank.storeId)?.short || ""}（${rankWord(storeRank.rank)}）`)
      .join("・");
  }

  /** 作る／直すフォーム */
  function form(member) {
    // フォームの中の「今の入力」
    const draft = member
      ? { ...member, skills: { ...member.skills }, rule: rules.find((rule) => rule.memberId === member.id)?.text || "",
          stores: (member.stores || [{ storeId: member.storeId, rank: 1 }]).map((storeRank) => ({ ...storeRank })),
          hourly: wages.find((wage) => wage.memberId === member.id)?.hourly ?? 0,
          transport: wages.find((wage) => wage.memberId === member.id)?.transport ?? 0,
          // 働き方のルール（2026年11月6日）
          minor: !!wages.find((wage) => wage.memberId === member.id)?.minor,                  // 18歳未満か
          monthHoursMax: wages.find((wage) => wage.memberId === member.id)?.monthHoursMax ?? "",   // 月の上限時間
          yearYenMax: wages.find((wage) => wage.memberId === member.id)?.yearYenMax ?? "" }       // 年の上限金額
      : { name: "", kind: "baito", everyday: false, skills: { hall: 0, kitchen: 0, open: 0, close: 0 }, rule: "",
          stores: [{ storeId: state.storeId, rank: 1 }], hourly: 1100, transport: 0, minor: false, monthHoursMax: "", yearYenMax: "" };

    const box = createElement("section", { class: "card staff-form" });   // フォームの入れ物
    /** フォームの中だけ描き直す */
    const redraw = () => mount(box, ...fields());
    redraw();
    return box;

    /**
     * 行ける店舗と順番（メイン＝1、2nd、3rd、行かない）
     * 人が足りない時、2nd・3rd の人を AI がその店舗に入れる
     */
    function storeRanks() {
      /** その店舗の順番（0＝行かない） */
      const rankOf = (id) => draft.stores.find((store) => store.storeId === id)?.rank ?? 0;
      /** その店舗の順番を決める */
      const setRank = (id, rank) => {
        // 同じ順番は1店舗だけ。選んだ順番を持っていた店舗は「行かない」にする
        draft.stores = draft.stores.filter((storeRank) => storeRank.storeId !== id && (rank === 0 || storeRank.rank !== rank));
        if (rank) draft.stores.push({ storeId: id, rank });
        redraw();
      };
      return createElement("div", { class: "field" }, "行ける店舗と順番（メインは1つ）",
        stores.map((st) => createElement("div", { class: "skill-row" },
          createElement("span", { class: "skill-row__label" }, st.name),
          createElement("div", { class: "chip-row" },
            [[1, "メイン"], [2, "2nd"], [3, "3rd"], [0, "行かない"]].map(([rank, text]) =>
              createElement("button", { class: "chip chip--small", "aria-pressed": String(rankOf(st.id) === rank), onclick: () => setRank(st.id, rank) }, text))),
        )));
    }

    /** フォームの中身 */
    function fields() {
      const name = createElement("input", { class: "input", value: draft.name, placeholder: "名前", oninput: (event) => { draft.name = event.target.value; } });   // 名前の欄
      return [
        createElement("h2", { class: "card__title" }, member ? `${member.name} を直す` : "アカウントを作る"),
        createElement("label", { class: "field" }, "名前", name),

        createElement("div", { class: "field" }, "立場",
          createElement("div", { class: "chip-row" },
            Object.entries(CONFIG.KIND_LABEL).map(([key, text]) =>
              createElement("button", { class: "chip", "aria-pressed": String(draft.kind === key), onclick: () => { draft.kind = key; redraw(); } }, text)))),

        createElement("label", { class: "check" },
          createElement("input", { type: "checkbox", checked: draft.everyday, onchange: (event) => { draft.everyday = event.target.checked; } }),
          "毎日入ってくれる人（優先順①）"),

        createElement("div", { class: "field" }, "できること（一人でどこまでできるか）",
          CONFIG.SKILLS.map((skill) => createElement("div", { class: "skill-row" },
            createElement("span", { class: "skill-row__label" }, skill.label),
            createElement("div", { class: "chip-row" },
              CONFIG.SKILL_LEVELS.map((lv) =>
                createElement("button", { class: "chip chip--small", "aria-pressed": String(draft.skills[skill.key] === lv), onclick: () => { draft.skills[skill.key] = lv; redraw(); } }, `${lv}%`))),
          ))),

        storeRanks(),

        // 時給・交通費：人件費の目安に使う（店長だけが見られる。社員は0にしておく）
        createElement("div", { class: "field" }, "時給・交通費（店長だけが見られる。社員は0）",
          createElement("div", { class: "time-range" },
            createElement("label", { class: "field", style: { flex: 1 } }, "時給（円）",
              createElement("input", { class: "input num", type: "number", min: "0", step: "10", value: String(draft.hourly), oninput: (event) => { draft.hourly = event.target.value; } })),
            createElement("label", { class: "field", style: { flex: 1 } }, "交通費（1日・円）",
              createElement("input", { class: "input num", type: "number", min: "0", step: "10", value: String(draft.transport), oninput: (event) => { draft.transport = event.target.value; } })),
          )),

        // 働き方のルール（店長だけが見られる）：シフト作成のチェックとAIが守る（rules/labor-rules.js）
        createElement("div", { class: "field" }, "働き方のルール（店長だけが見られる。空なら決めない）",
          createElement("label", { class: "check-line" },
            createElement("input", { type: "checkbox", checked: draft.minor, onchange: (event) => { draft.minor = event.target.checked; } }),
            "18歳未満（22時〜朝5時は入れない）"),
          createElement("div", { class: "time-range" },
            createElement("label", { class: "field", style: { flex: 1 } }, "月の上限（時間）",
              createElement("input", { class: "input num", type: "number", min: "0", step: "1", placeholder: "例 80", value: String(draft.monthHoursMax), oninput: (event) => { draft.monthHoursMax = event.target.value; } })),
            createElement("label", { class: "field", style: { flex: 1 } }, "年の上限（円・扶養など）",
              createElement("input", { class: "input num", type: "number", min: "0", step: "10000", placeholder: "例 1030000", value: String(draft.yearYenMax), oninput: (event) => { draft.yearYenMax = event.target.value; } })),
          ),
          createElement("div", { class: "home-muted" }, "年の上限は「時給×時間＋交通費」の目安で数えます。上限の金額は本人と決めてください")),

        createElement("label", { class: "field" }, "人ごとのルール（店長だけが見られる）",
          createElement("textarea", { class: "textarea", placeholder: "例：土曜はNG、週20時間まで", oninput: (event) => { draft.rule = event.target.value; } }, draft.rule)),

        createElement("div", { class: "chip-row" },
          createElement("button", { class: "btn btn--primary", onclick: () => save(member, draft) }, member ? "保存" : "作成して初回コードを出す"),
          createElement("button", { class: "btn", onclick: () => { editing = null; draw(); } }, "閉じる"),
        ),

        member && member.role !== "manager"
          ? createElement("div", { class: "chip-row" },
              // アカウントがない人は「アカウントを作る」（初回コードを出す）。ある人は「パスワードをリセット」
              createElement("button", { class: `btn btn--small ${member.account === "none" ? "btn--primary" : ""}`, onclick: () => reset(member) },
                member.account === "none" ? "アカウントを作る（初回コードを出す）" : "パスワードをリセット"),
              createElement("button", { class: "btn btn--small btn--danger", onclick: () => toggleActive(member) }, member.active ? "停止する（やめた人）" : "再開する"),
            )
          : null,
      ];
    }
  }

  /** 保存（新しい人なら作って、初回コードを見せる） */
  async function save(member, draft) {
    if (!draft.name.trim()) { toast("名前を入れてください"); return; }
    if (!draft.stores.some((storeRank) => storeRank.rank === 1)) { toast("メインの店舗を1つ選んでください"); return; }
    const data = { name: draft.name.trim(), kind: draft.kind, everyday: draft.everyday, skills: draft.skills, stores: draft.stores };   // 保存する中身
    if (member) {
      await api.saveMember({ ...member, ...data });
      await api.saveMemberRule(member.id, draft.rule);
      await api.saveWage(member.id, draft.hourly, draft.transport, draft);
      toast("保存しました");
    } else {
      const { member: created, code } = await api.createMember(data);
      await api.saveMemberRule(created.id, draft.rule);
      await api.saveWage(created.id, draft.hourly, draft.transport, draft);
      await showCode(created.name, created.loginId, code);
    }
    members = await api.listMembers();
    rules = await api.listMemberRules();
    wages = await api.listWages();
    editing = null;
    draw();
  }

  /** パスワードのリセット／アカウントを作る：新しい初回コードを出して見せる */
  async function reset(member) {
    const { loginId, code } = await api.resetPassword(member.id);   // IDと新しい初回コード
    await showCode(member.name, loginId, code);
    members = await api.listMembers();                       // 「アカウントなし」の印を消すため読み直す
    draw();
  }

  /** 停止する／再開する */
  async function toggleActive(member) {
    await api.saveMember({ ...member, active: !member.active });
    members = await api.listMembers();
    editing = null;
    toast(member.active ? "停止しました" : "再開しました");
    draw();
  }

  /** 本人に渡す ID と初回コードを見せる */
  function showCode(name, loginId, code) {
    return confirmDialog({
      title: `${name}さんに渡してください`,
      body: createElement("div", { class: "code-box" },
        createElement("div", null, "ID", createElement("strong", { class: "num" }, loginId)),
        createElement("div", null, "初回コード", createElement("strong", { class: "num" }, code)),
        createElement("p", { class: "home-muted", style: { margin: 0 } }, "本人がログイン画面の「はじめての方」で入れて、自分のパスワードを決めます。コードは1回だけ使えます。"),
      ),
      yes: "OK（メモしました）", no: null,
    });
  }
}
