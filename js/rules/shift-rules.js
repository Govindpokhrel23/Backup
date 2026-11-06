// ============================================================
// rules/shift-rules.js — シフトのルールチェック
// ------------------------------------------------------------
// このファイルは、シフトのルールチェックのファイルです。
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
import { openerOf, openStart, isCloser } from "../lib/roles.js";

/**
 * チェック結果1件の形
 * @typedef {object} Problem
 * @property {boolean} ok       守れていれば true
 * @property {string}  code     ルールの種類（"shortage", "open" など）
 * @property {string}  text     画面に出す文
 * @property {string}  [date]   どの日か
 */

/** 営業時間が分からない時の初期値（7:00〜22:00） */
const DEFAULT_HOURS = { open: CONFIG.DAY_START, close: CONFIG.DAY_END };

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
  const areaOf = new Map(positions.map((position) => [position.id, position.area]));   // 担当場所のID → ホール／キッチン
  let total = 0;   // 必要な人数の合計
  for (const shift of requirements) {
    if (shift.dayType !== dayType) continue;
    if (areaOf.get(shift.positionId) !== area) continue;
    if (shift.from <= minute && minute < shift.to) total += shift.count;
  }
  return total;
}

/** ある時刻に、そのエリアで実際に入っている人数 */
export function assignedAt(dayAssignments, area, minute) {
  return dayAssignments.filter((shift) => shift.area === area && shift.from <= minute && minute < shift.to).length;
}

/**
 * 人が足りない時間帯を探す
 * 15分ごとに「必要」と「実際」を比べて、続いている所はまとめる
 * @returns {{area:string, from:number, to:number, short:number}[]}
 */
