// ============================================================
// screens/map.js — 店舗マップ・必要人数・営業時間（店長）
// ------------------------------------------------------------
// このファイルは、店舗マップ・必要人数・営業時間（店長）のファイルです。
// 画面見本で決めた形（2026年11月2日・11月3日に見直し）：
//   ・間取り図の上に「人のマーク」を置く（キッチン＝オレンジ、ホール＝青）
//   ・マークの上に「9:00〜11:00 1人」のように、何時〜何時・何人かを出す
//     （前にあった「マップの時刻」ボタンは、マークで分かるのでなくした）
//   ・マークは 追加／ドラッグで移動／名前変更／削除 ができる
//   ・右の欄で時間帯と人数を直して「保存」を押す
//   ・お店の営業時間（何時〜何時）も、ここで決めて保存する
//   ・平日／土曜／日曜祝日 で別々に決める
// マップの座標は「幅840×高さ580」の中の位置で持つ（画面の大きさが変わっても同じ場所）
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { range, timeOptions } from "../lib/time.js";   // 時間の道具を読む

const MAP_W = 840;   // マップの横の大きさ（点の位置の単位）
const MAP_H = 580;   // マップの縦の大きさ
const DAY_TYPES = [["weekday", "平日"], ["sat", "土曜"], ["sun", "日曜・祝日"]];   // 日の種類と名前

