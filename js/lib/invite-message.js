// ============================================================
// lib/invite-message.js — ID と初回コードを送る文・リンクを作る
// ------------------------------------------------------------
// このファイルは、登録した人に送る「ID・初回コード・アプリのURL」の文と、
// 押すと SMS・LINE の画面が開くリンクを作るファイルです（2026年11月22日）。
//
// ・SMS：「sms:電話番号」＋文。iPhone は「&body=」、Android は「?body=」
//   → 押すとメッセージのアプリが開き、相手と文が入った状態になる（送信は自分で押す）
// ・LINE：文だけ入る（相手は LINE の画面で選ぶ）
// ・電話番号は、どこにも保存しない（この画面の中だけで使う）
// ============================================================

/**
 * 送る文を作る
 * @param {object} props
 * @param {string} props.name     名前
 * @param {string} props.loginId  ID
 * @param {string} props.code     初回コード
 * @param {string} props.appUrl   アプリのURL
 * @returns {string} 送る文
 */
export function inviteText({ name, loginId, code, appUrl }) {   // 送る文を作る関数
  return [   // 1行ずつ
    `${name}さん`,   // 名前
    "コメダのシフトアプリのアカウントを作りました。",   // 説明
    `URL：${appUrl}`,   // アプリのURL
    `ID：${loginId}`,   // ID
    `初回コード：${code}`,   // 初回コード
    "ログイン画面の「はじめての方」から入って、自分のパスワードを決めてください。",   // 入り方
    "※コードは1回だけ・7日間使えます。",   // 注意
  ].join("\n");   // 改行でつなぐ
}

/** iPhone・iPad か（SMS のリンクの形がちがう） */
export function isApple(userAgent = globalThis.navigator?.userAgent || "") {   // iPhone か調べる関数
  return /iPhone|iPad|iPod|Macintosh/.test(userAgent);   // Apple の機械
}

/**
 * SMS を開くリンク
 * @param {string} phone 電話番号（数字だけ）
 * @param {string} text  送る文
 * @param {boolean} [apple] iPhone か
 */
export function smsLink(phone, text, apple = isApple()) {   // SMS のリンクを作る関数
  return `sms:${phone}${apple ? "&" : "?"}body=${encodeURIComponent(text)}`;   // 電話番号＋文
}

/** LINE を開くリンク（文だけ入る） */
export function lineLink(text) {   // LINE のリンクを作る関数
  return `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;   // LINE の「送る」画面
}
