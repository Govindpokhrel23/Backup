// ============================================================
// screens/stores.js — 店舗の設定（店長）
// ------------------------------------------------------------
// このファイルは、店舗の設定（店長）のファイルです。
// 2026年11月15日：画面を見やすくした
//   ・店舗ごとのカードに「いつもの営業時間」と「休み・時間の変更（期間）」を出す
//   ・あまり使わないもの（時間を変える・名前・休止・店舗を増やす）は、ボタンを押した時だけ開く
//   ・休み・時間の変更：「12/31〜1/2 休み」「12/24 9:00〜18:00」のように期間で決める
//     → シフト作成・AIの下書き・人が足りない時間の計算にも自動で入る
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
import { today } from "../lib/date.js";   // 今日の日付の道具を読む
import { range, timeOptions } from "../lib/time.js";   // 時間の道具を読む
import { DAY_TYPE_NAMES, specialText, checkStoreHours } from "../lib/store-hours.js";   // 営業時間の道具を読む

/** 営業時間で選べる時刻（5:00〜翌2:00） */
const TIME_CHOICES = timeOptions(5 * 60, 26 * 60);   // 15分ごとの時刻の一覧

/** 店舗名から短い名前を作る（「コメダ珈琲店 刈谷店」→「刈谷」）。4文字まで */
export function shortNameOf(name) {   // 店舗名から短い名前を作る関数
  return name.replace(/コメダ珈琲店?|コメダ/g, "").replace(/店$/, "").replace(/[\s　]/g, "").slice(0, 4);   // 「コメダ」「店」・空白を消して4文字まで
}

