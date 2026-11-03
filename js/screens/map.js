// ============================================================
// screens/map.js — 店舗マップ・必要人数・営業時間（店長）
// ------------------------------------------------------------
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

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { screenHeader } from "../components/header.js";
import { range, timeOptions } from "../lib/time.js";

const MAP_W = 840;
const MAP_H = 580;
const DAY_TYPES = [["weekday", "平日"], ["sat", "土曜"], ["sun", "日曜・祝日"]];

export async function renderMap(app) {
  // ---------- 保存されているデータ ----------
  let positions = await api.listPositions();
  let requirements = await api.listRequirements();
  let hours = await api.getStoreHours();

  // ---------- 画面の中の状態 ----------
  let dayType = "weekday";
  let selectedId = positions[0]?.id || null;
  let draft = null;          // 右の欄で直している途中の内容（保存するまで本物は変わらない）
  let hoursDraft = null;     // 営業時間の直している途中の内容

  startDraft();
  draw();

  // ============================================================
  // 「直している途中」の管理
  // ============================================================

  /** 選んだマークの今の内容を、直す用にコピーする */
  function startDraft() {
    const p = positions.find((x) => x.id === selectedId);
    draft = p
      ? {
          name: p.name,
          area: p.area,
          rows: requirements
            .filter((r) => r.positionId === p.id && r.dayType === dayType)
            .sort((a, b) => a.from - b.from)
            .map((r) => ({ from: r.from, to: r.to, count: r.count })),
          dirty: false,      // まだ保存していない変更があるか
        }
      : null;
    hoursDraft = { ...hours[dayType], dirty: false };
  }

  /** 保存していない変更があれば聞いてから、次へ進む */
  async function leaveDraft() {
    if (!(draft?.dirty || hoursDraft?.dirty)) return true;
    const yes = await confirmDialog({
      title: "保存していない変更があります",
      body: h("p", { style: { margin: 0 } }, "保存してから移りますか？"),
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
    const bad = draft.rows.find((r) => r.to <= r.from);
    if (bad) { toast("「まで」は「から」より後にしてください"); return false; }
    const p = positions.find((x) => x.id === selectedId);
    p.name = draft.name.trim() || p.name;
    p.area = draft.area;
    await api.savePositions(positions);
    await api.saveRequirements(p.id, dayType, draft.rows);
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
        extra: h("div", { class: "chip-row" },
          DAY_TYPES.map(([key, text]) => h("button", {
            class: "chip", "aria-pressed": String(dayType === key),
            onclick: async () => { if (!(await leaveDraft())) return; dayType = key; startDraft(); draw(); },
          }, text))),
      }),
      h("div", { class: "screen-body" },
        hoursCard(),
        h("div", { class: "editor" },
          h("section", { class: "card editor__table" },
            floor(),
            h("div", { class: "chip-row" },
              h("button", { class: "btn btn--small btn--primary", onclick: addMarker }, "＋ マークを追加"),
              h("span", { class: "home-muted", style: { alignSelf: "center" } }, "マークはドラッグで動かせます。押すと右で直せます"),
            ),
          ),
          h("div", { class: "editor__side" }, draft ? panel() : h("section", { class: "card home-muted" }, "マークを押してください")),
        ),
      ),
    );
  }

  /** 営業時間のカード（その曜日の 開店〜閉店） */
  function hoursCard() {
    const label = DAY_TYPES.find((d) => d[0] === dayType)[1];
    const sel = (value, onPick, aria) => h("select", { class: "select num", "aria-label": aria, onchange: (e) => { onPick(Number(e.target.value)); hoursDraft.dirty = true; draw(); } },
      timeOptions(5 * 60, 24 * 60).map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));
    return h("section", { class: "card hours-card" },
      h("div", { class: "hours-card__row" },
        h("strong", null, `営業時間（${label}）`),
        h("div", { class: "time-range hours-card__times" },
          sel(hoursDraft.open, (v) => { hoursDraft.open = v; }, "開店"),
          "〜",
          sel(hoursDraft.close, (v) => { hoursDraft.close = v; }, "閉店"),
        ),
        h("button", { class: `btn btn--small ${hoursDraft.dirty ? "btn--primary" : ""}`, disabled: !hoursDraft.dirty, onclick: async () => { await saveHours(); draw(); } }, hoursDraft.dirty ? "保存" : "保存済み"),
      ),
      hoursDraft.close <= hoursDraft.open ? h("div", { class: "notice notice--danger" }, "閉店は開店より後にしてください") : null,
    );
  }

  /** 間取り図とマーク */
  function floor() {
    const map = h("div", { class: "floor", style: { aspectRatio: `${MAP_W} / ${MAP_H}` } },
      // 間取り（見本のコメダ。あとで店ごとに画像を入れられるようにする）
      zone("floor__kitchen", 500, 0, 340, 190, "キッチン"),
      zone("floor__counter", 520, 190, 270, 56, "カウンター"),
      [[30, 18], [220, 18]].map(([x, y]) => zone("floor__sofa", x, y, 170, 112)),
      [[0, 180], [0, 340]].map(([x, y]) => zone("floor__sofa", x, y, 120, 140)),
      [[170, 200], [320, 200], [170, 340], [320, 340], [540, 330], [680, 330]].map(([x, y]) => zone("floor__table", x, y, 110, 56)),
      zone("floor__sofa", 530, 470, 280, 44),
      zone("floor__door", 370, 560, 110, 20, "入口"),
    );
    positions.forEach((p) => map.appendChild(marker(p, map)));
    return map;
  }

  /** 四角い場所（座標を％に直して置く） */
  function zone(cls, x, y, w, hgt, text) {
    return h("div", { class: `floor__zone ${cls}`, style: { left: `${(x / MAP_W) * 100}%`, top: `${(y / MAP_H) * 100}%`, width: `${(w / MAP_W) * 100}%`, height: `${(hgt / MAP_H) * 100}%` } }, text || null);
  }

  /** そのマークの時間帯（直している途中なら、その内容を見せる） */
  function rowsOf(p) {
    if (p.id === selectedId && draft) return draft.rows;
    return requirements.filter((r) => r.positionId === p.id && r.dayType === dayType).sort((a, b) => a.from - b.from);
  }

  /** 人のマーク（人の形のアイコン＋上に時間と人数） */
  function marker(p, map) {
    const rows = rowsOf(p);
    const area = p.id === selectedId && draft ? draft.area : p.area;
    const name = p.id === selectedId && draft ? draft.name : p.name;
    const el = h("button", {
      class: `marker marker--${area} ${p.id === selectedId ? "is-selected" : ""} ${rows.length === 0 ? "is-empty" : ""}`,
      style: { left: `${(p.x / MAP_W) * 100}%`, top: `${(p.y / MAP_H) * 100}%` },
      "aria-label": `${name}：${rows.length ? rows.map((r) => `${range(r.from, r.to)} ${r.count}人`).join("、") : "未設定"}`,
    },
      // 上の吹き出し：何時〜何時・何人
      h("span", { class: "marker__bubble num" },
        rows.length
          ? rows.map((r) => h("span", { class: "marker__line" }, `${range(r.from, r.to)} ${r.count}人`))
          : h("span", { class: "marker__line" }, "未設定")),
      personIcon(),
      h("span", { class: "marker__name" }, name),
    );

    el.addEventListener("pointerdown", (e) => {
      const box = map.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, ox = p.x, oy = p.y;
      let moved = false;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ((ev.clientX - sx) / box.width) * MAP_W;
        const dy = ((ev.clientY - sy) / box.height) * MAP_H;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        p.x = Math.round(Math.max(20, Math.min(MAP_W - 20, ox + dx)));
        p.y = Math.round(Math.max(40, Math.min(MAP_H - 20, oy + dy)));
        el.style.left = `${(p.x / MAP_W) * 100}%`;
        el.style.top = `${(p.y / MAP_H) * 100}%`;
      };
      const up = async () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        if (moved) {
          await api.savePositions(positions);       // 場所の移動はすぐ保存
        }
        if (p.id !== selectedId) {
          if (!(await leaveDraft())) return draw();
          selectedId = p.id;
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
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 40 44");
    svg.setAttribute("class", "marker__person");
    svg.setAttribute("aria-hidden", "true");
    const head = document.createElementNS(ns, "circle");
    head.setAttribute("cx", "20"); head.setAttribute("cy", "11"); head.setAttribute("r", "10");
    const body = document.createElementNS(ns, "path");
    body.setAttribute("d", "M3 44 C3 30 10 23 20 23 C30 23 37 30 37 44 Z");
    svg.append(head, body);
    return svg;
  }

  /** 右の欄：名前・種類・時間帯と人数・保存 */
  function panel() {
    const touch = () => { draft.dirty = true; draw(); };
    const timeSel = (value, onPick, aria) => h("select", { class: "select num", "aria-label": aria, onchange: (e) => { onPick(Number(e.target.value)); touch(); } },
      timeOptions(5 * 60, 24 * 60).map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));

    return h("section", { class: "card" },
      h("label", { class: "field" }, "場所の名前",
        h("input", { class: "input", value: draft.name, oninput: (e) => { draft.name = e.target.value; draft.dirty = true; } })),
      h("div", { class: "chip-row" },
        h("button", { class: "chip chip--kitchen", "aria-pressed": String(draft.area === "kitchen"), onclick: () => { draft.area = "kitchen"; touch(); } }, "キッチン"),
        h("button", { class: "chip chip--hall", "aria-pressed": String(draft.area === "hall"), onclick: () => { draft.area = "hall"; touch(); } }, "ホール"),
      ),
      h("div", { class: "home-muted" }, `この場所に、何時から何時まで・何人必要？（${DAY_TYPES.find((d) => d[0] === dayType)[1]}）`),
      draft.rows.length === 0 ? h("div", { class: "home-muted" }, "まだ時間帯がありません") : null,
      draft.rows.map((r, i) => h("div", { class: `req-row ${r.to <= r.from ? "is-bad" : ""}` },
        h("div", { class: "time-range" },
          timeSel(r.from, (v) => { r.from = v; }, "から"), "〜",
          timeSel(r.to, (v) => { r.to = v; }, "まで"),
        ),
        h("div", { class: "req-row__count" },
          h("button", { class: "btn btn--small", "aria-label": "人数を減らす", onclick: () => { r.count = Math.max(1, r.count - 1); touch(); } }, "−"),
          h("strong", { class: "num" }, `${r.count}人`),
          h("button", { class: "btn btn--small", "aria-label": "人数を増やす", onclick: () => { r.count = Math.min(9, r.count + 1); touch(); } }, "＋"),
          h("button", { class: "btn btn--small btn--danger", onclick: () => { draft.rows.splice(i, 1); touch(); } }, "削除"),
        ),
        r.to <= r.from ? h("div", { class: "notice notice--danger" }, "「まで」は「から」より後にしてください") : null,
        // 営業時間を短くした時などに、はみ出していることを知らせる
        r.from < hours[dayType].open || r.to > hours[dayType].close
          ? h("div", { class: "notice notice--warn" }, `営業時間（${range(hours[dayType].open, hours[dayType].close)}）の外が入っています`)
          : null,
      )),
      h("button", {
        class: "btn btn--dashed",
        onclick: () => {
          // 前の時間帯の続きから2時間（営業時間の中に収める）
          const { open, close } = hours[dayType];
          const start = draft.rows.length ? Math.min(draft.rows[draft.rows.length - 1].to, close - 60) : open;
          draft.rows.push({ from: start, to: Math.min(close, start + 120), count: 1 });
          touch();
        },
      }, "＋ 時間帯を追加"),
      draft.dirty ? h("div", { class: "notice notice--warn" }, "まだ保存していません") : null,
      h("button", { class: "btn btn--primary btn--block", onclick: async () => { if (await saveMarker()) draw(); } }, "保存する"),
      h("button", { class: "btn btn--small btn--danger", onclick: removeMarker }, "このマークを削除"),
    );
  }

  // ============================================================
  // マークの追加・削除
  // ============================================================
  async function addMarker() {
    if (!(await leaveDraft())) return;
    const p = { id: `p${Date.now()}`, name: "新しい場所", area: "hall", x: 420, y: 290 };
    positions.push(p);
    await api.savePositions(positions);
    selectedId = p.id;
    startDraft();
    toast("マークを追加しました。名前と時間帯を決めて「保存する」を押してください");
    draw();
  }

  async function removeMarker() {
    const p = positions.find((x) => x.id === selectedId);
    const ok = await confirmDialog({ title: `「${p.name}」を削除しますか？`, body: h("p", { style: { margin: 0 } }, "この場所の必要人数も消えます。"), yes: "削除", no: "やめる" });
    if (!ok) return;
    positions = positions.filter((x) => x.id !== selectedId);
    await api.savePositions(positions);
    requirements = await api.listRequirements();
    selectedId = positions[0]?.id || null;
    startDraft();
    draw();
  }
}