export function findShortages(dayAssignments, requirements, positions, dayType, hours = DEFAULT_HOURS) {
  const result = [];   // 見つかった不足
  for (const area of ["hall", "kitchen"]) {
    let open = null;                       // 今まとめている不足の時間帯
    for (let minutes = hours.open; minutes < hours.close; minutes += STEP) {          // 営業時間の中だけ見る
      const need = requiredAt(requirements, positions, dayType, area, minutes);   // この15分に必要な人数
      const have = assignedAt(dayAssignments, area, minutes);   // この15分に入っている人数
      const short = Math.max(0, need - have);   // 足りない人数
      if (short > 0 && open && open.short === short) {
        open.to = minutes + STEP;                // 同じ不足が続いている → のばす
      } else {
        if (open) result.push(open);
        open = short > 0 ? { area, from: minutes, to: minutes + STEP, short } : null;
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
 * @param {object} req
 * @param {string}   req.date          日付 "2026-11-09"
 * @param {string}   req.dayType       "weekday" / "sat" / "sun"
 * @param {object[]} req.assignments   その日の勤務（この店舗）
 * @param {object[]} req.allStoreAssignments その日の勤務（全店舗。応援の重なりを見る）
 * @param {object[]} req.members       店員
 * @param {object[]} req.requirements  場所ごとの必要人数
 * @param {object[]} req.positions     担当場所
 * @param {object[]} req.availabilities その日の希望
 * @param {{open:number,close:number}} [req.hours] その日の営業時間（なければ7:00〜22:00）
 * @returns {Problem[]}
 */
export function checkDay(req) {
  const out = [];   // チェックの結果
  const hours = req.hours || DEFAULT_HOURS;   // その日の営業時間
  const memberOf = new Map(req.members.map((member) => [member.id, member]));   // ID → 店員
  /** IDから名前 */
  const nameOf = (id) => memberOf.get(id)?.name || "？";

  // ① 必要人数
  const shortages = findShortages(req.assignments, req.requirements, req.positions, req.dayType, hours);
  if (shortages.length === 0) {
    out.push({ ok: true, code: "shortage", text: "場所ごとの必要人数" });
  } else {
    for (const shift of shortages) {
      out.push({
        ok: false, code: "shortage", date: req.date,
        text: `${shift.area === "hall" ? "ホール" : "キッチン"}が${shift.short}人足りない：${fmt(shift.from)}〜${fmt(shift.to)}`,
      });
    }
  }

  // ② 立ち上げ・③ 締め
  //   立ち上げは1人。開店30分前（7:00開店なら6:30）から入る人＝その日の「立ち上げ」（lib/roles.js）
  //   閉店の時刻（またはそれより後）まで入っている人＝その日の「締め」
  //   その人ができること％が100でなければ注意を出す
  const roleCheck = (code, word, people, skillKey, time) => {
    const names = [...new Set(people.map((member) => nameOf(member.memberId)))];   // その役の人の名前（同じ人は1回）
    if (!people.length) return { ok: false, code, date: req.date, text: `${word}（${fmt(time)}）の人がいない` };
    const able = people.some((member) => memberOf.get(member.memberId)?.skills?.[skillKey] === 100);   // 100%できる人がいるか
    if (!able) {
      const detail = names.map((name) => `${name} ${word}${req.members.find((member) => member.name === name)?.skills?.[skillKey] ?? 0}％`).join("、");   // 名前とできる％の文
      return { ok: false, code, date: req.date, text: `${word}の人が100％ではない：${detail}` };
    }
    return { ok: true, code, date: req.date, text: `${word}（${fmt(time)}）：${names.join("、")}` };
  };
  const opener = openerOf(req.assignments, hours);   // その日の立ち上げの人（1人）
  out.push(roleCheck("open", "立ち上げ", opener ? [opener] : [], "open", openStart(hours)));
  out.push(roleCheck("close", "締め", req.assignments.filter((shift) => isCloser(shift, hours)), "close", hours.close));

  // ④ 休憩：長い勤務には休憩の目安（○）がある
  const noBreak = req.assignments.filter((shift) => shift.to - shift.from >= CONFIG.BREAK_NEEDED_MIN && shift.breakAt == null);
  out.push({
    ok: noBreak.length === 0, code: "break", date: req.date,
    text: noBreak.length ? `休憩なし（${CONFIG.BREAK_NEEDED_MIN / 60}時間以上）：${noBreak.map((shift) => nameOf(shift.memberId)).join("、")}` : "長い勤務には休憩あり",
  });
  // 朝11:00より前に休憩を入れていないか
  const early = req.assignments.filter((shift) => shift.breakAt != null && shift.breakAt < CONFIG.BREAK_EARLIEST);
  if (early.length) {
    out.push({ ok: false, code: "break-early", date: req.date, text: `休憩が${fmt(CONFIG.BREAK_EARLIEST)}より前：${early.map((shift) => nameOf(shift.memberId)).join("、")}` });
  }

  // ⑤ 希望：希望の外の時間に入っていない（短く入れるのはOK）
  const outside = [];
  for (const shift of req.assignments) {
    const member = memberOf.get(shift.memberId);   // その店員
    const hope = req.availabilities.find((hope) => hope.memberId === shift.memberId);   // その人のその日の希望
    if (!hope) {
      // 希望を出していない：社員は「全部入れる」扱い（要件 F-49）
      if (member?.kind !== "shain") outside.push(`${nameOf(shift.memberId)}（希望なし）`);
      continue;
    }
    if (["no", "off", "offx"].includes(hope.kind)) outside.push(`${nameOf(shift.memberId)}（休み希望の日）`);
    else if (hope.kind === "time" && (shift.from < hope.from || shift.to > hope.to)) outside.push(nameOf(shift.memberId));
  }
  out.push({
    ok: outside.length === 0, code: "hope", date: req.date,
    text: outside.length ? `希望の外：${[...new Set(outside)].join("、")}` : "希望の時間の中で入っている",
  });

  // ⑥ 同じ人が同じ時間に2つ入っていない（ほかの店舗への応援も含む）
  const all = req.allStoreAssignments || req.assignments;
  const doubled = new Set();   // 時間が重なっている人
  for (let index = 0; index < all.length; index++) {
    for (let index2 = index + 1; index2 < all.length; index2++) {
      const shiftA = all[index], shiftB = all[index2];   // 比べる2つの勤務
      if (shiftA.memberId === shiftB.memberId && overlaps(shiftA.from, shiftA.to, shiftB.from, shiftB.to)) doubled.add(shiftA.memberId);
    }
  }
  if (doubled.size) {
    out.push({ ok: false, code: "double", date: req.date, text: `同じ時間に2つ入っている：${[...doubled].map(nameOf).join("、")}` });
  }

  // ⑦ 勤務の時間がおかしくないか（終わりが始まりより前など）
  const broken = req.assignments.filter((shift) => shift.to <= shift.from);
  if (broken.length) {
    out.push({ ok: false, code: "time", date: req.date, text: `時間がおかしい：${broken.map((shift) => nameOf(shift.memberId)).join("、")}` });
  }

  return out;
}

// ------------------------------------------------------------
// 1週間分のチェック
// ------------------------------------------------------------

/**
 * 週全体のルール
 * @param {object} props
 * @param {string[]} props.dates          7日分の日付
 * @param {object[]} props.assignments    その週の勤務（この店舗）
 * @param {object[]} props.members        店員
 * @param {object[]} props.availabilities その週の希望
 * @returns {Problem[]}
 */
export function checkWeek(props) {
  const out = [];   // チェックの結果
  const active = props.members.filter((member) => member.active);   // 働いている人（休止していない）

  // ① 全員、週1日は必ず休み
  const noRest = active.filter((member) => {
    const days = new Set(props.assignments.filter((shift) => shift.memberId === member.id).map((shift) => shift.date));   // その人が入っている日
    return props.dates.every((date) => days.has(date));
  });
  out.push({
    ok: noRest.length === 0, code: "rest",
    text: noRest.length ? `週1日の休みがない：${noRest.map((member) => member.name).join("、")}` : "全員、週1日の休みあり",
  });

  // ② 社員の休みの日数（要件 F-48・F-49）
  //    希望なし → 休みは週1日だけ（店長が決める）／ 休み希望あり → 希望した日数（2日目は特別許可）
  const tooMany = [];
  for (const member of active.filter((member) => member.kind === "shain")) {
    const asked = props.availabilities.filter((hope) => hope.memberId === member.id && ["off", "offx", "no"].includes(hope.kind)).length;   // 休み希望の日数
    const allowed = asked > 0 ? asked : 1;   // 休んでよい日数（希望なし＝1日）
    const worked = new Set(props.assignments.filter((shift) => shift.memberId === member.id).map((shift) => shift.date));   // 入っている日
    const off = props.dates.filter((date) => !worked.has(date)).length;   // 休みの日数
    if (off > allowed) tooMany.push(`${member.name}（${asked ? `休み希望${asked}日` : "希望なし＝週1日"}、今${off}日休み）`);
  }
  out.push({
    ok: tooMany.length === 0, code: "shain-off",
    text: tooMany.length ? `社員の休みが多い：${tooMany.join("、")}` : "社員の休みの日数",
  });

  // ③ 社員の2日目の休み希望は特別許可の申請（offx）。店長が許可するまで警告
  const waiting = props.availabilities.filter((hope) => hope.kind === "offx");
  if (waiting.length) {
    /** IDから名前 */
    const nameOf = (id) => props.members.find((member) => member.id === id)?.name || "？";
    out.push({ ok: false, code: "special", text: `特別許可を待っている休み：${waiting.map((shift) => `${nameOf(shift.memberId)} ${shift.date.slice(5)}`).join("、")}` });
  }

  return out;
}

/** チェック結果から「守れていないもの」だけを取り出す */
export function onlyProblems(results) {
  return results.filter((result) => !result.ok);
}
