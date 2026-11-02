// ============================================================
// rules/shift-rules.js — シフトのルールチェック
// ------------------------------------------------------------
// 要件定義書「必ず守るルール」をプログラムで確かめる場所。
//   ・AIが作った下書きを確かめる時
//   ・店長が手で直した時
//   ・公開ボタンを押した時（守れていなければ⚠️警告）
// の全部で、この同じ関数を使う（設計書9章）。
//
// ※ここは画面（DOM）を一切さわらない「計算だけ」のファイル。
//   だから node で自動テストができる（tests/rules.test.mjs）。
// ============================================================

import { CONFIG } from "../config.js";
import { STEP, fmt, overlaps } from "../lib/time.js";

/**
 * チェック結果1件の形
 * @typedef {object} Problem
 * @property {boolean} ok       守れていれば true
 * @property {string}  code     ルールの種類（"shortage", "open" など）
 * @property {string}  text     画面に出す文
 * @property {string}  [date]   どの日か
 */

// ------------------------------------------------------------
// 必要人数
// ------------------------------------------------------------

/**
 * ある時刻に、そのエリア（ホール／キッチン）で何人必要か
 * マップの担当場所ごとの人数を、エリアごとに足す
 * @param {object[]} requirements  場所ごとの必要人数（position_requirements）
 * @param {object[]} positions     担当場所（positions）
 * @param {string}   dayType       "weekday" / "sat" / "sun"
 * @param {string}   area          "hall" / "kitchen"
 * @param {number}   minute        時刻（分）
 */
export function requiredAt(requirements, positions, dayType, area, minute) {
  const areaOf = new Map(positions.map((p) => [p.id, p.area]));
  let total = 0;
  for (const r of requirements) {
    if (r.dayType !== dayType) continue;
    if (areaOf.get(r.positionId) !== area) continue;
    if (r.from <= minute && minute < r.to) total += r.count;
  }
  return total;
}

/** ある時刻に、そのエリアで実際に入っている人数 */
export function assignedAt(dayAssignments, area, minute) {
  return dayAssignments.filter((a) => a.area === area && a.from <= minute && minute < a.to).length;
}

/**
 * 人が足りない時間帯を探す
 * 15分ごとに「必要」と「実際」を比べて、続いている所はまとめる
 * @returns {{area:string, from:number, to:number, short:number}[]}
 */
export function findShortages(dayAssignments, requirements, positions, dayType) {
  const result = [];
  for (const area of ["hall", "kitchen"]) {
    let open = null;                       // 今まとめている不足の時間帯
    for (let m = CONFIG.DAY_START; m < CONFIG.DAY_END; m += STEP) {
      const need = requiredAt(requirements, positions, dayType, area, m);
      const have = assignedAt(dayAssignments, area, m);
      const short = Math.max(0, need - have);
      if (short > 0 && open && open.short === short) {
        open.to = m + STEP;                // 同じ不足が続いている → のばす
      } else {
        if (open) result.push(open);
        open = short > 0 ? { area, from: m, to: m + STEP, short } : null;
      }
    }
    if (open) result.push(open);
  }
  return result;
}

// ------------------------------------------------------------
// 1日分のチェック
// ------------------------------------------------------------

/**
 * 1日分のルールを全部確かめる
 * @param {object} p
 * @param {string}   p.date          日付 "2026-11-09"
 * @param {string}   p.dayType       "weekday" / "sat" / "sun"
 * @param {object[]} p.assignments   その日の勤務（この店舗）
 * @param {object[]} p.allStoreAssignments その日の勤務（全店舗。応援の重なりを見る）
 * @param {object[]} p.members       店員
 * @param {object[]} p.requirements  場所ごとの必要人数
 * @param {object[]} p.positions     担当場所
 * @param {object[]} p.availabilities その日の希望
 * @returns {Problem[]}
 */
