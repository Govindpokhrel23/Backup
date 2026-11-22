// ============================================================
// lib/roster-csv.js — アンケート（Google フォーム）の回答の表を読む
// ------------------------------------------------------------
// このファイルは、Google フォームの回答（CSV・表からコピーした文）から、
// 「名前・電話番号・店舗」を1人ずつ取り出すためのファイルです（2026年11月22日）。
//
// ・CSV（カンマ区切り）も、表からコピーした文（タブ区切り）も読める
// ・1行目の見出しで列を探す：「名前」「電話」「店」（またはシフト希望）
// ・電話番号は数字だけにする（全角→半角、ハイフン・空白を外す、+81 → 0）
// ・店舗は「安城店」「福釜店」「今村店」を、アプリの店舗に合わせる（複数選んだ人は、はじめの店がメイン）
// ・同じ名前が2回あれば、あとの回答を使う。アプリにもういる人は「登録ずみ」
// 画面は components/bulk-register.js。ここは画面を持たない（テストしやすいように）
// ============================================================

/**
 * CSV・タブ区切りの文を、行と列に分ける（" で囲んだ中のカンマ・改行もそのまま読む）
 * @param {string} text 文
 * @returns {string[][]} 行ごとの列
 */
export function parseTable(text) {   // 文を表に分ける関数
  const source = String(text || "").replace(/^﻿/, "");   // はじめの見えない印（BOM）を外す
  const firstLine = source.split(/\r?\n/)[0] || "";   // 1行目
  const sep = firstLine.includes("\t") ? "\t" : ",";   // タブがあればタブ区切り、なければカンマ区切り
  const rows = [];   // できた行
  let row = [];      // 今の行
  let cell = "";     // 今のマス
  let quoted = false;   // " の中か
  for (let index = 0; index < source.length; index++) {   // 1文字ずつ
    const char = source[index];   // 今の文字
    if (quoted) {   // " の中
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }   // "" は " 1つ
      else if (char === '"') quoted = false;   // " の終わり
      else cell += char;   // ふつうの文字
    } else if (char === '"' && cell === "") quoted = true;   // " の始まり
    else if (char === sep) { row.push(cell); cell = ""; }   // 区切り → 次のマス
    else if (char === "\n" || char === "\r") {   // 行の終わり
      if (char === "\r" && source[index + 1] === "\n") index++;   // \r\n は1つの改行
      row.push(cell); rows.push(row); row = []; cell = "";   // 行を足す
    } else cell += char;   // ふつうの文字
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }   // 最後の行
  return rows.filter((eachRow) => eachRow.some((value) => value.trim() !== ""));   // 空の行は外す
}

/**
 * 電話番号を数字だけにする（09012345678 の形）
 * @param {string} value 書かれた電話番号
 * @returns {string} 数字だけ（直せない時も数字だけ返す）
 */
export function normalizePhone(value) {   // 電話番号をそろえる関数
  let digits = String(value || "")   // 文字にする
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))   // 全角の数字 → 半角
    .replace(/[^\d+]/g, "");   // 数字と + 以外を外す（ハイフン・空白・かっこ）
  if (digits.startsWith("+81")) digits = `0${digits.slice(3)}`;   // +81 → 0
  else if (digits.startsWith("81") && digits.length === 12) digits = `0${digits.slice(2)}`;   // 81… → 0…
  digits = digits.replace(/\+/g, "");   // のこった + は外す
  if (/^[1-9]\d{8,9}$/.test(digits)) digits = `0${digits}`;   // 表がはじめの 0 を消した時（9012345678）は 0 を足す
  return digits;   // 数字だけ
}

/** 携帯・固定の番号の形か（0 で始まる10〜11けた） */
export function isPhone(digits) {   // 電話番号の形か調べる関数
  return /^0\d{9,10}$/.test(digits);   // 0 で始まって、全部で10〜11けた
}

/** 名前を比べるための形（空白を外す・全角英数を半角に） */
export function nameKey(name) {   // 名前を比べる形にする関数
  return String(name || "")   // 文字にする
    .replace(/[\s　]/g, "")   // 半角・全角の空白を外す
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))   // 全角英数 → 半角
    .toLowerCase();   // 小文字
}

