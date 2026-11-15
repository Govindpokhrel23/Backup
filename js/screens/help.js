// ============================================================
// screens/help.js — ヘルプ（使い方）
// ------------------------------------------------------------
// このファイルは、アプリの使い方をタブで見る画面のファイルです（2026年11月15日）。
// ・説明の文は help/help-topics.js にまとめてある（この画面は描くだけ）
// ・上のタブで「はじめに／希望入力／シフト作成…」を切りかえる
// ・店長には店長用のタブも出す。店員には店員に関係あるタブだけ出す
// ・最後に見たタブを覚えておく（このスマホの中だけ）
// 入口：店長＝「店舗」タブ →「ヘルプ」／店員＝ホーム →「設定」→「使い方（ヘルプ）」
// ============================================================

import { createElement, mount } from "../lib/dom.js";   // 画面の部品を作る・画面に入れる道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { isManager } from "../store.js";   // 店長か調べる道具を読む
import { HELP_TOPICS } from "../help/help-topics.js";   // ヘルプの中身を読む

/** 最後に見たタブを覚えておく場所の名前 */
const TAB_KEY = "shiftapp-help-tab";   // スマホの中に覚える名前

/** 最後に見たタブを読む（読めない時は null） */
function loadTab() {   // 覚えたタブを読む関数
  try { return localStorage.getItem(TAB_KEY); } catch { return null; }   // 読めない時（プライベートモードなど）は null
}

/** 見ているタブを覚える（覚えられなくても止めない） */
function saveTab(id) {   // タブを覚える関数
  try { localStorage.setItem(TAB_KEY, id); } catch { /* 覚えられなくても使える */ }   // 覚える
}

/** この人に見せてよいか（"manager" は店長だけ） */
function canSee(item, manager) {   // 見せてよいか調べる関数
  return item.who !== "manager" || manager;   // 店長用は店長だけ
}

/** ヘルプの画面を描く（全員） */
export async function renderHelp(app) {   // ヘルプの画面を描く関数
  const manager = isManager();   // 店長か
  const topics = HELP_TOPICS.filter((topic) => canSee(topic, manager));   // この人に見せるタブ
  let current = topics.find((topic) => topic.id === loadTab()) || topics[0];   // はじめに開くタブ（前に見たタブ、なければ最初）
  draw();   // 描く

  /** 画面を描く */
  function draw() {   // 画面を描く関数
    mount(app,   // 画面に入れる
      screenHeader({   // 見出し（スクロールしても上に残る）
        title: "ヘルプ", sub: "アプリの使い方",   // タイトル
        extra: [createElement("nav", { class: "help-tabs", "aria-label": "ヘルプのタブ" },   // タブの行（横にスクロール）
          topics.map((topic) => createElement("button", {   // タブごとに
            class: "chip help-tabs__btn",   // 見た目
            "aria-pressed": String(topic.id === current.id),   // 選んでいるタブに印
            onclick: () => { current = topic; saveTab(topic.id); draw(); window.scrollTo(0, 0); },   // 押したらそのタブ
          }, topic.title)))],   // タブの名前
      }),
      createElement("div", { class: "screen-body" },   // 本文
        current.sections.filter((section) => canSee(section, manager)).map((section) => sectionCard(section)),   // 見出しごとのカード
      ),
    );
    // 選んでいるタブが見えるように、タブの行を横にスクロールする
    app.querySelector('.help-tabs__btn[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });   // 選んだタブを真ん中へ
  }
}

/** 見出し1つ分のカード（手順は番号つき、ポイントは・つき） */
function sectionCard(section) {   // 見出しのカードを作る関数
  return createElement("section", { class: "card help-card" },   // カード
    createElement("h2", { class: "card__title" }, section.h),   // 見出し
    section.steps   // 手順があれば
      ? createElement("ol", { class: "help-list help-list--steps" }, section.steps.map((text) => createElement("li", null, text)))   // 番号つきの一覧
      : null,   // なければ出さない
    section.points   // ポイントがあれば
      ? createElement("ul", { class: "help-list" }, section.points.map((text) => createElement("li", null, text)))   // ・つきの一覧
      : null,   // なければ出さない
  );
}
