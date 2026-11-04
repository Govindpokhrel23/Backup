// ============================================================
// screens/stores.js — 店舗の管理（店長）
// ------------------------------------------------------------
// これから店舗が増えたり、減ったり、名前が変わったりしても使えるように（2026年11月4日）
//   ・店舗を増やす：名前と短い名前（シフト表やボタンに出る。例「福釜」）
//     → マップの人のマークは空、営業時間は 7:00〜22:00 から始まる
//   ・名前を変える：過去のシフト・カレンダーにも新しい名前が出る
//   ・休止する：店舗は消さない（過去のシフトに店名が残るため）。
//     休止した店舗は、切り替えのボタンや「行ける店舗」に出なくなる。再開もできる
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, loadStoreInfo } from "../store.js";
import { screenHeader } from "../components/header.js";

export async function renderStores(app) {
  draw();

  function draw() {
    const stores = state.stores;
    mount(app,
      screenHeader({ title: "店舗の管理", sub: `営業中 ${stores.filter((s) => s.active !== false).length}店舗` }),
      h("div", { class: "screen-body" },
        addCard(),
        h("section", { class: "card" },
          h("h2", { class: "card__title" }, "店舗の一覧"),
          stores.map((st) => storeRow(st)),
        ),
      ),
    );
  }

  /** 店舗を増やす */
  function addCard() {
    const name = h("input", { class: "input", placeholder: "例：刈谷店" });
    const short = h("input", { class: "input", placeholder: "例：刈谷", maxlength: "4" });
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, "店舗を増やす"),
      h("div", { class: "store-row__fields" },
        h("label", { class: "field" }, "店舗名", name),
        h("label", { class: "field" }, "短い名前（4文字まで）", short),
      ),
      h("button", { class: "btn btn--primary", onclick: async () => {
        try {
          const st = await api.createStore({ name: name.value, short: short.value });
          await loadStoreInfo();
          toast(`${st.name} を増やしました。ホームで切り替えて、マップと店員を決めてください`);
          draw();
        } catch (e) { toast(e.message); }
      } }, "＋ 店舗を増やす"),
    );
  }

  /** 1店舗分：名前の変更と、休止／再開 */
  function storeRow(st) {
    const paused = st.active === false;
    const name = h("input", { class: "input", value: st.name, "aria-label": "店舗名" });
    const short = h("input", { class: "input", value: st.short, maxlength: "4", "aria-label": "短い名前" });
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
            const ok = await confirmDialog({
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
