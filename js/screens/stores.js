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

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, loadStoreInfo, switchStore } from "../store.js";   // アプリの状態・店舗を読む・切りかえる道具を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む

/** 店舗名から短い名前を作る（「コメダ珈琲店 刈谷店」→「刈谷」）。4文字まで */
export function shortNameOf(name) {   // 店舗名から短い名前を作る関数
  return name.replace(/コメダ珈琲店?|コメダ/g, "").replace(/店$/, "").replace(/[\s　]/g, "").slice(0, 4);   // 「コメダ」「店」・空白を消して4文字まで
}

/** 店舗の管理の画面を描く（店長） */
export async function renderStores(app) {   // 店舗の管理の画面を描く関数
  const company = await api.listCompanyMembers();          // 会社の店員みんな（③で選ぶ）
  let justAdded = null;                                     // さっき足した店舗（「次にやること」を出す）
  draw();   // はじめに描く

  /** 画面を描く */
  function draw() {   // 画面を描く関数
    const stores = state.stores;                            // 全部の店舗（休止中も）
    mount(app,   // 画面に入れる
      screenHeader({ title: "店舗の管理", sub: `営業中 ${stores.filter((store) => store.active !== false).length}店舗` }),   // 見出し（営業中の店舗の数）
      createElement("div", { class: "screen-body" },   // 本文
        justAdded ? nextStepsCard(justAdded) : null,   // 増やしたすぐ後なら次にやることを出す
        addCard(),   // 店舗を増やすカード
        createElement("section", { class: "card" },   // 店舗の一覧のカード
          createElement("h2", { class: "card__title" }, "店舗の一覧"),   // 見出し
          stores.map((eachStore) => storeRow(eachStore)),   // 店舗ごとの行
        ),
      ),
    );
  }

  /**
   * 店舗を増やす（3つの手順）
   * ① 名前 ② 設定を写す店舗 ③ 行ける人
   */
  function addCard() {   // 店舗を増やすカードを作る関数
    const name = createElement("input", { class: "input", placeholder: "例：コメダ珈琲店 刈谷店" });      // 店舗名
    const short = createElement("input", { class: "input", placeholder: "例：刈谷", maxlength: "4" });     // 短い名前
    // 店舗名を打つと、短い名前を自動で入れる（自分で直したら、それ以上は変えない）
    let shortTouched = false;                                                                  // 短い名前を自分で直したか
    name.addEventListener("input", () => { if (!shortTouched) short.value = shortNameOf(name.value); });   // 名前を入れたら短い名前も自動で入れる
    short.addEventListener("input", () => { shortTouched = true; });   // 短い名前を自分で変えたら自動をやめる
    // ② どの店舗の設定を写すか（最初は今見ている店舗）
    const copyFrom = createElement("select", { class: "select", "aria-label": "設定を写す店舗" },   // 設定を写す店舗を選ぶ欄
      createElement("option", { value: "" }, "写さない（マップは空から作る）"),   // 写さない
      state.stores.filter((store) => store.active !== false).map((store) => createElement("option", { value: store.id, selected: store.id === state.storeId }, `${store.name} から写す`)));   // 営業中の店舗
    // ③ この店舗にも行ける人（チェックした人は、その人の順番のいちばん後ろに足す）
    const people = company.filter((member) => member.role !== "manager");                               // 店長は自動で全部の店舗に入る
    const checks = people.map((member) => ({ member, box: createElement("input", { type: "checkbox" }) }));          // 人ごとのチェック
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, "店舗を増やす"),   // 見出し
      createElement("div", { class: "step" }, createElement("strong", { class: "step__no" }, "1"), "名前"),   // 手順1
      createElement("div", { class: "store-row__fields" },   // 名前の欄の行
        createElement("label", { class: "field" }, "店舗名", name),   // 店舗名
        createElement("label", { class: "field" }, "短い名前（4文字まで・ボタンに出る）", short),   // 短い名前
      ),
      createElement("div", { class: "step" }, createElement("strong", { class: "step__no" }, "2"), "営業時間・マップ・必要人数"),   // 手順2
      copyFrom,   // 写す店舗
      createElement("div", { class: "home-muted" }, "似ている店舗から写すと、あとで少し直すだけで使えます"),   // 説明
      createElement("div", { class: "step" }, createElement("strong", { class: "step__no" }, "3"), "この店舗にも行ける人（あとで店員管理でも変えられます）"),   // 手順3
      createElement("div", { class: "pick-list" },   // 人のチェックの一覧
        checks.map(({ member, box }) => createElement("label", { class: "pick-list__item" }, box, `${member.name}`, createElement("span", { class: "home-muted" }, `（${member.mainShort}）`)))),   // 1人ずつ
      createElement("button", { class: "btn btn--primary btn--block", onclick: async () => {   // 増やすボタン
        try {   // 失敗しても止まらないように
          const newStore = await api.createStore({ name: name.value, short: short.value, copyFrom: copyFrom.value || null });   // 増やした店舗
          const ids = checks.filter((check) => check.box.checked).map((check) => check.member.id);                   // チェックした人
          if (ids.length) await api.addMembersToStore(newStore.id, ids);   // チェックした人をこの店舗で働けるようにする
          await loadStoreInfo();   // 店舗を読みなおす
          justAdded = { store: newStore, copied: !!copyFrom.value, people: ids.length };   // 次にやることを出すために覚える
          toast(`${newStore.name} を増やしました`);   // お知らせ
          draw();   // 描きなおす
          window.scrollTo(0, 0);   // 一番上へ
        } catch (error) { toast(error.message); }   // 失敗したら理由を出す
      } }, "＋ 店舗を増やす"),   // ボタンの文字
    );
  }

  /** 店舗を足したあとの「次にやること」 */
  function nextStepsCard({ store, copied, people }) {   // 次にやることのカードを作る関数
    /** その店舗に切り替えてから、画面へ行く */
    const open = async (path) => { await switchStore(store.id); go(path); };   // その店舗に切りかえて画面を開く
    return createElement("section", { class: "card next-steps" },   // カード
      createElement("h2", { class: "card__title" }, `${store.name} を増やしました。次にやること`),   // 見出し
      createElement("ol", { class: "next-steps__list" },   // 番号つきの一覧
        createElement("li", null, copied ? "マップと営業時間を確認する（写したものが入っています）" : "マップに人のマークを置いて、営業時間を決める",   // マップの確認
          createElement("button", { class: "btn btn--small", onclick: () => open("/map") }, "マップへ")),   // マップへ
        createElement("li", null, people ? `行ける人 ${people}人 の順番を確認する` : "この店舗で働く人を決める",   // 働く人の確認
          createElement("button", { class: "btn btn--small", onclick: () => open("/staff") }, "店員管理へ")),   // 店員管理へ
        createElement("li", null, "シフトを作る",   // シフトを作る
          createElement("button", { class: "btn btn--small btn--primary", onclick: () => open("/shift") }, "シフト作成へ")),   // シフト作成へ
      ),
    );
  }

  /** 1店舗分：名前の変更と、休止／再開 */
  function storeRow(store) {   // 店舗1行を作る関数
    const paused = store.active === false;   // 休止中か
    const name = createElement("input", { class: "input", value: store.name, "aria-label": "店舗名" });   // 店舗名の欄
    const short = createElement("input", { class: "input", value: store.short, maxlength: "4", "aria-label": "短い名前" });   // 短い名前の欄
    return createElement("div", { class: `store-row ${paused ? "is-paused" : ""}` },   // 行（休止中なら色を変える）
      createElement("div", { class: "store-row__fields" }, name, short),   // 名前の欄
      createElement("div", { class: "chip-row" },   // ボタンの行
        paused ? createElement("span", { class: "badge", style: { alignSelf: "center" } }, "休止中") : null,   // 休止中の印
        createElement("button", { class: "btn btn--small", onclick: async () => {   // 名前を保存するボタン
          try {   // 失敗しても止まらないように
            await api.updateStore(store.id, { name: name.value, short: short.value });   // 保存
            await loadStoreInfo();   // 店舗を読みなおす
            toast("名前を変えました");   // お知らせ
            draw();   // 描きなおす
          } catch (error) { toast(error.message); }   // 失敗したら理由を出す
        } }, "名前を保存"),   // ボタンの文字
        createElement("button", { class: `btn btn--small ${paused ? "" : "btn--danger"}`, onclick: async () => {   // 休止・再開のボタン
          if (!paused) {   // 休止する時は
            const ok = await confirmDialog({   // 本当に休止するか聞く
              title: `${store.name} を休止しますか？`,   // 確認のタイトル
              body: createElement("p", { style: { margin: 0 } }, "店舗は消えません。過去のシフトは残り、あとで再開できます。休止中は切り替えのボタンや「行ける店舗」に出ません。"),   // 説明
              yes: "休止する", no: "やめる",   // ボタンの文字
            });
            if (!ok) return;   // 「やめる」なら止める
          }
          try {   // 失敗しても止まらないように
            await api.setStoreActive(store.id, paused);   // 休止・再開
            await loadStoreInfo();   // 店舗を読みなおす
            toast(paused ? "再開しました" : "休止しました");   // お知らせ
            draw();   // 描きなおす
          } catch (error) { toast(error.message); }   // 失敗したら理由を出す
        } }, paused ? "再開する" : "休止する"),   // ボタンの文字
      ),
    );
  }
}