/** マップ・必要人数・営業時間の画面を描く（店長） */
export async function renderMap(app) {   // マップの画面を描く関数
  // ---------- 保存されているデータ ----------
  let positions = await api.listPositions();   // 場所（マーク）の一覧
  let requirements = await api.listRequirements();   // 必要人数
  let hours = await api.getStoreHours();   // 営業時間

  // ---------- 画面の中の状態 ----------
  let dayType = "weekday";   // 見ている日の種類（はじめは平日）
  let selectedId = positions[0]?.id || null;   // 選んでいるマーク
  let draft = null;          // 右の欄で直している途中の内容（保存するまで本物は変わらない）
  let hoursDraft = null;     // 営業時間の直している途中の内容

  startDraft();   // 選んだマークの入力を用意する
  draw();   // 描く

  // ============================================================
  // 「直している途中」の管理
  // ============================================================

  /** 選んだマークの今の内容を、直す用にコピーする */
  function startDraft() {   // 選んだマークの入力を用意する関数
    const position = positions.find((position) => position.id === selectedId);   // 選んでいるマーク
    draft = position   // 直している内容
      ? {   // マークがあれば
          name: position.name,   // 名前
          area: position.area,   // 場所
          rows: requirements   // 時間帯
            .filter((req) => req.positionId === position.id && req.dayType === dayType)   // そのマーク・その日の種類の分
            .sort((reqA, reqB) => reqA.from - reqB.from)   // 早い順
            .map((req) => ({ from: req.from, to: req.to, count: req.count })),   // 時間と人数
          dirty: false,      // まだ保存していない変更があるか
        }
      : null;   // なければ null
    hoursDraft = { ...hours[dayType], dirty: false };   // 営業時間の入力
  }

  /** 保存していない変更があれば聞いてから、次へ進む */
  async function leaveDraft() {   // 保存していなければ聞く関数
    if (!(draft?.dirty || hoursDraft?.dirty)) return true;   // 変えていなければそのまま進む
    const yes = await confirmDialog({   // 保存するか聞く
      title: "保存していない変更があります",   // タイトル
      body: createElement("p", { style: { margin: 0 } }, "保存してから移りますか？"),   // 説明
      yes: "保存する", no: "保存しない",   // ボタンの文字
    });
    if (yes) {   // 保存するなら
      if (draft?.dirty && !(await saveMarker())) return false;   // マークを保存（失敗したら止まる）
      if (hoursDraft?.dirty && !(await saveHours())) return false;   // 営業時間を保存（失敗したら止まる）
    }
    return true;   // 進んでよい
  }

  // ============================================================
  // 保存
  // ============================================================

  /** 選んだマークの名前・種類・時間帯と人数を保存 */
  async function saveMarker() {   // マークを保存する関数
    const bad = draft.rows.find((row) => row.to <= row.from);   // 終わりが始まりより前の時間帯
    if (bad) { toast("「まで」は「から」より後にしてください"); return false; }   // 時間がおかしければ止める
    const position = positions.find((position) => position.id === selectedId);   // 選んでいるマーク
    position.name = draft.name.trim() || position.name;   // 名前
    position.area = draft.area;   // 場所
    await api.savePositions(positions);   // 場所を保存
    await api.saveRequirements(position.id, dayType, draft.rows);   // 時間帯を保存
    requirements = await api.listRequirements();   // 読みなおす
    draft.dirty = false;   // 保存した印
    toast("保存しました");   // お知らせ
    return true;   // できた
  }

  /** 営業時間を保存 */
  async function saveHours() {   // 営業時間を保存する関数
    if (hoursDraft.close <= hoursDraft.open) { toast("閉店は開店より後にしてください"); return false; }   // 閉店が開店より前なら止める
    hours = { ...hours, [dayType]: { open: hoursDraft.open, close: hoursDraft.close } };   // その日の種類の営業時間を変える
    await api.saveStoreHours(hours);   // 保存
    hoursDraft.dirty = false;   // 保存した印
    toast("営業時間を保存しました");   // お知らせ
    return true;   // できた
  }

  // ============================================================
  // 描く
  // ============================================================
  function draw() {   // 画面を描く関数
    mount(app,   // 画面に入れる
      screenHeader({   // 見出し
        title: "マップ・必要人数",   // タイトル
        extra: createElement("div", { class: "chip-row" },   // 日の種類のボタン
          DAY_TYPES.map(([key, text]) => createElement("button", {   // 平日・土曜・日祝
            class: "chip", "aria-pressed": String(dayType === key),   // 選んでいるものに印
            onclick: async () => { if (!(await leaveDraft())) return; dayType = key; startDraft(); draw(); },   // 保存を聞いてから切りかえる
          }, text))),   // 文字
      }),
      createElement("div", { class: "screen-body" },   // 本文
        hoursCard(),   // 営業時間のカード
        createElement("div", { class: "editor" },   // マップと右の欄
          createElement("section", { class: "card editor__table" },   // マップのカード
            floor(),   // お店の図
            createElement("div", { class: "chip-row" },   // ボタンの行
              createElement("button", { class: "btn btn--small btn--primary", onclick: addMarker }, "＋ マークを追加"),   // マークを足す
              createElement("span", { class: "home-muted", style: { alignSelf: "center" } }, "マークはドラッグで動かせます。押すと右で直せます"),   // 説明
            ),
          ),
          createElement("div", { class: "editor__side" }, draft ? panel() : createElement("section", { class: "card home-muted" }, "マークを押してください")),   // 右の欄（選んだマーク）
        ),
      ),
    );
  }

  /** 営業時間のカード（その曜日の 開店〜閉店） */
  function hoursCard() {   // 営業時間のカードを作る関数
    const label = DAY_TYPES.find((entry) => entry[0] === dayType)[1];   // 日の種類の名前
    /** 時刻を選ぶセレクト */
    const sel = (value, onPick, aria) => createElement("select", { class: "select num", "aria-label": aria, onchange: (event) => { onPick(Number(event.target.value)); hoursDraft.dirty = true; draw(); } },   // 時間を選ぶ欄を作る
      timeOptions(5 * 60, 24 * 60).map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));   // 5:00〜24:00
    return createElement("section", { class: "card hours-card" },   // カード
      createElement("div", { class: "hours-card__row" },   // 1行
        createElement("strong", null, `営業時間（${label}）`),   // 見出し
        createElement("div", { class: "time-range hours-card__times" },   // 時間の行
          sel(hoursDraft.open, (value) => { hoursDraft.open = value; }, "開店"),   // 開店
          "〜",   // 〜
          sel(hoursDraft.close, (value) => { hoursDraft.close = value; }, "閉店"),   // 閉店
        ),
        createElement("button", { class: `btn btn--small ${hoursDraft.dirty ? "btn--primary" : ""}`, disabled: !hoursDraft.dirty, onclick: async () => { await saveHours(); draw(); } }, hoursDraft.dirty ? "保存" : "保存済み"),   // 保存ボタン
      ),
      hoursDraft.close <= hoursDraft.open ? createElement("div", { class: "notice notice--danger" }, "閉店は開店より後にしてください") : null,   // 時間がおかしい時の知らせ
    );
  }

  /** 間取り図とマーク */
  function floor() {   // お店の図を作る関数
    const map = createElement("div", { class: "floor", style: { aspectRatio: `${MAP_W} / ${MAP_H}` } },   // マップの入れ物
      // 間取り（見本のコメダ。あとで店ごとに画像を入れられるようにする）
      zone("floor__kitchen", 500, 0, 340, 190, "キッチン"),   // キッチン
      zone("floor__counter", 520, 190, 270, 56, "カウンター"),   // カウンター
      [[30, 18], [220, 18]].map(([left, top]) => zone("floor__sofa", left, top, 170, 112)),   // 上のソファ席
      [[0, 180], [0, 340]].map(([left, top]) => zone("floor__sofa", left, top, 120, 140)),   // 左のソファ席
      [[170, 200], [320, 200], [170, 340], [320, 340], [540, 330], [680, 330]].map(([left, top]) => zone("floor__table", left, top, 110, 56)),   // テーブル席
      zone("floor__sofa", 530, 470, 280, 44),   // 下のソファ席
      zone("floor__door", 370, 560, 110, 20, "入口"),   // 入口
    );
    positions.forEach((position) => map.appendChild(marker(position, map)));   // マークを置く
    return map;   // 図を返す
  }

  /** 四角い場所（座標を％に直して置く） */
  function zone(className, left, top, width, height, text) {   // 図の中の区切りを作る関数
    return createElement("div", { class: `floor__zone ${className}`, style: { left: `${(left / MAP_W) * 100}%`, top: `${(top / MAP_H) * 100}%`, width: `${(width / MAP_W) * 100}%`, height: `${(height / MAP_H) * 100}%` } }, text || null);   // 位置と大きさを％で
  }

  /** そのマークの時間帯（直している途中なら、その内容を見せる） */
  function rowsOf(position) {   // マークの時間帯を出す関数
    if (position.id === selectedId && draft) return draft.rows;   // 選んでいて直している途中ならその内容
    return requirements.filter((req) => req.positionId === position.id && req.dayType === dayType).sort((reqA, reqB) => reqA.from - reqB.from);   // 保存してある分
  }

  /** 人のマーク（人の形のアイコン＋上に時間と人数） */
  function marker(position, map) {   // マークを作る関数
    const rows = rowsOf(position);   // そのマークの時間帯
    const area = position.id === selectedId && draft ? draft.area : position.area;   // そのマークの場所（直している途中ならその値）
    const name = position.id === selectedId && draft ? draft.name : position.name;   // そのマークの名前（直している途中ならその値）
    const el = createElement("button", {   // 人のマーク
      class: `marker marker--${area} ${position.id === selectedId ? "is-selected" : ""} ${rows.length === 0 ? "is-empty" : ""}`,   // 場所の色・選んでいるか・未設定か
      style: { left: `${(position.x / MAP_W) * 100}%`, top: `${(position.y / MAP_H) * 100}%` },   // 位置
      "aria-label": `${name}：${rows.length ? rows.map((row) => `${range(row.from, row.to)} ${row.count}人`).join("、") : "未設定"}`,   // 読み上げの説明
    },
      // 上の吹き出し：何時〜何時・何人
      createElement("span", { class: "marker__bubble num" },   // 吹き出し
        rows.length   // 時間帯があれば
          ? rows.map((row) => createElement("span", { class: "marker__line" }, `${range(row.from, row.to)} ${row.count}人`))   // 時間と人数
          : createElement("span", { class: "marker__line" }, "未設定")),   // なければ未設定
      personIcon(),   // 人の形
      createElement("span", { class: "marker__name" }, name),   // 名前
    );

    el.addEventListener("pointerdown", (event) => {   // 指・マウスを置いた時
      const box = map.getBoundingClientRect();   // マップの位置と大きさ
      const startX = event.clientX, startY = event.clientY, startLeft = position.x, startTop = position.y;   // 押し始めた位置と、マークの元の位置
      let moved = false;   // 動かしたか
      el.setPointerCapture(event.pointerId);   // 指をはなすまで追いかける
      /** 指・マウスを動かしている間 */
      const move = (moveEvent) => {   // 動かしている時
        const movedX = ((moveEvent.clientX - startX) / box.width) * MAP_W;   // 横に動いた分（マップの単位）
        const movedY = ((moveEvent.clientY - startY) / box.height) * MAP_H;   // 縦に動いた分
        if (Math.abs(movedX) + Math.abs(movedY) > 4) moved = true;   // 少しでも動いたら覚える
        position.x = Math.round(Math.max(20, Math.min(MAP_W - 20, startLeft + movedX)));   // 横の位置（はみ出さない）
        position.y = Math.round(Math.max(40, Math.min(MAP_H - 20, startTop + movedY)));   // 縦の位置（はみ出さない）
        el.style.left = `${(position.x / MAP_W) * 100}%`;   // 見た目の横の位置
        el.style.top = `${(position.y / MAP_H) * 100}%`;   // 見た目の縦の位置
      };
      /** はなした時（動かしたら保存） */
      const up = async () => {   // 指をはなした時
        el.removeEventListener("pointermove", move);   // 追いかけをやめる
        el.removeEventListener("pointerup", up);   // 追いかけをやめる
        if (moved) {   // 動かしたなら
          await api.savePositions(positions);       // 場所の移動はすぐ保存
        }
        if (position.id !== selectedId) {   // 動かさずに押したなら
          if (!(await leaveDraft())) return draw();   // 保存を聞く
          selectedId = position.id;   // 選ぶ
          startDraft();   // 入力を用意する
        }
        draw();   // 描く
      };
      el.addEventListener("pointermove", move);   // 動かしている時を見る
      el.addEventListener("pointerup", up);   // はなした時を見る
    });
    return el;   // マークを返す
  }

  /** 人の形のアイコン（丸い頭＋半円の体） */
  function personIcon() {   // 人の形の絵を作る関数
    const ns = "http://www.w3.org/2000/svg";   // SVG の決まりの住所
    const svg = document.createElementNS(ns, "svg");   // 人の形の絵
    svg.setAttribute("viewBox", "0 0 40 44");   // 絵の大きさの決まり
    svg.setAttribute("class", "marker__person");   // 見た目
    svg.setAttribute("aria-hidden", "true");   // 読み上げでは読まない
    const head = document.createElementNS(ns, "circle");   // 頭
    head.setAttribute("cx", "20"); head.setAttribute("cy", "11"); head.setAttribute("r", "10");   // 頭（丸）
    const body = document.createElementNS(ns, "path");   // 体
    body.setAttribute("d", "M3 44 C3 30 10 23 20 23 C30 23 37 30 37 44 Z");   // 体
    svg.append(head, body);   // 入れる
    return svg;   // 返す
  }

  /** 右の欄：名前・種類・時間帯と人数・保存 */
  function panel() {   // 右の欄を作る関数
    /** 直したことを覚えて描き直す */
    const touch = () => { draft.dirty = true; draw(); };   // 変えた印を付けて描きなおす
    /** 時刻を選ぶセレクト */
    const timeSel = (value, onPick, aria) => createElement("select", { class: "select num", "aria-label": aria, onchange: (event) => { onPick(Number(event.target.value)); touch(); } },   // 時間を選ぶ欄を作る
      timeOptions(5 * 60, 24 * 60).map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));   // 5:00〜24:00

    return createElement("section", { class: "card" },   // カード
      createElement("label", { class: "field" }, "場所の名前",   // 場所の名前
        createElement("input", { class: "input", value: draft.name, oninput: (event) => { draft.name = event.target.value; draft.dirty = true; } })),   // 名前の欄
      createElement("div", { class: "chip-row" },   // ボタンの行
        createElement("button", { class: "chip chip--kitchen", "aria-pressed": String(draft.area === "kitchen"), onclick: () => { draft.area = "kitchen"; touch(); } }, "キッチン"),   // キッチン
        createElement("button", { class: "chip chip--hall", "aria-pressed": String(draft.area === "hall"), onclick: () => { draft.area = "hall"; touch(); } }, "ホール"),   // ホール
      ),
      createElement("div", { class: "home-muted" }, `この場所に、何時から何時まで・何人必要？（${DAY_TYPES.find((eachDayType) => eachDayType[0] === dayType)[1]}）`),   // 説明
      draft.rows.length === 0 ? createElement("div", { class: "home-muted" }, "まだ時間帯がありません") : null,   // 時間帯がない時の文
      draft.rows.map((row, index) => createElement("div", { class: `req-row ${row.to <= row.from ? "is-bad" : ""}` },   // 時間帯ごとに
        createElement("div", { class: "time-range" },   // 時間の行
          timeSel(row.from, (value) => { row.from = value; }, "から"), "〜",   // から
          timeSel(row.to, (value) => { row.to = value; }, "まで"),   // まで
        ),
        createElement("div", { class: "req-row__count" },   // 人数
          createElement("button", { class: "btn btn--small", "aria-label": "人数を減らす", onclick: () => { row.count = Math.max(1, row.count - 1); touch(); } }, "−"),   // 減らす
          createElement("strong", { class: "num" }, `${row.count}人`),   // 人数
          createElement("button", { class: "btn btn--small", "aria-label": "人数を増やす", onclick: () => { row.count = Math.min(9, row.count + 1); touch(); } }, "＋"),   // 増やす
          createElement("button", { class: "btn btn--small btn--danger", onclick: () => { draft.rows.splice(index, 1); touch(); } }, "削除"),   // 消す
        ),
        row.to <= row.from ? createElement("div", { class: "notice notice--danger" }, "「まで」は「から」より後にしてください") : null,   // 時間がおかしい時の知らせ
        // 営業時間を短くした時などに、はみ出していることを知らせる
        row.from < hours[dayType].open || row.to > hours[dayType].close   // 営業時間の外なら
          ? createElement("div", { class: "notice notice--warn" }, `営業時間（${range(hours[dayType].open, hours[dayType].close)}）の外が入っています`)   // 知らせる
          : null,   // なければ出さない
      )),
      createElement("button", {   // 時間帯を足すボタン
        class: "btn btn--dashed",   // 点線のボタン
        onclick: () => {   // 押した時
          // 前の時間帯の続きから2時間（営業時間の中に収める）
          const { open, close } = hours[dayType];   // 営業時間
          const start = draft.rows.length ? Math.min(draft.rows[draft.rows.length - 1].to, close - 60) : open;   // 新しい時間帯の始まり
          draft.rows.push({ from: start, to: Math.min(close, start + 120), count: 1 });   // 2時間・1人で足す
          touch();   // 変えた印
        },
      }, "＋ 時間帯を追加"),   // 文字
      draft.dirty ? createElement("div", { class: "notice notice--warn" }, "まだ保存していません") : null,   // 保存していない知らせ
      createElement("button", { class: "btn btn--primary btn--block", onclick: async () => { if (await saveMarker()) draw(); } }, "保存する"),   // 保存ボタン
      createElement("button", { class: "btn btn--small btn--danger", onclick: removeMarker }, "このマークを削除"),   // マークを消すボタン
    );
  }

  // ============================================================
  // マークの追加・削除
  // ============================================================
  async function addMarker() {   // マークを足す関数
    if (!(await leaveDraft())) return;   // 保存を聞く
    const position = { id: `p${Date.now()}`, name: "新しい場所", area: "hall", x: 420, y: 290 };   // 新しいマーク
    positions.push(position);   // 足す
    await api.savePositions(positions);   // 保存
    selectedId = position.id;   // 選ぶ
    startDraft();   // 入力を用意する
    toast("マークを追加しました。名前と時間帯を決めて「保存する」を押してください");   // お知らせ
    draw();   // 描く
  }

  /** 選んでいるマークを消す */
  async function removeMarker() {   // マークを消す関数
    const position = positions.find((position) => position.id === selectedId);   // 選んでいるマーク
    const ok = await confirmDialog({ title: `「${position.name}」を削除しますか？`, body: createElement("p", { style: { margin: 0 } }, "この場所の必要人数も消えます。"), yes: "削除", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;   // 「いいえ」なら止める
    positions = positions.filter((position) => position.id !== selectedId);   // 消す
    await api.savePositions(positions);   // 保存
    requirements = await api.listRequirements();   // 読みなおす
    selectedId = positions[0]?.id || null;   // ほかのマークを選ぶ
    startDraft();   // 入力を用意する
    draw();   // 描く
  }
}
