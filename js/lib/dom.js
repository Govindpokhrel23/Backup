// ============================================================
// lib/dom.js — 画面の部品（HTML要素）を作るための小さな道具
// ------------------------------------------------------------
// このファイルは、画面の部品（HTML要素）を作るための小さな道具のファイルです。
// なぜ innerHTML を使わないの？
//   innerHTML に人の名前などをそのまま入れると、
//   名前に <script> などが入っていた時に悪さをされる（XSSという攻撃）。
//   createElement() は文字を「ただの文字」として入れるので安全。
//
// 使い方：
//   createElement("button", { class: "btn", onclick: save }, "保存")
//     → <button class="btn">保存</button> を作る（押すと save が動く）
// ============================================================

/**
 * HTML要素を作る
 * @param {string} tag       タグ名（"div", "button" など）
 * @param {object} [attrs]   属性（class, style, onclick など）
 * @param {...any} children  中身（文字・要素・配列。null/false は無視）
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, ...children) {   // 画面の部品を作る関数
  const el = document.createElement(tag);   // 作る要素

  for (const [key, value] of Object.entries(attrs || {})) {   // 設定を1つずつ
    if (value === null || value === undefined || value === false) continue;   // null・false は何もしない

    if (key.startsWith("on") && typeof value === "function") {   // on〜 で関数なら
      // onclick → "click" のイベントとして登録
      el.addEventListener(key.slice(2).toLowerCase(), value);   // 押したなどの時に呼ぶ
    } else if (key === "style" && typeof value === "object") {   // style なら
      // style は { left: "10px" } のような形でも渡せる
      // "--hours" のような CSS変数 は setProperty でないと入らない
      for (const [prop, styleValue] of Object.entries(value)) {   // 見た目を1つずつ
        if (prop.startsWith("--")) el.style.setProperty(prop, styleValue);   // --〜 は色などの変数
        else el.style[prop] = styleValue;   // ふつうの見た目
      }
    } else if (key === "value") {   // value なら
      // 入力欄の値は属性ではなくプロパティで入れる
      el.value = value;   // 入力欄の中身にする
    } else if (value === true) {   // true なら
      el.setAttribute(key, "");          // hidden, disabled など
    } else {   // それ以外は
      el.setAttribute(key, String(value));   // そのまま属性にする
    }
  }

  appendChildren(el, children);   // 子どもを入れる
  return el;   // できた部品を返す
}

/** 中身を足す（配列の中に配列があっても全部たどる） */
function appendChildren(el, children) {   // 子どもを入れる関数
  for (const child of children) {   // 1つずつ
    if (child === null || child === undefined || child === false) continue;   // null・false は何もしない
    if (Array.isArray(child)) {   // 配列なら
      appendChildren(el, child);   // 中身を入れる
    } else if (child instanceof Node) {   // 部品なら
      el.appendChild(child);   // そのまま入れる
    } else {   // 文字なら
      el.appendChild(document.createTextNode(String(child)));   // 文字は安全に入れる
    }
  }
}

/** 要素の中身を全部入れ替える */
export function mount(target, ...children) {   // 中身を全部入れかえる関数
  target.replaceChildren();   // 今の中身を消す
  appendChildren(target, children);   // 新しい中身を入れる
}

