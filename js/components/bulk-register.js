// ============================================================
// components/bulk-register.js — アンケートの回答から、まとめてアカウントを作る（店長）
// ------------------------------------------------------------
// このファイルは、Google フォームの回答（名前・電話番号・店舗）を読んで、
// 何人でも一気にアカウントを作り、1人ずつ「SMSで送る」ボタンを出す部品のファイルです（2026年11月22日）。
//
// 流れ（3つの段階）
//   ① 入れる   … CSV ファイルを選ぶ、または表からコピーした文をはりつける
//   ② 確かめる … 1人1行。登録ずみ・2回目の回答・電話番号のまちがい・店舗なし を印で出す。外す人はチェックを外す
//   ③ 送る     … 登録できた人ごとに「SMSで送る」「LINE」「コピー」。押すと文が入った画面が開く（送信は自分で押す）
// ・電話番号はアプリに保存しない（この画面の中だけで使う。閉じると消える）
// ・立場はみんな「バイト」、できることは 0%。あとで1人ずつ「スタッフの登録・設定」で直す
// ・読み取りは lib/roster-csv.js、送る文とリンクは lib/invite-message.js
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { readRoster } from "../lib/roster-csv.js";   // 回答の表を読む道具を読む
import { inviteText, smsLink, lineLink } from "../lib/invite-message.js";   // 送る文・リンクの道具を読む

/** 状態の印の文字 */
const STATUS_TEXT = { exists: "登録ずみ", dup: "前の回答（同じ名前があと）", noname: "名前なし" };   // 印の文字

/**
 * まとめて登録の部品
 * @param {object} props
 * @param {{id:string,name:string,short:string}[]} props.stores 営業中の店舗
 * @param {{name:string}[]} props.members 今いる人（登録ずみを見つけるため）
 * @param {() => void} props.onClose 閉じた時（一覧を読みなおす）
 * @returns {HTMLElement}
 */