/** 店舗の管理の画面を描く（店長） */
export async function renderStores(app) {   // 店舗の設定の画面を描く関数
  const company = await api.listCompanyMembers();          // 会社の店員みんな（③で選ぶ）
  let justAdded = null;                                     // さっき足した店舗（「次にやること」を出す）
  const hoursById = new Map();                              // 店舗ごとの営業時間
  const opened = new Set();                                 // 開いている部分（例 "s1:hours"・"add"）
  const drafts = new Map();                                 // 入力の途中の内容（店舗ごと）
  await loadHours();   // 全部の店舗の営業時間を読む
  draw();   // はじめに描く

  /** 全部の店舗の営業時間を読む */
  async function loadHours() {   // 営業時間を読む関数
    const list = await Promise.all(state.stores.map((store) => api.getStoreHours(store.id)));   // 店舗ごとに同時に読む
    state.stores.forEach((store, index) => hoursById.set(store.id, list[index]));   // 店舗IDで覚える
  }

  /** ある部分を開く・閉じる（key の例 "s1:hours"） */
  function toggle(key) {   // 開け閉めする関数
    if (opened.has(key)) opened.delete(key); else opened.add(key);   // 開いていれば閉じる・閉じていれば開く
    drafts.delete(key);   // 入力の途中の内容は消す
    draw();   // 描きなおす
  }

  /** 開け閉めのボタン（開いている時は「閉じる」） */
  function toggleButton(key, text) {   // 開け閉めのボタンを作る関数
    const open = opened.has(key);   // 開いているか
    return createElement("button", { class: "btn btn--small", "aria-expanded": String(open), onclick: () => toggle(key) }, open ? "閉じる" : text);   // ボタン
  }

  /** 画面を描く */
  function draw() {   // 画面を描く関数
    const stores = state.stores;                            // 全部の店舗（休止中も）
    mount(app,   // 画面に入れる
      screenHeader({ title: "店舗の設定", sub: `営業中 ${stores.filter((store) => store.active !== false).length}店舗` }),   // 見出し（営業中の店舗の数）
      createElement("div", { class: "screen-body" },   // 本文
        justAdded ? nextStepsCard(justAdded) : null,   // 増やしたすぐ後なら次にやることを出す
        stores.map((eachStore) => storeCard(eachStore)),   // 店舗ごとのカード
        // 店舗を増やす（あまり使わないので、ボタンを押した時だけ開く）
        opened.has("add")   // 開いていれば
          ? addCard()   // 店舗を増やすカード
          : createElement("button", { class: "btn btn--block", onclick: () => toggle("add") }, "＋ 店舗を増やす"),   // 開くボタン
      ),
    );
  }

  // ============================================================
  // 店舗ごとのカード
  // ============================================================

  /** 1店舗分のカード：いつもの営業時間・休みと時間の変更・名前と休止 */
  function storeCard(store) {   // 店舗のカードを作る関数
    const paused = store.active === false;   // 休止中か
    const hours = hoursById.get(store.id);   // その店舗の営業時間
    return createElement("section", { class: `card store-card ${paused ? "is-paused" : ""}` },   // カード（休止中ならうすく）
      createElement("div", { class: "store-card__head" },   // 上の行
        createElement("h2", { class: "card__title" }, store.name),   // 店舗名
        createElement("span", { class: "badge" }, store.short),   // 短い名前
        paused ? createElement("span", { class: "badge badge--warn" }, "休止中") : null,   // 休止中の印
      ),
      hours ? hoursSection(store, hours) : null,   // いつもの営業時間
      hours ? specialSection(store, hours) : null,   // 休み・時間の変更
      moreSection(store),   // 名前・休止
    );
  }

  /** 営業時間を保存して、描きなおす */
  async function saveHours(store, hours, message) {   // 営業時間を保存する関数
    const why = checkStoreHours(hours);   // 正しいか確かめる
    if (why) { toast(why); return false; }   // おかしければ理由を出して止める
    try {   // 失敗しても止まらないように
      await api.saveStoreHours(hours, store.id);   // 保存
      hoursById.set(store.id, hours);   // 覚えなおす
      toast(message);   // お知らせ
      return true;   // できた
    } catch (error) { toast(error.message); return false; }   // 失敗したら理由を出す
  }

  /** 時刻を選ぶ欄 */
  function timeSelect(value, onPick, aria) {   // 時刻を選ぶ欄を作る関数
    return createElement("select", { class: "select num", "aria-label": aria, onchange: (event) => onPick(Number(event.target.value)) },   // 選ぶ欄
      TIME_CHOICES.map((choice) => createElement("option", { value: choice.value, selected: choice.value === value }, choice.label)));   // 15分ごとの時刻
  }

  // ---------- いつもの営業時間 ----------

  /** いつもの営業時間（平日・土曜・日祝）。「変える」を押すと直せる */
  function hoursSection(store, hours) {   // いつもの営業時間の部分を作る関数
    const key = `${store.id}:hours`;   // 開け閉めの名前
    if (!drafts.has(key)) drafts.set(key, JSON.parse(JSON.stringify(hours)));   // 直す前の内容を写しておく
    const draft = drafts.get(key);   // 直している内容
    return createElement("div", { class: "store-sec" },   // 部分
      createElement("div", { class: "store-sec__head" },   // 見出しの行
        createElement("strong", null, "いつもの営業時間"),   // 見出し
        toggleButton(key, "変える"),   // 開け閉めのボタン
      ),
      opened.has(key)   // 開いていれば
        ? createElement("div", { class: "store-sec__body" },   // 直す欄
            DAY_TYPE_NAMES.map(([type, name]) => createElement("div", { class: "hours-line" },   // 日の種類ごとの行
              createElement("span", { class: "hours-line__name" }, name),   // 平日・土曜・日祝
              createElement("div", { class: "time-range" },   // 時間の行
                timeSelect(draft[type].open, (value) => { draft[type].open = value; }, `${name}の開店`),   // 開店
                "〜",   // 〜
                timeSelect(draft[type].close, (value) => { draft[type].close = value; }, `${name}の閉店`),   // 閉店
              ))),
            createElement("button", { class: "btn btn--primary btn--block", onclick: async () => {   // 保存ボタン
              const next = { ...hours, weekday: draft.weekday, sat: draft.sat, sun: draft.sun };   // 休み・時間の変更はそのまま
              if (await saveHours(store, next, "営業時間を保存しました")) toggle(key);   // 保存できたら閉じる
            } }, "保存する"),
          )
        : createElement("ul", { class: "hours-list" },   // 今の時間の一覧
            DAY_TYPE_NAMES.map(([type, name]) => createElement("li", null,   // 1行
              createElement("span", { class: "hours-line__name" }, name),   // 平日・土曜・日祝
              createElement("span", { class: "num" }, range(hours[type].open, hours[type].close))))),   // 時間
    );
  }

  // ---------- 休み・時間の変更 ----------

  /** 休み・時間の変更（期間）。今日より後のものを出す。「＋ 足す」で入れる */
  function specialSection(store, hours) {   // 休み・時間の変更の部分を作る関数
    const key = `${store.id}:special`;   // 開け閉めの名前
    const todayIso = today();   // 今日
    const list = (hours.special || []).filter((item) => item.to >= todayIso).sort((itemA, itemB) => itemA.from.localeCompare(itemB.from));   // まだ終わっていないもの（早い順）
    return createElement("div", { class: "store-sec" },   // 部分
      createElement("div", { class: "store-sec__head" },   // 見出しの行
        createElement("strong", null, "休み・時間の変更"),   // 見出し
        toggleButton(key, "＋ 足す"),   // 開け閉めのボタン
      ),
      list.length   // あれば
        ? createElement("ul", { class: "special-list" },   // 一覧
            list.map((item) => createElement("li", { class: item.closed ? "is-closed" : "" },   // 1つ（休みは赤っぽく）
              createElement("span", null, specialText(item)),   // 「12/31〜1/2 休み（年末年始）」
              createElement("button", { class: "btn btn--tiny", "aria-label": `${specialText(item)} を消す`, onclick: async () => {   // 消すボタン
                const ok = await confirmDialog({ title: "この予定を消しますか？", body: createElement("p", { style: { margin: 0 } }, specialText(item)), yes: "消す", no: "やめる" });   // 本当に消すか聞く
                if (!ok) return;   // やめるなら止める
                const next = { ...hours, special: (hours.special || []).filter((other) => other.id !== item.id) };   // その予定を外す
                if (await saveHours(store, next, "消しました")) draw();   // 保存できたら描きなおす
              } }, "消す"))))
        : createElement("div", { class: "home-muted" }, "予定はありません（いつもの営業時間で営業）"),   // なければ
      opened.has(key) ? specialForm(store, hours, key) : null,   // 開いていれば入力の欄
    );
  }

  /** 休み・時間の変更を足す欄 */
  function specialForm(store, hours, key) {   // 休み・時間の変更の入力欄を作る関数
    if (!drafts.has(key)) drafts.set(key, { from: today(), to: today(), closed: true, open: hours.weekday.open, close: hours.weekday.close, note: "" });   // はじめの内容（今日・休み）
    const draft = drafts.get(key);   // 入力している内容
    const from = createElement("input", { class: "input", type: "date", value: draft.from, "aria-label": "いつから" });   // いつから
    const to = createElement("input", { class: "input", type: "date", value: draft.to, "aria-label": "いつまで" });   // いつまで
    from.addEventListener("change", () => {   // 始まりを変えた時
      draft.from = from.value;   // 覚える
      if (!draft.to || draft.to < draft.from) { draft.to = draft.from; to.value = draft.from; }   // 終わりが前なら同じ日にする
    });
    to.addEventListener("change", () => { draft.to = to.value; });   // 終わりを覚える
    const note = createElement("input", { class: "input", value: draft.note, maxlength: "30", placeholder: "例：年末年始・棚卸し", "aria-label": "メモ" });   // メモ
    note.addEventListener("input", () => { draft.note = note.value; });   // メモを覚える
    /** 休み／時間を変える の切りかえ */
    const kind = (closed, text) => createElement("button", { class: "chip", "aria-pressed": String(draft.closed === closed), onclick: () => { draft.closed = closed; draw(); } }, text);   // 選ぶボタン
    return createElement("div", { class: "store-sec__body" },   // 入力の欄
      createElement("label", { class: "field" }, "期間（1日だけなら同じ日）",   // 期間
        createElement("div", { class: "time-range" }, from, "〜", to)),   // いつから〜いつまで
      createElement("div", { class: "chip-row" }, kind(true, "お休み"), kind(false, "時間を変える")),   // 休みか時間か
      draft.closed   // 休みなら
        ? createElement("div", { class: "home-muted" }, "この期間はシフトを作りません（AIも入れません）")   // 説明
        : createElement("div", { class: "time-range" },   // 時間を変えるなら
            timeSelect(draft.open, (value) => { draft.open = value; }, "この期間の開店"),   // 開店
            "〜",   // 〜
            timeSelect(draft.close, (value) => { draft.close = value; }, "この期間の閉店")),   // 閉店
      createElement("label", { class: "field" }, "メモ（なくてもよい）", note),   // メモ
      createElement("button", { class: "btn btn--primary btn--block", onclick: async () => {   // 保存ボタン
        const item = { id: `sp${Date.now().toString(36)}`, from: draft.from, to: draft.to, closed: draft.closed, note: draft.note.trim() };   // 新しい予定
        if (!draft.closed) { item.open = draft.open; item.close = draft.close; }   // 時間を変える時だけ時間を入れる
        const next = { ...hours, special: [...(hours.special || []), item] };   // 予定を足す
        if (await saveHours(store, next, `${specialText(item)} を足しました`)) toggle(key);   // 保存できたら閉じる
      } }, "保存する"),
    );
  }

  // ---------- 名前・休止 ----------

  /** 名前の変更と、休止／再開（あまり使わないので、押した時だけ開く） */
  function moreSection(store) {   // 名前・休止の部分を作る関数
    const key = `${store.id}:more`;   // 開け閉めの名前
    return createElement("div", { class: "store-sec" },   // 部分
      createElement("div", { class: "store-sec__head" },   // 見出しの行
        createElement("strong", null, "名前・休止"),   // 見出し
        toggleButton(key, "開く"),   // 開け閉めのボタン
      ),
      opened.has(key) ? storeRow(store) : null,   // 開いていれば名前と休止
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
      createElement("div", { class: "store-sec__head" },   // 見出しの行
        createElement("h2", { class: "card__title" }, "店舗を増やす"),   // 見出し
        toggleButton("add", "開く")),   // 閉じるボタン
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
          await loadHours();   // 営業時間も読みなおす（増えた店舗の分）
          opened.delete("add");   // 店舗を増やす欄を閉じる
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