/** SVGアイコンを作る（線だけのシンプルなアイコン） */
export function icon(name) {   // タブの絵（SVG）を作る関数
  const paths = {   // アイコンの形（SVG の線）
    home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",   // 家の絵
    edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",   // えんぴつの絵
    calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",   // カレンダーの絵
    store: "M4 10h16v10H4zM3 10l2-6h14l2 6M10 20v-5h4v5",   // お店の絵
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",   // 一覧の絵
    hope: "M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M8.5 13l2.5 2.5 4.5-5",   // 希望の絵（チェックのついたボード。2026年11月22日）
    warn: "M12 3 2 21h20L12 3zM12 10v5M12 18h.01",   // 注意の絵
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5",   // 人の絵
  };
  const ns = "http://www.w3.org/2000/svg";   // SVG の決まりの住所
  const svg = document.createElementNS(ns, "svg");   // アイコンの入れ物
  svg.setAttribute("viewBox", "0 0 24 24");   // 絵の大きさの決まり
  svg.setAttribute("fill", "none");   // 中はぬらない
  svg.setAttribute("stroke", "currentColor");   // 線の色はまわりの文字と同じ
  svg.setAttribute("stroke-width", "2");   // 線の太さ
  svg.setAttribute("stroke-linecap", "round");   // 線のはしを丸く
  svg.setAttribute("stroke-linejoin", "round");   // 線の角を丸く
  svg.setAttribute("aria-hidden", "true");   // 読み上げでは読まない
  const path = document.createElementNS(ns, "path");   // アイコンの線
  path.setAttribute("d", paths[name] || "");   // 絵の形
  svg.appendChild(path);   // 入れる
  return svg;   // 返す
}

/** 小さいお知らせを数秒出す */
let toastTimer = null;   // お知らせを消すタイマー
/** 画面の下に、数秒だけお知らせの文を出す */
export function toast(message) {   // 「保存しました」などを出す関数
  const el = document.getElementById("toast");   // お知らせを出す場所（index.html の #toast）
  el.textContent = message;   // 文を入れる
  el.hidden = false;   // 出す
  clearTimeout(toastTimer);   // 前のタイマーを止める
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);   // 2.5秒後に隠す
}

/**
 * 確認ダイアログを出して、押されたボタンを待つ
 * （ブラウザの confirm() は見た目を変えられないので自作）
 * @returns {Promise<boolean>} 「はい」なら true
 */
export function confirmDialog({ title, body, yes = "はい", no = "いいえ", warn = false }) {   // 「はい・いいえ」を聞く小さい画面を出す関数
  return new Promise((resolve) => {   // 答えるまで待てるようにする
    /** ダイアログを閉じて、押したボタンを返す */
    const close = (answer) => { backdrop.remove(); resolve(answer); };   // 閉じて答えを返す
    const backdrop = createElement("div", { class: "dialog-backdrop" },   // うしろを暗くする幕（中にダイアログ）
      createElement("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },   // 小さい画面の本体
        createElement("h2", { class: "dialog__title" }, warn ? createElement("span", { style: { color: "#C27A00", display: "flex" } }, icon("warn")) : null, title),   // タイトル（注意なら絵つき）
        body,   // 中身
        createElement("div", { class: "dialog__actions" },   // ボタンの行
          no === null ? null : createElement("button", { class: "btn", onclick: () => close(false) }, no),   // no を null にするとボタン1つ
          createElement("button", { class: "btn btn--primary", onclick: () => close(true) }, yes),   // はいボタン
        ),
      ),
    );
    document.body.appendChild(backdrop);   // 画面に出す
  });
}

/**
 * 「待っています」の画面（AIが考えている間など。2026年11月5日）
 * 画面全体をうすく隠して、ぐるぐると文を出す。終わったら done() を呼ぶ
 * @param {string} text 最初に出す文
 * @returns {{update:(text:string)=>void, done:()=>void}} 文を変える／消す
 */
export function busy(text) {   // 「考えています」を出す関数
  const message = createElement("div", { class: "busy__text" }, text);        // 出している文
  const layer = createElement("div", { class: "busy", role: "status", "aria-live": "polite" },   // 画面全体の幕
    createElement("div", { class: "busy__box" }, createElement("div", { class: "busy__spinner", "aria-hidden": "true" }), message));   // 白い箱・回る輪・文
  document.body.appendChild(layer);   // 画面に出す
  return {   // 使える操作を返す
    update: (next) => { message.textContent = next; },   // 文を変える
    done: () => layer.remove(),   // 消す
  };
}
