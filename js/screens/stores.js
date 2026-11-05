// ============================================================
// screens/stores.js — 店舗の管理（店長）
// ------------------------------------------------------------
// このファイルは、店舗の管理（店長）のファイルです。
// これから店舗が増えたり、減ったり、名前が変わったりしても使えるように（2026年11月4日）
//   ・店舗を増やす：名前と短い名前（シフト表やボタンに出る。例「福釜」）
//     2026年11月5日：4店舗め・5店舗めも かんたんに足せるように、3つの手順にした
//       ① 名前（短い名前は自動で入る。直してもよい）
//       ② ほかの店舗の設定（営業時間・マップ・必要人数）を写すか
//       ③ この店舗にも行ける人を、まとめてチェック
//     → 足したら「次にやること」が出て、その店舗に切り替えて続きができる
//   ・名前を変える：過去のシフト・カレンダーにも新しい名前が出る
//   ・休止する：店舗は消さない（過去のシフトに店名が残るため）。
//     休止した店舗は、切り替えのボタンや「行ける店舗」に出なくなる。再開もできる
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, loadStoreInfo, switchStore } from "../store.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";

/** 店舗名から短い名前を作る（「コメダ珈琲店 刈谷店」→「刈谷」）。4文字まで */
export function shortNameOf(name) {
  return name.replace(/コメダ珈琲店?|コメダ/g, "").replace(/店$/, "").replace(/[\s　]/g, "").slice(0, 4);
}

