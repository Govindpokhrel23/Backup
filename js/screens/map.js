// ============================================================
// screens/map.js — 店舗マップ・必要人数（店長）
// ------------------------------------------------------------
// 画面見本で決めた形（2026年11月2日）：
//   ・間取り図の上に「人のマーク」を置く（キッチン＝オレンジ、ホール＝青）
//   ・マークは 追加／ドラッグで移動／名前変更／削除 ができる
//   ・マークを押すと「何時〜何時・何人」を決められる（15分刻み）
//   ・平日／土曜／日曜祝日 で別々に決める
//   ・上の時刻を押すと、マークの数字がその時刻の必要人数になる
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
  let positions = await api.listPositions();
  let requirements = await api.listRequirements();
  let dayType = "weekday";
  let showAt = 11 * 60;                   // マップに数字を出す時刻
  let selectedId = positions[0]?.id || null;

  draw();

  // ------------------------------------------------------------
  // 保存（変えたらすぐ保存する）
  // ------------------------------------------------------------
  async function savePositions() {
    await api.savePositions(positions);
    requirements = await api.listRequirements();   // 消したマークの人数も消えるので読み直す
  }

  async function saveRows(rows) {
    await api.saveRequirements(selectedId, dayType, rows);
    requirements = await api.listRequirements();
    draw();
  }

  /** あるマークの、ある時刻の必要人数 */
  function countAt(positionId, minute) {
    return requirements
      .filter((r) => r.positionId === positionId && r.dayType === dayType && r.from <= minute && minute < r.to)
      .reduce((sum, r) => sum + r.count, 0);
  }

  // ------------------------------------------------------------
  // 描く
  // ------------------------------------------------------------
  function draw() {
    mount(app,
      screenHeader({
        title: "マップ・必要人数",
        extra: h("div", { class: "chip-row" },
          DAY_TYPES.map(([key, text]) => h("button", { class: "chip", "aria-pressed": String(dayType === key), onclick: () => { dayType = key; draw(); } }, text))),
      }),
      h("div", { class: "screen-body" },
        h("div", { class: "chip-row" },
          h("span", { class: "home-muted", style: { alignSelf: "center" } }, "マップの時刻"),
          [7, 9, 11, 13, 15, 17, 19, 21].map((hr) =>
            h("button", { class: "chip chip--small num", "aria-pressed": String(showAt === hr * 60), onclick: () => { showAt = hr * 60; draw(); } }, `${hr}:00`)),
        ),
        h("div", { class: "editor" },
          h("section", { class: "card editor__table" },
            floor(),
            h("div", { class: "chip-row" },
              h("button", { class: "btn btn--small btn--primary", onclick: addMarker }, "＋ マークを追加"),
              h("span", { class: "home-muted", style: { alignSelf: "center" } }, "マークはドラッグで動かせます"),
            ),
            totals(),
          ),
          h("div", { class: "editor__side" }, selectedId ? panel() : h("section", { class: "card home-muted" }, "マークを押してください")),
        ),
      ),
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

  /** 人のマーク（押すと選ぶ、ドラッグで動く） */
  function marker(p, map) {
    const n = countAt(p.id, showAt);
    const el = h("button", {
      class: `marker marker--${p.area} ${p.id === selectedId ? "is-selected" : ""} ${n === 0 ? "is-zero" : ""}`,
      style: { left: `${(p.x / MAP_W) * 100}%`, top: `${(p.y / MAP_H) * 100}%` },
      "aria-label": `${p.name} ${n}人`,
    },
      h("span", { class: "marker__count num" }, n),
      h("span", { class: "marker__name" }, p.name),
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
        p.y = Math.round(Math.max(20, Math.min(MAP_H - 20, oy + dy)));
        el.style.left = `${(p.x / MAP_W) * 100}%`;
        el.style.top = `${(p.y / MAP_H) * 100}%`;
      };
      const up = async () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        selectedId = p.id;
        if (moved) await savePositions();
        draw();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
    return el;
  }

  /** その時刻の合計人数 */
  function totals() {
    const sum = (area) => positions.filter((p) => p.area === area).reduce((s, p) => s + countAt(p.id, showAt), 0);
    return h("div", { class: "home-muted" }, `この時刻の合計：キッチン ${sum("kitchen")}人 ・ ホール ${sum("hall")}人`);
  }

  /** 右の欄：選んだマークの名前・種類・時間帯と人数 */
  function panel() {
    const p = positions.find((x) => x.id === selectedId);
    if (!p) return null;
    const rows = requirements
      .filter((r) => r.positionId === p.id && r.dayType === dayType)
      .sort((a, b) => a.from - b.from)
      .map((r) => ({ from: r.from, to: r.to, count: r.count }));

    const timeSel = (value, onPick, aria) => h("select", { class: "select num", "aria-label": aria, onchange: (e) => onPick(Number(e.target.value)) },
      timeOptions().map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));

    return h("section", { class: "card" },
      h("label", { class: "field" }, "場所の名前",
        h("input", { class: "input", value: p.name, onchange: async (e) => { p.name = e.target.value.trim() || p.name; await savePositions(); draw(); } })),
      h("div", { class: "chip-row" },
        h("button", { class: "chip chip--kitchen", "aria-pressed": String(p.area === "kitchen"), onclick: async () => { p.area = "kitchen"; await savePositions(); draw(); } }, "キッチン"),
        h("button", { class: "chip chip--hall", "aria-pressed": String(p.area === "hall"), onclick: async () => { p.area = "hall"; await savePositions(); draw(); } }, "ホール"),
      ),
      h("div", { class: "home-muted" }, `この場所に、何時から何時まで・何人必要？（${DAY_TYPES.find((d) => d[0] === dayType)[1]}）`),
      rows.length === 0 ? h("div", { class: "home-muted" }, "まだ時間帯がありません") : null,
      rows.map((r, i) => h("div", { class: `req-row ${r.to <= r.from ? "is-bad" : ""}` },
        h("div", { class: "time-range" },
          timeSel(r.from, (v) => { r.from = v; saveRows(rows); }, "から"), "〜",
          timeSel(r.to, (v) => { r.to = v; saveRows(rows); }, "まで"),
        ),
        h("div", { class: "req-row__count" },
          h("button", { class: "btn btn--small", "aria-label": "人数を減らす", onclick: () => { r.count = Math.max(1, r.count - 1); saveRows(rows); } }, "−"),
          h("strong", { class: "num" }, `${r.count}人`),
          h("button", { class: "btn btn--small", "aria-label": "人数を増やす", onclick: () => { r.count = Math.min(9, r.count + 1); saveRows(rows); } }, "＋"),
          h("button", { class: "btn btn--small btn--danger", onclick: () => { rows.splice(i, 1); saveRows(rows); } }, "削除"),
        ),
        r.to <= r.from ? h("div", { class: "notice notice--danger" }, "「まで」は「から」より後にしてください") : null,
        h("div", { class: "home-muted num" }, range(r.from, r.to)),
      )),
      h("button", {
        class: "btn btn--dashed",
        onclick: () => {
          const start = rows.length ? Math.min(rows[rows.length - 1].to, 20 * 60) : 9 * 60;
          rows.push({ from: start, to: Math.min(22 * 60, start + 120), count: 1 });
          saveRows(rows);
        },
      }, "＋ 時間帯を追加"),
      h("button", { class: "btn btn--small btn--danger", onclick: removeMarker }, "このマークを削除"),
    );
  }

  // ------------------------------------------------------------
  // マークの追加・削除
  // ------------------------------------------------------------
  async function addMarker() {
    const p = { id: `p${Date.now()}`, name: "新しい場所", area: "hall", x: 420, y: 290 };
    positions.push(p);
    selectedId = p.id;
    await savePositions();
    toast("マークを追加しました。名前と人数を決めてください");
    draw();
  }

  async function removeMarker() {
    const p = positions.find((x) => x.id === selectedId);
    const ok = await confirmDialog({ title: `「${p.name}」を削除しますか？`, body: h("p", { style: { margin: 0 } }, "この場所の必要人数も消えます。"), yes: "削除", no: "やめる" });
    if (!ok) return;
    positions = positions.filter((x) => x.id !== selectedId);
    selectedId = positions[0]?.id || null;
    await savePositions();
    draw();
  }
}
