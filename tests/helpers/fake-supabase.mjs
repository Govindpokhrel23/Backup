// ============================================================
// tests/helpers/fake-supabase.mjs — テスト用の「にせもの Supabase」
// ------------------------------------------------------------
// このファイルは、本物の Postgres（PGlite＝Node の中で動く Postgres）の上に、
// supabase-js と同じ使い方ができる「にせものの道具」を作るファイルです（2026年11月6日）。
//
// ・supabase/schema.sql をそのまま流すので、表と決まり（RLS）は本物と同じ
// ・ログイン中の人として SQL を動かす（role authenticated ＋ JWT の sub）ので、
//   「店員は公開前のシフトを見られない」などの決まりも本当に確かめられる
// ・使える書き方は、アプリで使っているものだけ：
//   from().select/insert/update/delete/upsert ＋ eq/neq/in/gte/lte/gt/lt/order/limit/single/maybeSingle、rpc、auth
// ============================================================

import fs from "node:fs";   // ファイルを読む道具
import { PGlite } from "@electric-sql/pglite";   // パソコンの中で動く小さい PostgreSQL

/** このテストのフォルダから見たアプリのフォルダ */
const ROOT = new URL("../../", import.meta.url);   // プロジェクトの一番上のフォルダ

/**
 * にせもの Supabase を作る
 * @returns {Promise<{client:object, admin:{createUser, sql}}>}
 *   client … アプリに渡す道具（supabase-js のかわり）
 *   admin  … テストの準備用（ログインの人を作る・SQLを直接流す）
 */