/** 店舗の管理の画面を描く（店長） */
export async function renderStores(app) {
  const company = await api.listCompanyMembers();          // 会社の店員みんな（③で選ぶ）
  let justAdded = null;                                     // さっき足した店舗（「次にやること」を出す）
  draw();

  /** 画面を描く */
  function draw() {
    const stores = state.stores;                            // 全部の店舗（休止中も）
    mount(app,
      screenHeader({ title: "店舗の管理", sub: `営業中 ${stores.filter((s) => s.active !== false).length}店舗` }),
      h("div", { class: "screen-body" },
        justAdded ? nextStepsCard(justAdded) : null,
        addCard(),
        h("section", { class: "card" },
          h("h2", { class: "card__title" }, "店舗の一覧"),
          stores.map((st) => storeRow(st)),
        ),
      ),
    );
  }

  /**
   * 店舗を増やす（3つの手順）
   * ① 名前 ② 設定を写す店舗 ③ 行ける人
   */
  function addCard() {
    const name = h("input", { class: "input", placeholder: "例：コメダ珈琲店 刈谷店" });      // 店舗名
    const short = h("input", { class: "input", placeholder: "例：刈谷", maxlength: "4" });     // 短い名前
    // 店舗名を打つと、短い名前を自動で入れる（自分で直したら、それ以上は変えない）
    let shortTouched = false;                                                                  // 短い名前を自分で直したか
    name.addEventListener("input", () => { if (!shortTouched) short.value = shortNameOf(name.value); });
    short.addEventListener("input", () => { shortTouched = true; });
    // ② どの店舗の設定を写すか（最初は今見ている店舗）
    const copyFrom = h("select", { class: "select", "aria-label": "設定を写す店舗" },
      h("option", { value: "" }, "写さない（マップは空から作る）"),
      state.stores.filter((s) => s.active !== false).map((s) => h("option", { value: s.id, selected: s.id === state.storeId }, `${s.name} から写す`)));
    // ③ この店舗にも行ける人（チェックした人は、その人の順番のいちばん後ろに足す）
    const people = company.filter((m) => m.role !== "manager");                               // 店長は自動で全部の店舗に入る
    const checks = people.map((m) => ({ m, box: h("input", { type: "checkbox" }) }));          // 人ごとのチェック
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, "店舗を増やす"),
      h("div", { class: "step" }, h("strong", { class: "step__no" }, "1"), "名前"),
      h("div", { class: "store-row__fields" },
        h("label", { class: "field" }, "店舗名", name),
        h("label", { class: "field" }, "短い名前（4文字まで・ボタンに出る）", short),
      ),
      h("div", { class: "step" }, h("strong", { class: "step__no" }, "2"), "営業時間・マップ・必要人数"),
      copyFrom,
      h("div", { class: "home-muted" }, "似ている店舗から写すと、あとで少し直すだけで使えます"),
      h("div", { class: "step" }, h("strong", { class: "step__no" }, "3"), "この店舗にも行ける人（あとで店員管理でも変えられます）"),
      h("div", { class: "pick-list" },
        checks.map(({ m, box }) => h("label", { class: "pick-list__item" }, box, `${m.name}`, h("span", { class: "home-muted" }, `（${m.mainShort}）`)))),
      h("button", { class: "btn btn--primary btn--block", onclick: async () => {
        try {
          const st = await api.createStore({ name: name.value, short: short.value, copyFrom: copyFrom.value || null });   // 増やした店舗
          const ids = checks.filter((c) => c.box.checked).map((c) => c.m.id);                   // チェックした人
          if (ids.length) await api.addMembersToStore(st.id, ids);
          await loadStoreInfo();
          justAdded = { store: st, copied: !!copyFrom.value, people: ids.length };
          toast(`${st.name} を増やしました`);
          draw();
          window.scrollTo(0, 0);
        } catch (e) { toast(e.message); }
      } }, "＋ 店舗を増やす"),
    );
  }

  /** 店舗を足したあとの「次にやること」 */
  function nextStepsCard({ store, copied, people }) {
    /** その店舗に切り替えてから、画面へ行く */
    const open = async (path) => { await switchStore(store.id); go(path); };
    return h("section", { class: "card next-steps" },
      h("h2", { class: "card__title" }, `${store.name} を増やしました。次にやること`),
      h("ol", { class: "next-steps__list" },
        h("li", null, copied ? "マップと営業時間を確認する（写したものが入っています）" : "マップに人のマークを置いて、営業時間を決める",
          h("button", { class: "btn btn--small", onclick: () => open("/map") }, "マップへ")),
        h("li", null, people ? `行ける人 ${people}人 の順番を確認する` : "この店舗で働く人を決める",
          h("button", { class: "btn btn--small", onclick: () => open("/staff") }, "店員管理へ")),
        h("li", null, "シフトを作る",
          h("button", { class: "btn btn--small btn--primary", onclick: () => open("/shift") }, "シフト作成へ")),
      ),
    );
  }

  /** 1店舗分：名前の変更と、休止／再開 */
  function storeRow(st) {
    const paused = st.active === false;   // 休止中か
    const name = h("input", { class: "input", value: st.name, "aria-label": "店舗名" });   // 店舗名の欄
    const short = h("input", { class: "input", value: st.short, maxlength: "4", "aria-label": "短い名前" });   // 短い名前の欄
    return h("div", { class: `store-row ${paused ? "is-paused" : ""}` },
      h("div", { class: "store-row__fields" }, name, short),
      h("div", { class: "chip-row" },
        paused ? h("span", { class: "badge", style: { alignSelf: "center" } }, "休止中") : null,
        h("button", { class: "btn btn--small", onclick: async () => {
          try {
            await api.updateStore(st.id, { name: name.value, short: short.value });
            await loadStoreInfo();
            toast("名前を変えました");
            draw();
          } catch (e) { toast(e.message); }
        } }, "名前を保存"),
        h("button", { class: `btn btn--small ${paused ? "" : "btn--danger"}`, onclick: async () => {
          if (!paused) {
            const ok = await confirmDialog({   // 本当に休止するか聞く
              title: `${st.name} を休止しますか？`,
              body: h("p", { style: { margin: 0 } }, "店舗は消えません。過去のシフトは残り、あとで再開できます。休止中は切り替えのボタンや「行ける店舗」に出ません。"),
              yes: "休止する", no: "やめる",
            });
            if (!ok) return;
          }
          try {
            await api.setStoreActive(st.id, paused);
            await loadStoreInfo();
            toast(paused ? "再開しました" : "休止しました");
            draw();
          } catch (e) { toast(e.message); }
        } }, paused ? "再開する" : "休止する"),
      ),
    );
  }
}
