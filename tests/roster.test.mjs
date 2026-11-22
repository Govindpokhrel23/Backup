// ============================================================
// tests/roster.test.mjs — アンケートの回答の読み取り・送る文のテスト
// ------------------------------------------------------------
// このファイルは、lib/roster-csv.js と lib/invite-message.js のテストのファイルです（2026年11月22日）。
// 名前はテスト用の名前だけ（本物の名前は入れない）
// ============================================================

import { test } from "node:test";   // テストの道具
import assert from "node:assert/strict";   // くらべる道具
import { parseTable, normalizePhone, isPhone, matchStores, readRoster } from "../js/lib/roster-csv.js";   // 読み取り
import { inviteText, smsLink, lineLink } from "../js/lib/invite-message.js";   // 送る文

/** テスト用の店舗 */
const STORES = [   // 3店舗
  { id: "s-fukugama", name: "安城福釜店", short: "福釜" },   // 福釜
  { id: "s-anjo", name: "安城店", short: "安城" },   // 安城
  { id: "s-imamura", name: "安城今村店", short: "今村" },   // 今村
];

test("CSV：\" で囲んだカンマ・改行も読める", () => {   // CSV
  const rows = parseTable('Timestamp,シフト希望アプリ,名前,電話番号\r\n"2026/11/22 20:00","安城店, 福釜店",テスト 太郎,090-1234-5678\r\n');   // 文
  assert.deepEqual(rows[1], ["2026/11/22 20:00", "安城店, 福釜店", "テスト 太郎", "090-1234-5678"]);   // 1行目の回答
});

test("タブ区切り（表からコピー）も読める", () => {   // タブ
  const rows = parseTable("名前\t電話番号\nテスト\t09011112222");   // 文
  assert.deepEqual(rows, [["名前", "電話番号"], ["テスト", "09011112222"]]);   // 2行
});

test("電話番号をそろえる", () => {   // 電話番号
  assert.equal(normalizePhone("０９０－１２３４－５６７８"), "09012345678");   // 全角
  assert.equal(normalizePhone("+81 90 1234 5678"), "09012345678");   // +81
  assert.equal(normalizePhone("9012345678"), "09012345678");   // 表が 0 を消した
  assert.ok(isPhone("0566123456"));   // 固定（10けた）
  assert.ok(!isPhone("12345"));   // 短い
});

test("店舗を合わせる：安城店は安城福釜店とまちがえない・はじめがメイン", () => {   // 店舗
  assert.deepEqual(matchStores("安城店", STORES), [{ storeId: "s-anjo", rank: 1 }]);   // 安城店
  assert.deepEqual(matchStores("福釜店, 今村店", STORES), [{ storeId: "s-fukugama", rank: 1 }, { storeId: "s-imamura", rank: 2 }]);   // 2店舗
  assert.deepEqual(matchStores("", STORES), []);   // なし
});

test("回答の一覧：同じ名前はあとの回答・登録ずみ・電話番号のまちがい", () => {   // 一覧
  const csv = [   // 回答
    "タイムスタンプ,シフト希望アプリ,名前,電話番号",   // 見出し
    "1,安城店,テスト一郎,09011110000",   // 1回目
    "2,,テスト二郎,123",   // 電話番号がおかしい・店舗なし
    "3,今村店,テスト 一郎,09011119999",   // 2回目（空白ちがいで同じ人）
    "4,福釜店,テスト店長,09022220000",   // 登録ずみ
  ].join("\n");
  const { rows, error } = readRoster(csv, { stores: STORES, members: [{ name: "テスト店長" }] });   // 読む
  assert.equal(error, null);   // 読めた
  assert.equal(rows[0].status, "dup");   // 前の回答
  assert.equal(rows[0].include, false);   // 選ばない
  assert.equal(rows[1].phoneOk, false);   // 電話番号がおかしい
  assert.equal(rows[1].include, false);   // 選ばない
  assert.deepEqual(rows[1].stores, []);   // 店舗なし
  assert.equal(rows[2].include, true);   // あとの回答を使う
  assert.equal(rows[2].stores[0].storeId, "s-imamura");   // 今村
  assert.equal(rows[3].status, "exists");   // 登録ずみ
});

test("列がない時は理由を返す", () => {   // 列なし
  assert.match(readRoster("a,b\n1,2", { stores: STORES, members: [] }).error, /名前/);   // 名前の列なし
});

test("送る文と SMS・LINE のリンク", () => {   // 送る文
  const text = inviteText({ name: "テスト", loginId: "105", code: "123456", appUrl: "https://example.com/" });   // 文
  assert.match(text, /ID：105/);   // ID
  assert.match(text, /初回コード：123456/);   // コード
  assert.ok(smsLink("09012345678", text, true).startsWith("sms:09012345678&body="));   // iPhone
  assert.ok(smsLink("09012345678", text, false).startsWith("sms:09012345678?body="));   // Android
  assert.ok(lineLink(text).startsWith("https://line.me/R/msg/text/?"));   // LINE
});