export async function createFakeSupabase() {   // にせものの Supabase を作る関数
  // 日付・日時は文字のまま受け取る（本物の Supabase と同じ）
  const db = new PGlite({ parsers: { 1082: (value) => value, 1114: (value) => value, 1184: (value) => value, 20: (value) => Number(value) } });   // データベース（日付などは文字のまま受け取る）
  await db.exec(fs.readFileSync(new URL("tests/helpers/supabase-stub.sql", ROOT), "utf8"));   // ログインの仕組みのまねを入れる
  await db.exec(fs.readFileSync(new URL("supabase/schema.sql", ROOT), "utf8"));   // 本物と同じ表とルール（RLS）を入れる

  let session = null;                                         // ログイン中の人 {user:{id}}

  /** ログイン中の人として SQL を動かす（決まり RLS が効く） */
  async function run(sql, params = []) {   // ログイン中の人として SQL を動かす関数
    return db.transaction(async (tx) => {   // 1回ごとのまとまりで
      if (session) {   // ログインしていれば
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: session.user.id, role: "authenticated" })]);   // その人のIDを入れる
        await tx.exec("set local role authenticated");   // ログインした人の役割にする
      } else {   // していなければ
        await tx.exec("set local role anon");   // ログイン前の人の役割にする
      }
      return tx.query(sql, params);   // SQL を動かす
    });
  }

  /** 結果を supabase-js と同じ {data, error} にする */
  const wrap = async (fn) => {   // 結果を supabase-js と同じ形にする
    try { return { data: await fn(), error: null }; } catch (error) { return { data: null, error: { message: error.message } }; }   // 成功なら data、失敗なら error
  };

  /** from(表) で作る「問い合わせ」 */
  class Query {   // 表への問い合わせのまね
    /** 問い合わせを作る（はじめは「読む」） */
    constructor(table) {   // 表の名前を受け取る
      this.table = table;       // 表の名前
      this.op = "select";       // select / insert / update / delete / upsert
      this.filters = [];        // [列, 記号, 値]
      this.orders = [];         // [列, 小さい順か]
      this.limitN = null;       // 何行まで
      this.mode = "many";       // many / single / maybe
      this.returning = false;   // 書いたあと、その行を返すか
      this.payload = null;      // 書く中身
      this.conflict = null;     // upsert の時、同じとみなす列
    }
    select() { if (this.op === "select") this.op = "select"; else this.returning = true; return this; }   // 読む（書いた後なら、書いたものを返す）
    insert(rows) { this.op = "insert"; this.payload = [].concat(rows); return this; }   // 入れる
    upsert(rows, opt = {}) { this.op = "upsert"; this.payload = [].concat(rows); this.conflict = opt.onConflict; return this; }   // 入れる・あれば上書き
    update(obj) { this.op = "update"; this.payload = obj; return this; }   // 変える
    delete() { this.op = "delete"; return this; }   // 消す
    eq(column, value) { this.filters.push([column, "=", value]); return this; }   // 〜と同じ
    neq(column, value) { this.filters.push([column, "<>", value]); return this; }   // 〜とちがう
    gt(column, value) { this.filters.push([column, ">", value]); return this; }   // 〜より大きい
    gte(column, value) { this.filters.push([column, ">=", value]); return this; }   // 〜以上
    lt(column, value) { this.filters.push([column, "<", value]); return this; }   // 〜より小さい
    lte(column, value) { this.filters.push([column, "<=", value]); return this; }   // 〜以下
    in(column, list) { this.filters.push([column, "in", list]); return this; }   // 〜のどれか
    order(column, opt = {}) { this.orders.push([column, opt.ascending !== false]); return this; }   // 並べる順
    limit(count) { this.limitN = count; return this; }   // 件数の上限
    range(start, end) { this.offsetN = start; this.limitN = end - start + 1; return this; }   // a行目〜b行目（0から数える）
    single() { this.mode = "single"; return this; }   // 1行だけ（なければエラー）
    maybeSingle() { this.mode = "maybe"; return this; }   // 1行か0行
    then(ok, ng) { return this.exec().then(ok, ng); }   // await できるようにする

    /** 値を SQL に渡せる形にする（オブジェクト・配列の列は JSON） */
    static val(value) { return value !== null && typeof value === "object" ? JSON.stringify(value) : value; }   // 値を SQL に入れられる形にする

    /** where の部分を作る */
    where(params) {   // where の文を作る
      if (!this.filters.length) return "";   // 条件がなければ空
      return " where " + this.filters.map(([column, op, value]) => {   // 条件を1つずつ
        if (op === "in") { params.push(value); return `${column}::text = any($${params.length}::text[])`; }   // 「どれか」の条件
        params.push(value); return `${column} ${op} $${params.length}`;   // ふつうの条件
      }).join(" and ");   // and でつなぐ
    }

    /** SQL を作って動かす */
    async exec() {   // SQL を作って動かす
      return wrap(async () => {   // 結果を data/error の形にする
        const params = [];   // SQL に渡す値
        let sql = "";   // 作る SQL
        const tableName = `public.${this.table}`;   // 表の名前（public.〇〇）
        if (this.op === "select") {   // 読む時
          sql = `select * from ${tableName}${this.where(params)}`;   // select の文
          if (this.orders.length) sql += " order by " + this.orders.map(([order, asc]) => `${order} ${asc ? "asc" : "desc"}`).join(", ");   // 並べる順
          if (this.limitN) sql += ` limit ${this.limitN}`;   // 件数の上限
          if (this.offsetN) sql += ` offset ${this.offsetN}`;   // 飛ばす件数
        } else if (this.op === "insert" || this.op === "upsert") {   // 入れる時
          const cols = [...new Set(this.payload.flatMap((row) => Object.keys(row)))];   // 入れる列
          const values = this.payload.map((row) => "(" + cols.map((column) => { params.push(Query.val(row[column] ?? null)); return `$${params.length}`; }).join(",") + ")");   // 入れる値の行
          sql = `insert into ${tableName} (${cols.join(",")}) values ${values.join(",")}`;   // insert の文
          if (this.op === "upsert") {   // 上書きもする時
            const keys = (this.conflict || "id").split(",").map((part) => part.trim());   // 同じとみなす列
            const rest = cols.filter((col) => !keys.includes(col));   // 上書きする列
            sql += ` on conflict (${keys.join(",")}) do ` + (rest.length ? `update set ${rest.map((column) => `${column} = excluded.${column}`).join(",")}` : "nothing");   // ぶつかったら上書き
          }
          if (this.returning) sql += " returning *";   // 書いたものを返す
        } else if (this.op === "update") {   // 変える時
          const sets = Object.entries(this.payload).map(([column, value]) => { params.push(Query.val(value)); return `${column} = $${params.length}`; });   // 直す列と値
          sql = `update ${tableName} set ${sets.join(",")}${this.where(params)}${this.returning ? " returning *" : ""}`;   // update の文
        } else if (this.op === "delete") {   // 消す時
          sql = `delete from ${tableName}${this.where(params)}`;   // delete の文
        }
        const rows = (await run(sql, params)).rows;   // 結果の行
        if (this.op !== "select" && !this.returning) return null;   // 返さなくてよければ null
        if (this.mode === "single") { if (rows.length !== 1) throw new Error(`1行のはずが ${rows.length}行`); return rows[0]; }   // 1行だけの時
        if (this.mode === "maybe") { if (rows.length > 1) throw new Error("2行以上あります"); return rows[0] ?? null; }   // 1行か0行の時
        return rows;   // 全部返す
      });
    }
  }

  const client = {   // アプリに渡す道具（supabase-js のかわり）
    from: (table) => new Query(table),   // 表への問い合わせ
    /** データベースの関数を呼ぶ */
    rpc: (name, args = {}) => wrap(async () => {   // データベースの関数を呼ぶ
      const keys = Object.keys(args);   // 関数に渡す名前
      const sql = `select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(", ")}) as r`;   // 関数を呼ぶ SQL
      return (await run(sql, keys.map((key) => args[key]))).rows[0].r;   // 1つ目の結果を返す
    }),
    auth: {   // ログインのまね
      /** ID（メール）とパスワードでログイン */
      async signInWithPassword({ email, password }) {   // ログインする
        const found = await db.query("select id from auth.users where email = $1 and password = $2", [email, password]);   // IDとパスワードが合う人
        if (!found.rows.length) return { data: null, error: { message: "Invalid login credentials" } };   // いなければエラー
        session = { user: { id: found.rows[0].id, email } };   // ログインした状態にする
        return { data: { session, user: session.user }, error: null };   // 結果を返す
      },
      async signOut() { session = null; return { error: null }; },   // ログアウト
      async getSession() { return { data: { session }, error: null }; },   // 今のログインを出す
    },
  };

  const admin = {   // テストの準備用の道具
    /** ログインの人を作る（本物では Worker の /activate がする）→ そのIDを返す */
    async createUser(email, password) {   // テスト用のログインの人を作る
      return (await db.query("insert into auth.users(email, password) values ($1, $2) returning id", [email, password])).rows[0].id;   // IDを返す
    },
    /** 決まりを通らずに SQL を流す（テストの準備・確かめ用） */
    sql: (sql, params) => db.query(sql, params),   // 管理者として SQL を動かす
    exec: (sql) => db.exec(sql),   // 管理者として SQL をまとめて動かす
  };

  return { client, admin };   // ふつうの道具と管理者用の道具を返す
}
