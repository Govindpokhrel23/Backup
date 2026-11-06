// ============================================================
// lib/download.js — ファイルを作って保存する（CSV・バックアップ）
// ------------------------------------------------------------
// このファイルは、アプリの中のデータを「ファイル」にして、
// スマホやパソコンに保存（ダウンロード）するための小さな道具のファイルです（2026年11月6日）。
//   ・CSV  … Excel や Googleスプレッドシートで開ける表（給与計算に使う）
//   ・JSON … バックアップ（全部のデータ）
// iPhone では「ファイル」アプリの「ダウンロード」に入る。
// ============================================================

/**
 * 文字をファイルにして保存する
 * @param {string} name  ファイルの名前（例 "shift-2026-11.csv"）
 * @param {string} text  中身
 * @param {string} type  ファイルの種類（例 "text/csv"）
 */
export function saveFile(name, text, type) {   // 文字をファイルにしてダウンロードさせる関数
  const blob = new Blob([text], { type });                   // ファイルの中身
  const url = URL.createObjectURL(blob);                     // そのファイルの一時的な住所
  const link = document.createElement("a");                     // 見えないリンク
  link.href = url;   // 見えないリンクにファイルの場所を入れる
  link.download = name;   // 保存する時のファイル名
  document.body.appendChild(link);   // リンクを画面に一度だけ置く（押すために必要）
  link.click();                                                 // 押したことにして保存する
  link.remove();   // 使い終わったリンクを外す
  setTimeout(() => URL.revokeObjectURL(url), 1000);          // 少し待ってから一時的な住所を消す
}

/**
 * 表（行の配列）を CSV の文字にする
 * Excel で日本語が文字化けしないように、先頭に BOM（目印の文字）をつける
 * @param {(string|number)[][]} rows 1行目が見出し
 */
export function toCsv(rows) {   // 表（2重の配列）を CSV の文字にする関数
  /** 1つのマスを CSV の形にする（, や " や改行があれば "" でかこむ） */
  const cell = (value) => {   // 1マスの中身を CSV 用の文字にする
    const text = value == null ? "" : String(value);                    // マスの文字
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;   // カンマ・改行・" があれば "" でかこむ
  };
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n");   // 先頭の印（BOM）で Excel の文字化けを防ぎ、行を改行でつなぐ
}
