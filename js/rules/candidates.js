// ============================================================
// rules/candidates.js — 人が足りない時に「入れそうな人」をさがす
// ------------------------------------------------------------
// このファイルは、人が足りない時間に入れそうな人を選んで、
// 入れそうな順に並べるファイルです（2026年11月5日）。
// 自動連絡（mock-calls.js）と、シフト作成の「入れそうな人」の表示で使う。
//
// 入れそうな人の決まり：
//   ・その店舗に行ける人（メイン・2nd・3rd）で、今も働いている人（休止していない）
//   ・その場所（ホール／キッチン）が 50% 以上できる
//   ・その日、その時間にどの店舗にも入っていない（時間がかぶらない）
//   ・その日に「入れない」「休み希望」を出していない
//   ・時間指定の希望なら、足りない時間と少しでも重なる
// 並べ方：希望が合う人 → メインの店舗の人（2nd・3rd はあと）→ できる％が高い人
// ============================================================

import { overlaps } from "../lib/time.js";   // 時間が重なるか調べる道具を読む

/** 「休み」とみなす希望の種類（入れない・休み希望・特別許可の申請中） */
const OFF_KINDS = ["no", "off", "offx"];   // 入れない希望の種類（×・休み・特別休み）

/**
 * 入れそうな人をさがす
 * @param {object} props
 * @param {{date:string, area:string, from:number, to:number}} props.need  足りない日・場所・時間
 * @param {string}   props.storeId          足りない店舗
 * @param {object[]} props.members          会社の店員みんな（stores：行ける店舗と順番）
 * @param {object[]} props.dayAssignments   その日の勤務（全部の店舗）
 * @param {object[]} props.availabilities   その日の希望（全員分）
 * @returns {{member:object, rank:number, fit:"hope"|"any"|"nohope", score:number}[]} 入れそうな順
 */
export function findCandidates(props) {   // 足りない時間に入れそうな人を探す関数
  const { need } = props;                                       // 足りない所
  const list = [];                                          // 見つかった人をためる
  for (const member of props.members) {   // 店員を1人ずつ
    // ① その店舗に行けるか（行ける店舗の順番。行けなければ null）
    const rank = rankOf(member, props.storeId);   // その店での順位（所属店なら1）
    if (rank == null || !member.active || member.role === "manager") continue;   // この店に関係ない人・休止中・店長は外す
    // ② その場所が 50% 以上できるか
    if ((member.skills?.[need.area] ?? 0) < 50) continue;   // その場所のできること％が50未満なら外す
    // ③ その時間にどこかの店舗に入っていないか
    const busy = props.dayAssignments.some((shift) => shift.memberId === member.id && overlaps(shift.from, shift.to, need.from, need.to));   // その時間にもう入っているか
    if (busy) continue;   // 入っていたら外す
    // ④ 希望を見る
    const hope = props.availabilities.find((hope) => hope.memberId === member.id && hope.date === need.date);   // その日の希望
    if (hope && OFF_KINDS.includes(hope.kind)) continue;   // 休み希望なら外す
    if (hope?.kind === "time" && !overlaps(hope.from, hope.to, need.from, need.to)) continue;   // 時間の希望が合わなければ外す
    // ⑤ 点数：希望が合う人ほど上、メインの店舗の人ほど上、できる％が高いほど上
    const fit = !hope ? "nohope" : hope.kind === "any" ? "any" : "hope";     // 希望との合い方
    const fitPoint = { hope: 300, any: 250, nohope: 0 }[fit];                // 希望の点
    const score = fitPoint + (4 - Math.min(rank, 3)) * 50 + (member.skills?.[need.area] ?? 0);   // 入れそうな度合い（大きいほど上）
    list.push({ member: member, rank, fit, score });   // 候補に足す
  }
  return list.sort((candidateA, candidateB) => candidateB.score - candidateA.score);   // 点数が高い順に並べて返す
}

/** その人のその店舗での順番（1＝メイン、2＝2nd…。行けなければ null） */
export function rankOf(member, storeId) {   // その人のその店での順位を出す関数
  if (member.stores?.length) return member.stores.find((store) => store.storeId === storeId)?.rank ?? null;   // 何店舗も持つ人は、その店の順位
  return member.storeId === storeId ? 1 : null;   // 1店舗だけの人は、所属店なら1
}

/**
 * 足りない時間をまとめる（連絡の数を少なくするため）
 * 同じ日・同じ場所で、間が1時間以内の足りない時間は1つにする
 * 例：ホール 9:00〜11:00 と 11:30〜14:00 → 9:00〜14:00
 * @param {{date,area,from,to,short}[]} needs
 * @returns {{date,area,from,to,short}[]}
 */
export function mergeNeeds(needs) {   // 近くの足りない時間をまとめる関数
  const sorted = [...needs].sort((needA, needB) => needA.date.localeCompare(needB.date) || needA.area.localeCompare(needB.area) || needA.from - needB.from);   // 日・場所・時刻の順に並べたもの
  const out = [];                                                      // まとめた結果
  for (const need of sorted) {   // 1つずつ
    const last = out[out.length - 1];                                  // 1つ前
    if (last && last.date === need.date && last.area === need.area && need.from - last.to <= 60) {   // 同じ日・同じ場所で1時間以内につながるなら
      last.to = Math.max(last.to, need.to);   // 終わりをのばす
      last.short = Math.max(last.short || 1, need.short || 1);   // 足りない人数は多い方
    } else {   // つながらない時は
      out.push({ ...need });   // 新しく足す
    }
  }
  return out;   // まとめた結果を返す
}
