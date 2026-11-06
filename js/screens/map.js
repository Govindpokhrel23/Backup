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

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { screenHeader } from "../components/header.js";
import { range, timeOptions } from "../lib/time.js";

const MAP_W = 840;   // マップの横の大きさ（点の位置の単位）
const MAP_H = 580;   // マップの縦の大きさ
const DAY_TYPES = [["weekday", "平日"], ["sat", "土曜"], ["sun", "日曜・祝日"]];   // 日の種類と名前

/** マップ・必要人数・営業時間の画面を描く（店長） */
export async function renderMap(app) {
  // ---------- 保存されているデータ ----------
  let positions = await api.listPositions();
  let requirements = await api.listRequirements();   // 必要人数
  let hours = await api.getStoreHours();   // 営業時間

  // ---------- 画面の中の状態 ----------
  let dayType = "weekday";
  let selectedId = positions[0]?.id || null;   // 選んでいるマーク
  let draft = null;          // 右の欄で直している途中の内容（保存するまで本物は変わらない）
  let hoursDraft = null;     // 営業時間の直している途中の内容

  startDraft();
  draw();

  // ============================================================
  // 「直している途中」の管理
  // ============================================================

  /** 選んだマークの今の内容を、直す用にコピーする */
  function startDraft() {
    const position = positions.find((position) => position.id === selectedId);   // 選んでいるマーク
    draft = position
      ? {
          name: position.name,
          area: position.area,
          rows: requirements
            .filter((req) => req.positionId === position.id && req.dayType === dayType)
            .sort((reqA, reqB) => reqA.from - reqB.from)
            .map((req) => ({ from: req.from, to: req.to, count: req.count })),
          dirty: false,      // まだ保存していない変更があるか
        }
      : null;
    hoursDraft = { ...hours[dayType], dirty: false };
  }

  /** 保存していない変更があれば聞いてから、次へ進む */
  async function leaveDraft() {
    if (!(draft?.dirty || hoursDraft?.dirty)) return true;
    const yes = await confirmDialog({   // 保存するか聞く
      title: "保存していない変更があります",
      body: createElement("p", { style: { margin: 0 } }, "保存してから移りますか？"),
      yes: "保存する", no: "保存しない",
    });
    if (yes) {
      if (draft?.dirty && !(await saveMarker())) return false;
      if (hoursDraft?.dirty && !(await saveHours())) return false;
    }
    return true;
  }

  // ============================================================
  // 保存
  // ============================================================

  /** 選んだマークの名前・種類・時間帯と人数を保存 */
  async function saveMarker() {
    const bad = draft.rows.find((row) => row.to <= row.from);   // 終わりが始まりより前の時間帯
    if (bad) { toast("「まで」は「から」より後にしてください"); return false; }
    const position = positions.find((position) => position.id === selectedId);   // 選んでいるマーク
    position.name = draft.name.trim() || position.name;
    position.area = draft.area;
    await api.savePositions(positions);
    await api.saveRequirements(position.id, dayType, draft.rows);
    requirements = await api.listRequirements();
    draft.dirty = false;
    toast("保存しました");
    return true;
  }

  /** 営業時間を保存 */
  async function saveHours() {
    if (hoursDraft.close <= hoursDraft.open) { toast("閉店は開店より後にしてください"); return false; }
    hours = { ...hours, [dayType]: { open: hoursDraft.open, close: hoursDraft.close } };
    await api.saveStoreHours(hours);
    hoursDraft.dirty = false;
    toast("営業時間を保存しました");
    return true;
  }

  // ============================================================
  // 描く
  // ============================================================
  function draw() {
    mount(app,
      screenHeader({
        title: "マップ・必要人数",
        extra: createElement("div", { class: "chip-row" },
          DAY_TYPES.map(([key, text]) => createElement("button", {
            class: "chip", "aria-pressed": String(dayType === key),
            onclick: async () => { if (!(await leaveDraft())) return; dayType = key; startDraft(); draw(); },
          }, text))),
      }),
      createElement("div", { class: "screen-body" },
        hoursCard(),
        createElement("div", { class: "editor" },
          createElement("section", { class: "card editor__table" },
            floor(),
            createElement("div", { class: "chip-row" },
              createElement("button", { class: "btn btn--small btn--primary", onclick: addMarker }, "＋ マークを追加"),
              createElement("span", { class: "home-muted", style: { alignSelf: "center" } }, "マークはドラッグで動かせます。押すと右で直せます"),
            ),
          ),
          createElement("div", { class: "editor__side" }, draft ? panel() : createElement("section", { class: "card home-muted" }, "マークを押してください")),
        ),
      ),
    );
  }

  /** 営業時間のカード（その曜日の 開店〜閉店） */
  function hoursCard() {
    const label = DAY_TYPES.find((entry) => entry[0] === dayType)[1];   // 日の種類の名前
    /** 時刻を選ぶセレクト */
    const sel = (value, onPick, aria) => createElement("select", { class: "select num", "aria-label": aria, onchange: (event) => { onPick(Number(event.target.value)); hoursDraft.dirty = true; draw(); } },
      timeOptions(5 * 60, 24 * 60).map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));
    return createElement("section", { class: "card hours-card" },
      createElement("div", { class: "hours-card__row" },
        createElement("strong", null, `営業時間（${label}）`),
        createElement("div", { class: "time-range hours-card__times" },
          sel(hoursDraft.open, (value) => { hoursDraft.open = value; }, "開店"),
          "〜",
          sel(hoursDraft.close, (value) => { hoursDraft.close = value; }, "閉店"),
        ),
        createElement("button", { class: `btn btn--small ${hoursDraft.dirty ? "btn--primary" : ""}`, disabled: !hoursDraft.dirty, onclick: async () => { await saveHours(); draw(); } }, hoursDraft.dirty ? "保存" : "保存済み"),
      ),
      hoursDraft.close <= hoursDraft.open ? createElement("div", { class: "notice notice--danger" }, "閉店は開店より後にしてください") : null,
    );
  }

  /** 間取り図とマーク */
  function floor() {
    const map = createElement("div", { class: "floor", style: { aspectRatio: `${MAP_W} / ${MAP_H}` } },   // マップの入れ物
      // 間取り（見本のコメダ。あとで店ごとに画像を入れられるようにする）
      zone("floor__kitchen", 500, 0, 340, 190, "キッチン"),
      zone("floor__counter", 520, 190, 270, 56, "カウンター"),
      [[30, 18], [220, 18]].map(([left, top]) => zone("floor__sofa", left, top, 170, 112)),
      [[0, 180], [0, 340]].map(([left, top]) => zone("floor__sofa", left, top, 120, 140)),
      [[170, 200], [320, 200], [170, 340], [320, 340], [540, 330], [680, 330]].map(([left, top]) => zone("floor__table", left, top, 110, 56)),
      zone("floor__sofa", 530, 470, 280, 44),
      zone("floor__door", 370, 560, 110, 20, "入口"),
    );
    positions.forEach((position) => map.appendChild(marker(position, map)));
    return map;
  }

  /** 四角い場所（座標を％に直して置く） */
  function zone(cls, left, top, width, hgt, text) {
    return createElement("div", { class: `floor__zone ${cls}`, style: { left: `${(left / MAP_W) * 100}%`, top: `${(top / MAP_H) * 100}%`, width: `${(width / MAP_W) * 100}%`, height: `${(hgt / MAP_H) * 100}%` } }, text || null);
  }

  /** そのマークの時間帯（直している途中なら、その内容を見せる） */
  function rowsOf(props) {
    if (props.id === selectedId && draft) return draft.rows;
    return requirements.filter((req) => req.positionId === props.id && req.dayType === dayType).sort((reqA, reqB) => reqA.from - reqB.from);
  }

  /** 人のマーク（人の形のアイコン＋上に時間と人数） */
  function marker(position, map) {
    const rows = rowsOf(position);   // そのマークの時間帯
    const area = position.id === selectedId && draft ? draft.area : position.area;   // そのマークの場所（直している途中ならその値）
    const name = position.id === selectedId && draft ? draft.name : position.name;   // そのマークの名前（直している途中ならその値）
    const el = createElement("button", {   // 人のマーク
      class: `marker marker--${area} ${position.id === selectedId ? "is-selected" : ""} ${rows.length === 0 ? "is-empty" : ""}`,
      style: { left: `${(position.x / MAP_W) * 100}%`, top: `${(position.y / MAP_H) * 100}%` },
      "aria-label": `${name}：${rows.length ? rows.map((row) => `${range(row.from, row.to)} ${row.count}人`).join("、") : "未設定"}`,
    },
      // 上の吹き出し：何時〜何時・何人
      createElement("span", { class: "marker__bubble num" },
        rows.length
          ? rows.map((row) => createElement("span", { class: "marker__line" }, `${range(row.from, row.to)} ${row.count}人`))
          : createElement("span", { class: "marker__line" }, "未設定")),
      personIcon(),
      createElement("span", { class: "marker__name" }, name),
    );

    el.addEventListener("pointerdown", (event) => {
      const box = map.getBoundingClientRect();   // マップの位置と大きさ
      const sx = event.clientX, sy = event.clientY, ox = position.x, oy = position.y;   // 押し始めた位置と、マークの元の位置
      let moved = false;   // 動かしたか
      el.setPointerCapture(event.pointerId);
      /** 指・マウスを動かしている間 */
      const move = (ev) => {
        const dx = ((ev.clientX - sx) / box.width) * MAP_W;   // 横に動いた分（マップの単位）
        const dy = ((ev.clientY - sy) / box.height) * MAP_H;   // 縦に動いた分
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        position.x = Math.round(Math.max(20, Math.min(MAP_W - 20, ox + dx)));
        position.y = Math.round(Math.max(40, Math.min(MAP_H - 20, oy + dy)));
        el.style.left = `${(position.x / MAP_W) * 100}%`;
        el.style.top = `${(position.y / MAP_H) * 100}%`;
      };
      /** はなした時（動かしたら保存） */
      const up = async () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        if (moved) {
          await api.savePositions(positions);       // 場所の移動はすぐ保存
        }
        if (position.id !== selectedId) {
          if (!(await leaveDraft())) return draw();
          selectedId = position.id;
          startDraft();
        }
        draw();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
    return el;
  }

  /** 人の形のアイコン（丸い頭＋半円の体） */
  function personIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");   // 人の形の絵
    svg.setAttribute("viewBox", "0 0 40 44");
    svg.setAttribute("class", "marker__person");
    svg.setAttribute("aria-hidden", "true");
    const head = document.createElementNS(ns, "circle");   // 頭
    head.setAttribute("cx", "20"); head.setAttribute("cy", "11"); head.setAttribute("r", "10");
    const body = document.createElementNS(ns, "path");   // 体
    body.setAttribute("d", "M3 44 C3 30 10 23 20 23 C30 23 37 30 37 44 Z");
    svg.append(head, body);
    return svg;
  }

  /** 右の欄：名前・種類・時間帯と人数・保存 */
  function panel() {
    /** 直したことを覚えて描き直す */
    const touch = () => { draft.dirty = true; draw(); };
    /** 時刻を選ぶセレクト */
    const timeSel = (value, onPick, aria) => createElement("select", { class: "select num", "aria-label": aria, onchange: (event) => { onPick(Number(event.target.value)); touch(); } },
      timeOptions(5 * 60, 24 * 60).map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));

    return createElement("section", { class: "card" },
      createElement("label", { class: "field" }, "場所の名前",
        createElement("input", { class: "input", value: draft.name, oninput: (event) => { draft.name = event.target.value; draft.dirty = true; } })),
      createElement("div", { class: "chip-row" },
        createElement("button", { class: "chip chip--kitchen", "aria-pressed": String(draft.area === "kitchen"), onclick: () => { draft.area = "kitchen"; touch(); } }, "キッチン"),
        createElement("button", { class: "chip chip--hall", "aria-pressed": String(draft.area === "hall"), onclick: () => { draft.area = "hall"; touch(); } }, "ホール"),
      ),
      createElement("div", { class: "home-muted" }, `この場所に、何時から何時まで・何人必要？（${DAY_TYPES.find((eachDayType) => eachDayType[0] === dayType)[1]}）`),
      draft.rows.length === 0 ? createElement("div", { class: "home-muted" }, "まだ時間帯がありません") : null,
      draft.rows.map((row, index) => createElement("div", { class: `req-row ${row.to <= row.from ? "is-bad" : ""}` },
        createElement("div", { class: "time-range" },
          timeSel(row.from, (value) => { row.from = value; }, "から"), "〜",
          timeSel(row.to, (value) => { row.to = value; }, "まで"),
        ),
        createElement("div", { class: "req-row__count" },
          createElement("button", { class: "btn btn--small", "aria-label": "人数を減らす", onclick: () => { row.count = Math.max(1, row.count - 1); touch(); } }, "−"),
          createElement("strong", { class: "num" }, `${row.count}人`),
          createElement("button", { class: "btn btn--small", "aria-label": "人数を増やす", onclick: () => { row.count = Math.min(9, row.count + 1); touch(); } }, "＋"),
          createElement("button", { class: "btn btn--small btn--danger", onclick: () => { draft.rows.splice(index, 1); touch(); } }, "削除"),
        ),
        row.to <= row.from ? createElement("div", { class: "notice notice--danger" }, "「まで」は「から」より後にしてください") : null,
        // 営業時間を短くした時などに、はみ出していることを知らせる
        row.from < hours[dayType].open || row.to > hours[dayType].close
          ? createElement("div", { class: "notice notice--warn" }, `営業時間（${range(hours[dayType].open, hours[dayType].close)}）の外が入っています`)
          : null,
      )),
      createElement("button", {
        class: "btn btn--dashed",
        onclick: () => {
          // 前の時間帯の続きから2時間（営業時間の中に収める）
          const { open, close } = hours[dayType];
          const start = draft.rows.length ? Math.min(draft.rows[draft.rows.length - 1].to, close - 60) : open;   // 新しい時間帯の始まり
          draft.rows.push({ from: start, to: Math.min(close, start + 120), count: 1 });
          touch();
        },
      }, "＋ 時間帯を追加"),
      draft.dirty ? createElement("div", { class: "notice notice--warn" }, "まだ保存していません") : null,
      createElement("button", { class: "btn btn--primary btn--block", onclick: async () => { if (await saveMarker()) draw(); } }, "保存する"),
      createElement("button", { class: "btn btn--small btn--danger", onclick: removeMarker }, "このマークを削除"),
    );
  }

  // ============================================================
  // マークの追加・削除
  // ============================================================
  async function addMarker() {
    if (!(await leaveDraft())) return;
    const position = { id: `p${Date.now()}`, name: "新しい場所", area: "hall", x: 420, y: 290 };   // 新しいマーク
    positions.push(position);
    await api.savePositions(positions);
    selectedId = position.id;
    startDraft();
    toast("マークを追加しました。名前と時間帯を決めて「保存する」を押してください");
    draw();
  }

  /** 選んでいるマークを消す */
  async function removeMarker() {
    const position = positions.find((position) => position.id === selectedId);   // 選んでいるマーク
    const ok = await confirmDialog({ title: `「${position.name}」を削除しますか？`, body: createElement("p", { style: { margin: 0 } }, "この場所の必要人数も消えます。"), yes: "削除", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;
    positions = positions.filter((position) => position.id !== selectedId);
    await api.savePositions(positions);
    requirements = await api.listRequirements();
    selectedId = positions[0]?.id || null;
    startDraft();
    draw();
  }
}