export function checkDay(p) {
  const out = [];
  const memberOf = new Map(p.members.map((m) => [m.id, m]));
  const nameOf = (id) => memberOf.get(id)?.name || "？";

  // ① 必要人数
  const shortages = findShortages(p.assignments, p.requirements, p.positions, p.dayType);
  if (shortages.length === 0) {
    out.push({ ok: true, code: "shortage", text: "場所ごとの必要人数" });
  } else {
    for (const s of shortages) {
      out.push({
        ok: false, code: "shortage", date: p.date,
        text: `${s.area === "hall" ? "ホール" : "キッチン"}が${s.short}人足りない：${fmt(s.from)}〜${fmt(s.to)}`,
      });
    }
  }

  // ② 立ち上げ：開店の時刻に、立ち上げ100％の人がいる
  const opener = p.assignments.some((a) => a.from <= CONFIG.DAY_START && memberOf.get(a.memberId)?.skills?.open === 100);
  out.push({
    ok: opener, code: "open", date: p.date,
    text: opener ? `立ち上げ（${fmt(CONFIG.DAY_START)}）にできる人がいる` : `立ち上げ（${fmt(CONFIG.DAY_START)}）にできる人がいない`,
  });

  // ③ 締め：閉店の時刻に、締め100％の人がいる
  const closer = p.assignments.some((a) => a.to >= CONFIG.DAY_END && memberOf.get(a.memberId)?.skills?.close === 100);
  out.push({
    ok: closer, code: "close", date: p.date,
    text: closer ? `締め（${fmt(CONFIG.DAY_END)}）にできる人がいる` : `締め（${fmt(CONFIG.DAY_END)}）にできる人がいない`,
  });

  // ④ 休憩：長い勤務には休憩の目安（○）がある
  const noBreak = p.assignments.filter((a) => a.to - a.from >= CONFIG.BREAK_NEEDED_MIN && a.breakAt == null);
  out.push({
    ok: noBreak.length === 0, code: "break", date: p.date,
    text: noBreak.length ? `休憩なし（${CONFIG.BREAK_NEEDED_MIN / 60}時間以上）：${noBreak.map((a) => nameOf(a.memberId)).join("、")}` : "長い勤務には休憩あり",
  });

  // ⑤ 希望：希望の外の時間に入っていない（短く入れるのはOK）
  const outside = [];
  for (const a of p.assignments) {
    const member = memberOf.get(a.memberId);
    const hope = p.availabilities.find((x) => x.memberId === a.memberId);
    if (!hope) {
      // 希望を出していない：社員は「全部入れる」扱い（要件 F-49）
      if (member?.kind !== "shain") outside.push(`${nameOf(a.memberId)}（希望なし）`);
      continue;
    }
    if (["no", "off", "offx"].includes(hope.kind)) outside.push(`${nameOf(a.memberId)}（休み希望の日）`);
    else if (hope.kind === "time" && (a.from < hope.from || a.to > hope.to)) outside.push(nameOf(a.memberId));
  }
  out.push({
    ok: outside.length === 0, code: "hope", date: p.date,
    text: outside.length ? `希望の外：${outside.join("、")}` : "希望の時間の中で入っている",
  });

  // ⑥ 同じ人が同じ時間に2つ入っていない（ほかの店舗への応援も含む）
  const all = p.allStoreAssignments || p.assignments;
  const doubled = new Set();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.memberId === b.memberId && overlaps(a.from, a.to, b.from, b.to)) doubled.add(a.memberId);
    }
  }
  if (doubled.size) {
    out.push({ ok: false, code: "double", date: p.date, text: `同じ時間に2つ入っている：${[...doubled].map(nameOf).join("、")}` });
  }

  // ⑦ 勤務の時間がおかしくないか（終わりが始まりより前など）
  const broken = p.assignments.filter((a) => a.to <= a.from);
  if (broken.length) {
    out.push({ ok: false, code: "time", date: p.date, text: `時間がおかしい：${broken.map((a) => nameOf(a.memberId)).join("、")}` });
  }

  return out;
}

// ------------------------------------------------------------
// 1週間分のチェック
// ------------------------------------------------------------

/**
 * 週全体のルール
 * @param {object} p
 * @param {string[]} p.dates          7日分の日付
 * @param {object[]} p.assignments    その週の勤務（この店舗）
 * @param {object[]} p.members        店員
 * @param {object[]} p.availabilities その週の希望
 * @returns {Problem[]}
 */
export function checkWeek(p) {
  const out = [];
  const active = p.members.filter((m) => m.active);

  // ① 全員、週1日は必ず休み
  const noRest = active.filter((m) => {
    const days = new Set(p.assignments.filter((a) => a.memberId === m.id).map((a) => a.date));
    return p.dates.every((d) => days.has(d));
  });
  out.push({
    ok: noRest.length === 0, code: "rest",
    text: noRest.length ? `週1日の休みがない：${noRest.map((m) => m.name).join("、")}` : "全員、週1日の休みあり",
  });

  // ② 社員の休み希望は週2日まで（3日目からは特別許可の申請＝offx）
  const waiting = p.availabilities.filter((a) => a.kind === "offx");
  if (waiting.length) {
    const nameOf = (id) => p.members.find((m) => m.id === id)?.name || "？";
    out.push({ ok: false, code: "special", text: `特別許可を待っている休み：${waiting.map((a) => `${nameOf(a.memberId)} ${a.date.slice(5)}`).join("、")}` });
  }

  return out;
}

/** チェック結果から「守れていないもの」だけを取り出す */
export function onlyProblems(results) {
  return results.filter((r) => !r.ok);
}
