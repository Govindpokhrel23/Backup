#!/bin/sh
# ============================================================
# tools/make-site.sh — Cloudflare Pages に上げるフォルダ（dist）を作る
# このファイルは、アプリを動かすのに必要なファイルだけを dist/ にコピーするためのファイルです。
# （テスト・Supabase の SQL・Worker・説明書は上げない）
# 使い方（MacBook のターミナルで、このフォルダの中で）：  sh tools/make-site.sh
# できた dist フォルダを、Cloudflare Pages の「Upload assets」に入れる。
# ============================================================
set -e                                   # まちがいがあったら止まる
cd "$(dirname "$0")/.."                  # アプリのフォルダへ
rm -rf dist && mkdir dist                # 前の dist を消して作り直す
cp index.html manifest.webmanifest sw.js _headers dist/   # 入口・ホーム画面の設定・電波なしの仕組み・安全の設定
cp -R css js dist/                       # 見た目とプログラム
cp -R icons dist/                        # アイコン（ホーム画面・通知）
echo "dist ができました（$(find dist -type f | wc -l | tr -d ' ') ファイル）"   # できたファイルの数を出す
