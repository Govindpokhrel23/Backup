// ============================================================
// lib/dom.js — 画面の部品（HTML要素）を作るための小さな道具
// ------------------------------------------------------------
// なぜ innerHTML を使わないの？
//   innerHTML に人の名前などをそのまま入れると、
//   名前に <script> などが入っていた時に悪さをされる（XSSという攻撃）。
//   h() は文字を「ただの文字」として入れるので安全。
//
// 使い方：
//   h("button", { class: "btn", onclick: save }, "保存")
//     → <button class="btn">保存</button> を作る（押すと save が動く）
// ============================================================

/**
 * HTML要素を作る
 * @param {string} tag       タグ名（"div", "button" など）
 * @param {object} [attrs]   属性（class, style, onclick など）
 * @param {...any} children  中身（文字・要素・配列。null/false は無視）
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key.startsWith("on") && typeof value === "function") {
      // onclick → "click" のイベントとして登録
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "style" && typeof value === "object") {
      // style は { left: "10px" } のような形でも渡せる
      Object.assign(el.style, value);
    } else if (key === "value") {
      // 入力欄の値は属性ではなくプロパティで入れる
      el.value = value;
    } else if (value === true) {
      el.setAttribute(key, "");          // hidden, disabled など
    } else {
      el.setAttribute(key, String(value));
    }
  }

  appendChildren(el, children);
  return el;
}

/** 中身を足す（配列の中に配列があっても全部たどる） */
function appendChildren(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(el, child);
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));   // 文字は安全に入れる
    }
  }
}

/** 要素の中身を全部入れ替える */
export function mount(target, ...children) {
  target.replaceChildren();
  appendChildren(target, children);
}

/** SVGアイコンを作る（線だけのシンプルなアイコン） */
export function icon(name) {
  const paths = {
    home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    store: "M4 10h16v10H4zM3 10l2-6h14l2 6M10 20v-5h4v5",
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    warn: "M12 3 2 21h20L12 3zM12 10v5M12 18h.01",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5",
  };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", paths[name] || "");
  svg.appendChild(path);
  return svg;
}

/** 小さいお知らせを数秒出す */
let toastTimer = null;
export function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

/**
 * 確認ダイアログを出して、押されたボタンを待つ
 * （ブラウザの confirm() は見た目を変えられないので自作）
 * @returns {Promise<boolean>} 「はい」なら true
 */
export function confirmDialog({ title, body, yes = "はい", no = "いいえ", warn = false }) {
  return new Promise((resolve) => {
    const close = (answer) => { backdrop.remove(); resolve(answer); };
    const backdrop = h("div", { class: "dialog-backdrop" },
      h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h2", { class: "dialog__title" }, warn ? h("span", { style: { color: "#C27A00", display: "flex" } }, icon("warn")) : null, title),
        body,
        h("div", { class: "dialog__actions" },
          no === null ? null : h("button", { class: "btn", onclick: () => close(false) }, no),   // no を null にするとボタン1つ
          h("button", { class: "btn btn--primary", onclick: () => close(true) }, yes),
        ),
      ),
    );
    document.body.appendChild(backdrop);
  });
}
