// ============================================================
// screens/staff.js — 店員管理（店長）
// ------------------------------------------------------------
// アカウントを作る時に、店長がこれを決める（あとで変えられる）：
//   ・立場：社員／バイト／フルで入るバイト（F-45）
//   ・できること：ホール・キッチン・立ち上げ・締め を 0〜100％（F-46）
//   ・人ごとのルール：文章で自由に。店長だけが見られる（F-47）
//   ・行ける店舗と順番：メイン／2nd／3rd（2026年11月3日）
//     人が足りない時、2nd・3rd の人を AI がその店舗に入れる
// 作ると「ID」と「初回コード（6桁）」が出るので、本人に渡す。
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { CONFIG } from "../config.js";
import { state } from "../store.js";
import { screenHeader } from "../components/header.js";

/** 順番の呼び方 */
const rankWord = (rank) => ({ 1: "メイン", 2: "2nd", 3: "3rd" }[rank] || "");

export async function renderStaff(app) {
  let members = await api.listMembers();
  let rules = await api.listMemberRules();
  let wages = await api.listWages();          // 時給・交通費（店長だけ。人件費の目安に使う）
  const stores = state.stores;
  let editing = null;      // 直している店員（新しく作る時は "new"）

  draw();

  function draw() {
    mount(app,
      screenHeader({
        title: "店員管理",
        sub: `${members.filter((m) => m.active).length}人`,
        right: h("button", { class: "btn btn--small btn--primary", onclick: () => { editing = "new"; draw(); } }, "＋ アカウント作成"),
      }),
      h("div", { class: "screen-body" },
        editing ? form(editing === "new" ? null : members.find((m) => m.id === editing)) : null,
        ...["shain", "full", "baito"].map((kind) => group(kind)),
        helpers(),
      ),
    );
  }

  /** 立場ごとのまとまり（社員を上に）。この店舗がメインの人だけ */
  function group(kind) {
    const list = members.filter((m) => m.kind === kind && m.rankHere === 1);
    if (!list.length) return null;
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, `${CONFIG.KIND_LABEL[kind]}（${list.length}人）`),
      list.map((m) => h("button", { class: `staff-row ${m.active ? "" : "is-stopped"}`, onclick: () => { editing = m.id; draw(); window.scrollTo(0, 0); } },
        h("div", null,
          h("strong", null, m.name), " ",
          h("span", { class: "home-muted num" }, `ID ${m.loginId}`),
          m.role === "manager" ? h("span", { class: "badge", style: { marginLeft: "6px" } }, "店長") : null,
          !m.active ? h("span", { class: "badge", style: { marginLeft: "6px", background: "var(--danger)" } }, "停止中") : null,
        ),
        h("div", { class: "home-muted" }, CONFIG.SKILLS.map((s) => `${s.label}${m.skills[s.key]}`).join("・")),
        h("div", { class: "home-muted" }, `行ける店舗：${storesText(m)}`),
      )),
    );
  }

  /** ほかの店舗がメインで、この店舗に応援に来られる人（2nd・3rd） */
  function helpers() {
    const list = members.filter((m) => m.rankHere > 1);
    if (!list.length) return null;
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, `応援に来られる人（${list.length}人）`),
      list.map((m) => h("button", { class: "staff-row", onclick: () => { editing = m.id; draw(); window.scrollTo(0, 0); } },
        h("div", null, h("strong", null, m.name), " ", h("span", { class: "home-muted" }, `この店舗は ${rankWord(m.rankHere)}`)),
        h("div", { class: "home-muted" }, `行ける店舗：${storesText(m)}`),
      )),
    );
  }

  /** 「安城福釜店（メイン）・安城店（2nd）」の形 */
  function storesText(m) {
    return [...(m.stores || [{ storeId: m.storeId, rank: 1 }])]
      .sort((a, b) => a.rank - b.rank)
      .map((x) => `${stores.find((s) => s.id === x.storeId)?.short || ""}（${rankWord(x.rank)}）`)
      .join("・");
  }

  /** 作る／直すフォーム */
  function form(member) {
    // フォームの中の「今の入力」
    const draft = member
      ? { ...member, skills: { ...member.skills }, rule: rules.find((r) => r.memberId === member.id)?.text || "",
          stores: (member.stores || [{ storeId: member.storeId, rank: 1 }]).map((x) => ({ ...x })),
          hourly: wages.find((w) => w.memberId === member.id)?.hourly ?? 0,
          transport: wages.find((w) => w.memberId === member.id)?.transport ?? 0 }
      : { name: "", kind: "baito", everyday: false, skills: { hall: 0, kitchen: 0, open: 0, close: 0 }, rule: "",
          stores: [{ storeId: state.storeId, rank: 1 }], hourly: 1100, transport: 0 };

    const box = h("section", { class: "card staff-form" });
    const redraw = () => mount(box, ...fields());
    redraw();
    return box;

    /**
     * 行ける店舗と順番（メイン＝1、2nd、3rd、行かない）
     * 人が足りない時、2nd・3rd の人を AI がその店舗に入れる
     */
    function storeRanks() {
      const rankOf = (id) => draft.stores.find((x) => x.storeId === id)?.rank ?? 0;
      const setRank = (id, rank) => {
        // 同じ順番は1店舗だけ。選んだ順番を持っていた店舗は「行かない」にする
        draft.stores = draft.stores.filter((x) => x.storeId !== id && (rank === 0 || x.rank !== rank));
        if (rank) draft.stores.push({ storeId: id, rank });
        redraw();
      };
      return h("div", { class: "field" }, "行ける店舗と順番（メインは1つ）",
        stores.map((st) => h("div", { class: "skill-row" },
          h("span", { class: "skill-row__label" }, st.name),
          h("div", { class: "chip-row" },
            [[1, "メイン"], [2, "2nd"], [3, "3rd"], [0, "行かない"]].map(([rank, text]) =>
              h("button", { class: "chip chip--small", "aria-pressed": String(rankOf(st.id) === rank), onclick: () => setRank(st.id, rank) }, text))),
        )));
    }

    function fields() {
      const name = h("input", { class: "input", value: draft.name, placeholder: "名前", oninput: (e) => { draft.name = e.target.value; } });
      return [
        h("h2", { class: "card__title" }, member ? `${member.name} を直す` : "アカウントを作る"),
        h("label", { class: "field" }, "名前", name),

        h("div", { class: "field" }, "立場",
          h("div", { class: "chip-row" },
            Object.entries(CONFIG.KIND_LABEL).map(([key, text]) =>
              h("button", { class: "chip", "aria-pressed": String(draft.kind === key), onclick: () => { draft.kind = key; redraw(); } }, text)))),

        h("label", { class: "check" },
          h("input", { type: "checkbox", checked: draft.everyday, onchange: (e) => { draft.everyday = e.target.checked; } }),
          "毎日入ってくれる人（優先順①）"),

        h("div", { class: "field" }, "できること（一人でどこまでできるか）",
          CONFIG.SKILLS.map((s) => h("div", { class: "skill-row" },
            h("span", { class: "skill-row__label" }, s.label),
            h("div", { class: "chip-row" },
              CONFIG.SKILL_LEVELS.map((lv) =>
                h("button", { class: "chip chip--small", "aria-pressed": String(draft.skills[s.key] === lv), onclick: () => { draft.skills[s.key] = lv; redraw(); } }, `${lv}%`))),
          ))),

        storeRanks(),

        // 時給・交通費：人件費の目安に使う（店長だけが見られる。社員は0にしておく）
        h("div", { class: "field" }, "時給・交通費（店長だけが見られる。社員は0）",
          h("div", { class: "time-range" },
            h("label", { class: "field", style: { flex: 1 } }, "時給（円）",
              h("input", { class: "input num", type: "number", min: "0", step: "10", value: String(draft.hourly), oninput: (e) => { draft.hourly = e.target.value; } })),
            h("label", { class: "field", style: { flex: 1 } }, "交通費（1日・円）",
              h("input", { class: "input num", type: "number", min: "0", step: "10", value: String(draft.transport), oninput: (e) => { draft.transport = e.target.value; } })),
          )),

        h("label", { class: "field" }, "人ごとのルール（店長だけが見られる）",
          h("textarea", { class: "textarea", placeholder: "例：土曜はNG、週20時間まで", oninput: (e) => { draft.rule = e.target.value; } }, draft.rule)),

        h("div", { class: "chip-row" },
          h("button", { class: "btn btn--primary", onclick: () => save(member, draft) }, member ? "保存" : "作成して初回コードを出す"),
          h("button", { class: "btn", onclick: () => { editing = null; draw(); } }, "閉じる"),
        ),

        member && member.role !== "manager"
          ? h("div", { class: "chip-row" },
              h("button", { class: "btn btn--small", onclick: () => reset(member) }, "パスワードをリセット"),
              h("button", { class: "btn btn--small btn--danger", onclick: () => toggleActive(member) }, member.active ? "停止する（やめた人）" : "再開する"),
            )
          : null,
      ];
    }
  }

  /** 保存（新しい人なら作って、初回コードを見せる） */
  async function save(member, draft) {
    if (!draft.name.trim()) { toast("名前を入れてください"); return; }
    if (!draft.stores.some((x) => x.rank === 1)) { toast("メインの店舗を1つ選んでください"); return; }
    const data = { name: draft.name.trim(), kind: draft.kind, everyday: draft.everyday, skills: draft.skills, stores: draft.stores };
    if (member) {
      await api.saveMember({ ...member, ...data });
      await api.saveMemberRule(member.id, draft.rule);
      await api.saveWage(member.id, draft.hourly, draft.transport);
      toast("保存しました");
    } else {
      const { member: created, code } = await api.createMember(data);
      await api.saveMemberRule(created.id, draft.rule);
      await api.saveWage(created.id, draft.hourly, draft.transport);
      await showCode(created.name, created.loginId, code);
    }
    members = await api.listMembers();
    rules = await api.listMemberRules();
    wages = await api.listWages();
    editing = null;
    draw();
  }

  async function reset(member) {
    const { loginId, code } = await api.resetPassword(member.id);
    await showCode(member.name, loginId, code);
  }

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
      body: h("div", { class: "code-box" },
        h("div", null, "ID", h("strong", { class: "num" }, loginId)),
        h("div", null, "初回コード", h("strong", { class: "num" }, code)),
        h("p", { class: "home-muted", style: { margin: 0 } }, "本人がログイン画面の「はじめての方」で入れて、自分のパスワードを決めます。コードは1回だけ使えます。"),
      ),
      yes: "OK（メモしました）", no: null,
    });
  }
}
