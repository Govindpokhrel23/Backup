// ============================================================
// screens/staff.js — 店員管理（店長）
// ------------------------------------------------------------
// アカウントを作る時に、店長がこれを決める（あとで変えられる）：
//   ・立場：社員／バイト／フルで入るバイト（F-45）
//   ・できること：ホール・キッチン・立ち上げ・締め を 0〜100％（F-46）
//   ・人ごとのルール：文章で自由に。店長だけが見られる（F-47）
// 作ると「ID」と「初回コード（6桁）」が出るので、本人に渡す。
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { CONFIG } from "../config.js";
import { screenHeader } from "../components/header.js";

export async function renderStaff(app) {
  let members = await api.listMembers();
  let rules = await api.listMemberRules();
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
      ),
    );
  }

  /** 立場ごとのまとまり（社員を上に） */
  function group(kind) {
    const list = members.filter((m) => m.kind === kind);
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
      )),
    );
  }

  /** 作る／直すフォーム */
  function form(member) {
    // フォームの中の「今の入力」
    const draft = member
      ? { ...member, skills: { ...member.skills }, rule: rules.find((r) => r.memberId === member.id)?.text || "" }
      : { name: "", kind: "baito", everyday: false, skills: { hall: 0, kitchen: 0, open: 0, close: 0 }, rule: "" };

    const box = h("section", { class: "card staff-form" });
    const redraw = () => mount(box, ...fields());
    redraw();
    return box;

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
    const data = { name: draft.name.trim(), kind: draft.kind, everyday: draft.everyday, skills: draft.skills };
    if (member) {
      await api.saveMember({ ...member, ...data });
      await api.saveMemberRule(member.id, draft.rule);
      toast("保存しました");
    } else {
      const { member: created, code } = await api.createMember(data);
      await api.saveMemberRule(created.id, draft.rule);
      await showCode(created.name, created.loginId, code);
    }
    members = await api.listMembers();
    rules = await api.listMemberRules();
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