/**
 * 「安城店, 福釜店」のような文を、アプリの店舗に合わせる
 * @param {string} value 書かれた店舗（チェックボックスは , でつながる）
 * @param {{id:string,name:string,short:string}[]} stores アプリの店舗
 * @returns {{storeId:string, rank:number}[]} 行ける店舗（はじめ＝メイン）
 */
export function matchStores(value, stores) {   // 店舗を合わせる関数
  const found = [];   // 見つかった店舗
  String(value || "").split(/[,、・/]/).map((part) => part.trim()).filter(Boolean).forEach((label) => {   // 1つずつ
    const core = label.replace(/店$/, "");   // 「安城店」→「安城」
    const store = stores.find((each) => each.name === label || each.short === core || each.short === label)   // 名前か短い名前がぴったり
      || (stores.filter((each) => each.name.includes(core)).length === 1 ? stores.find((each) => each.name.includes(core)) : null);   // 名前に入っていて、1店舗だけなら
    if (store && !found.includes(store.id)) found.push(store.id);   // 同じ店は1回だけ
  });
  return found.slice(0, 3).map((storeId, index) => ({ storeId, rank: index + 1 }));   // メイン・2nd・3rd
}

/**
 * 回答の表から、登録する人の一覧を作る
 * @param {string} text CSV・表からコピーした文
 * @param {object} options
 * @param {{id:string,name:string,short:string}[]} options.stores 店舗
 * @param {{name:string}[]} options.members アプリにもういる人
 * @returns {{rows: object[], error: string|null}}
 *   rows の1人：{ key, name, phone, phoneOk, stores, status, include }
 *   status：""（登録できる）／"dup"（同じ名前があと）／"exists"（登録ずみ）／"noname"
 */
export function readRoster(text, { stores, members }) {   // 回答から一覧を作る関数
  const table = parseTable(text);   // 表にする
  if (table.length < 2) return { rows: [], error: "回答が見つかりません（1行目が見出し、2行目から回答の表を入れてください）" };   // 行がない
  const head = table[0].map((title) => title.trim());   // 見出し
  const nameCol = head.findIndex((title) => /名前|氏名|name/i.test(title));   // 名前の列
  const phoneCol = head.findIndex((title) => /電話|phone|tel/i.test(title));   // 電話の列
  let storeCol = head.findIndex((title) => /店|シフト希望/.test(title) && !/名前|電話/.test(title));   // 店舗の列
  if (storeCol < 0) storeCol = head.findIndex((_, col) => col !== nameCol && col !== phoneCol && table.slice(1).some((row) => /店/.test(row[col] || "")));   // 中身に「店」がある列
  if (nameCol < 0) return { rows: [], error: "「名前」の列が見つかりません" };   // 名前の列がない
  if (phoneCol < 0) return { rows: [], error: "「電話番号」の列が見つかりません" };   // 電話の列がない

  const existing = new Set(members.map((member) => nameKey(member.name)));   // もういる人
  const rows = table.slice(1).map((row, index) => {   // 回答1つずつ
    const phone = normalizePhone(row[phoneCol]);   // 電話番号
    const name = String(row[nameCol] || "").trim().replace(/\s+/g, " ");   // 名前（空白は1つに）
    return {   // 1人
      key: `r${index}`,   // 画面で使う印
      name,   // 名前
      phone,   // 電話番号（数字だけ）
      phoneOk: isPhone(phone),   // 電話番号の形が正しいか
      stores: storeCol >= 0 ? matchStores(row[storeCol], stores) : [],   // 行ける店舗（空なら画面で選ぶ）
      status: !name ? "noname" : existing.has(nameKey(name)) ? "exists" : "",   // 状態
    };
  });
  // 同じ名前が2回以上 → あとの回答を使う（前のものは「dup」）
  const last = new Map();   // 名前 → いちばんあとの行
  rows.forEach((row) => { if (row.name) last.set(nameKey(row.name), row.key); });   // あとの行で上書き
  rows.forEach((row) => { if (row.name && !row.status && last.get(nameKey(row.name)) !== row.key) row.status = "dup"; });   // 前の行は dup
  rows.forEach((row) => { row.include = !row.status && row.phoneOk; });   // はじめに選んでおくのは、登録できて電話番号が正しい人
  return { rows, error: null };   // 一覧を返す
}