export function bulkRegister({ stores, members, onClose }) {   // まとめて登録の部品を作る関数
  const box = createElement("section", { class: "card bulk" });   // 入れ物
  let step = "input";   // 今の段階（input → preview → working → done）
  let text = "";        // はりつけた文
  let rows = [];        // 読んだ人
  let results = [];     // 登録の結果（{ name, phone, loginId, code, sent, error }）
  let progress = 0;     // 登録できた人数（進み具合）
  const appUrl = `${location.origin}/`;   // アプリのURL（本番なら https://aichi21cafe-shift.pages.dev/）

  draw();   // はじめに描く
  return box;   // 返す

  /** 段階ごとに描く */
  function draw() {   // 描く関数
    if (step === "input") mount(box, ...inputView());   // ① 入れる
    else if (step === "preview") mount(box, ...previewView());   // ② 確かめる
    else if (step === "working") mount(box, createElement("h2", { class: "card__title" }, "登録しています…"), createElement("p", { class: "num" }, `${progress} / ${rows.filter((row) => row.include).length} 人`));   // 登録中
    else mount(box, ...doneView());   // ③ 送る
  }

  // ---------- ① 入れる ----------
  function inputView() {   // 入れる画面を作る関数
    const area = createElement("textarea", { class: "textarea bulk__paste", placeholder: "表をコピーして、ここにはりつけ\n（1行目の見出しも入れる）", oninput: (event) => { text = event.target.value; } }, text);   // はりつける欄
    const file = createElement("input", { type: "file", accept: ".csv,.tsv,text/csv,text/plain", class: "bulk__file", onchange: async (event) => {   // ファイルを選ぶ
      const picked = event.target.files?.[0];   // 選んだファイル
      if (!picked) return;   // なければ何もしない
      text = await picked.text();   // 中身を読む
      load();   // 読みこむ
    } });
    return [   // 返す
      createElement("h2", { class: "card__title" }, "アンケートからまとめて登録"),   // 見出し
      createElement("ul", { class: "bulk__how" },   // やり方
        createElement("li", null, "フォームの「回答」→「⋮」→「回答をダウンロード（.csv）」"),   // CSV
        createElement("li", null, "または 回答の表を全部コピー → 下にはりつけ"),   // コピー
        createElement("li", null, "電話番号はアプリに保存しません")),   // 保存しない
      createElement("label", { class: "btn bulk__pick" }, "CSV ファイルを選ぶ", file),   // ファイルのボタン
      area,   // はりつける欄
      createElement("div", { class: "chip-row" },   // ボタンの行
        createElement("button", { class: "btn btn--primary", onclick: () => { text = area.value; load(); } }, "読みこむ"),   // 読む
        createElement("button", { class: "btn", onclick: onClose }, "閉じる")),   // 閉じる
    ];
  }

  /** 文を読んで ② へ */
  function load() {   // 読みこむ関数
    const { rows: read, error } = readRoster(text, { stores, members });   // 表を読む
    if (error) { toast(error); return; }   // 読めなければ知らせる
    rows = read;   // 読んだ人
    step = "preview";   // ② へ
    draw();   // 描く
  }

  // ---------- ② 確かめる ----------
  function previewView() {   // 確かめる画面を作る関数
    const chosen = rows.filter((row) => row.include);   // 登録する人
    const noStore = chosen.filter((row) => !row.stores.length).length;   // 店舗がない人
    return [   // 返す
      createElement("h2", { class: "card__title" }, `回答 ${rows.length}件 → 登録 ${chosen.length}人`),   // 見出し
      createElement("div", { class: "home-muted" }, "立場はみんな「バイト」で作ります。あとで1人ずつ直せます"),   // 説明
      rows.map((row) => personRow(row)),   // 1人ずつ
      noStore ? createElement("div", { class: "bulk__warn" }, `店舗を選んでいない人が ${noStore}人います`) : null,   // 店舗なしの注意
      createElement("div", { class: "chip-row" },   // ボタンの行
        createElement("button", { class: "btn btn--primary", disabled: !chosen.length || noStore > 0, onclick: register }, `${chosen.length}人を登録する`),   // 登録
        createElement("button", { class: "btn", onclick: () => { step = "input"; draw(); } }, "もどる")),   // もどる
    ];
  }

  /** 1人の行（チェック・名前・電話番号・店舗） */
  function personRow(row) {   // 1人の行を作る関数
    const blocked = !!row.status && row.status !== "dup";   // 登録ずみ・名前なしは選べない
    const main = row.stores.find((store) => store.rank === 1)?.storeId || "";   // メインの店舗
    return createElement("div", { class: `bulk__row ${row.include ? "" : "is-off"}` },   // 行
      createElement("label", { class: "bulk__check" },   // チェック
        createElement("input", { type: "checkbox", checked: row.include, disabled: blocked, onchange: (event) => { row.include = event.target.checked; draw(); } }),   // チェックの箱
        createElement("strong", null, row.name || "（名前なし）")),   // 名前
      createElement("span", { class: `num ${row.phoneOk ? "home-muted" : "bulk__bad"}` }, row.phone || "電話番号なし"),   // 電話番号
      row.status ? createElement("span", { class: "badge" }, STATUS_TEXT[row.status]) : null,   // 状態の印
      !row.phoneOk ? createElement("span", { class: "badge badge--warn" }, "電話番号を確認") : null,   // 電話番号がおかしい
      createElement("select", { class: "select bulk__store", onchange: (event) => { setMain(row, event.target.value); draw(); } },   // 店舗を選ぶ
        createElement("option", { value: "", selected: !main }, "店舗を選ぶ"),   // まだ
        stores.map((store) => createElement("option", { value: store.id, selected: store.id === main }, store.name))),   // 店舗ごと
      row.stores.length > 1 ? createElement("span", { class: "home-muted" }, `応援：${row.stores.filter((store) => store.rank > 1).map((store) => stores.find((each) => each.id === store.storeId)?.short).join("・")}`) : null,   // 2nd・3rd
    );
  }

  /** メインの店舗を変える（ほかに選んでいた店は 2nd・3rd のまま） */
  function setMain(row, storeId) {   // メインを変える関数
    const others = row.stores.map((store) => store.storeId).filter((id) => id !== storeId);   // ほかの店
    row.stores = storeId ? [storeId, ...others].slice(0, 3).map((id, index) => ({ storeId: id, rank: index + 1 })) : [];   // メイン＋応援
  }

  /** 選んだ人をまとめて登録する */
  async function register() {   // 登録する関数
    const chosen = rows.filter((row) => row.include);   // 登録する人
    const ok = await confirmDialog({ title: `${chosen.length}人のアカウントを作りますか？`, body: "1人ずつ ID と初回コード（7日間）を作ります。", yes: "作る", no: "やめる" });   // 確かめる
    if (!ok) return;   // やめた
    step = "working"; progress = 0; results = []; draw();   // 登録中の画面
    for (const row of chosen) {   // 1人ずつ（順番に）
      try {   // 失敗しても次の人へ
        const { member, code } = await api.createMember({ name: row.name, kind: "baito", everyday: false, skills: { hall: 0, kitchen: 0, open: 0, close: 0 }, stores: row.stores });   // アカウントを作る
        results.push({ name: member.name, phone: row.phone, phoneOk: row.phoneOk, loginId: member.loginId, code, sent: false });   // 結果
      } catch (error) {   // 失敗した
        results.push({ name: row.name, error: error.message || "登録できませんでした" });   // 失敗の理由
      }
      progress++; draw();   // 進み具合
    }
    step = "done"; draw();   // ③ へ
  }

  // ---------- ③ 送る ----------
  function doneView() {   // 送る画面を作る関数
    const made = results.filter((result) => !result.error);   // できた人
    const failed = results.filter((result) => result.error);   // できなかった人
    return [   // 返す
      createElement("h2", { class: "card__title" }, `${made.length}人のアカウントを作りました`),   // 見出し
      createElement("div", { class: "bulk__warn" }, "この画面を閉じると、コードはもう出ません。先に全員に送ってください（あとからは1人ずつ「パスワードをリセット」）"),   // 注意
      createElement("div", { class: "home-muted" }, `送った ${made.filter((result) => result.sent).length} / ${made.length}人`),   // 送った数
      made.map((result) => sendRow(result)),   // 1人ずつ
      failed.length ? createElement("div", { class: "bulk__warn" }, `できなかった人：${failed.map((result) => `${result.name}（${result.error}）`).join("、")}`) : null,   // 失敗
      createElement("button", { class: "btn", onclick: async () => {   // 閉じる
        const left = made.filter((result) => !result.sent).length;   // まだ送っていない人
        if (left && !(await confirmDialog({ title: `まだ ${left}人に送っていません`, body: "閉じるとコードはもう出ません。閉じますか？", yes: "閉じる", no: "もどる", warn: true }))) return;   // 確かめる
        onClose();   // 閉じる
      } }, "閉じる"),
    ];
  }

  /** 1人の「送る」行 */
  function sendRow(result) {   // 送る行を作る関数
    const message = inviteText({ name: result.name, loginId: result.loginId, code: result.code, appUrl });   // 送る文
    const mark = () => { result.sent = true; setTimeout(draw, 300); };   // 送った印（アプリが開いてから描きなおす）
    return createElement("div", { class: `bulk__row ${result.sent ? "is-sent" : ""}` },   // 行
      createElement("div", null,   // 名前とコード
        createElement("strong", null, result.name), " ",   // 名前
        createElement("span", { class: "home-muted num" }, `ID ${result.loginId}・コード ${result.code}`),   // ID とコード
        result.sent ? createElement("span", { class: "badge badge--ok" }, "送った") : null),   // 送った印
      createElement("div", { class: "chip-row" },   // ボタンの行
        result.phoneOk   // 電話番号が正しい時だけ SMS
          ? createElement("a", { class: "btn btn--small btn--primary", href: smsLink(result.phone, message), onclick: mark }, "SMSで送る")   // SMS
          : createElement("span", { class: "bulk__bad" }, "電話番号なし"),   // SMS できない
        createElement("a", { class: "btn btn--small", href: lineLink(message), target: "_blank", rel: "noopener", onclick: mark }, "LINE"),   // LINE
        createElement("button", { class: "btn btn--small", onclick: () => copy(message, result) }, "コピー")),   // コピー
    );
  }

  /** 文をコピーする */
  async function copy(message, result) {   // コピーする関数
    try { await navigator.clipboard.writeText(message); result.sent = true; toast("コピーしました"); draw(); }   // コピーできた
    catch { toast("コピーできませんでした"); }   // できない
  }
}
