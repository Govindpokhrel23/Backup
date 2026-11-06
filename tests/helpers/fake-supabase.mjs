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

import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/** このテストのフォルダから見たアプリのフォルダ */
const ROOT = new URL("../../", import.meta.url);

/**
 * にせもの Supabase を作る
 * @returns {Promise<{client:object, admin:{createUser, sql}}>}
 *   client … アプリに渡す道具（supabase-js のかわり）
 *   admin  … テストの準備用（ログインの人を作る・SQLを直接流す）
 */
export async function createFakeSupabase() {
  // 日付・日時は文字のまま受け取る（本物の Supabase と同じ）
  const db = new PGlite({ parsers: { 1082: (v) => v, 1114: (v) => v, 1184: (v) => v, 20: (v) => Number(v) } });
  await db.exec(fs.readFileSync(new URL("tests/helpers/supabase-stub.sql", ROOT), "utf8"));
  await db.exec(fs.readFileSync(new URL("supabase/schema.sql", ROOT), "utf8"));

  let session = null;                                         // ログイン中の人 {user:{id}}

  /** ログイン中の人として SQL を動かす（決まり RLS が効く） */
  async function run(sql, params = []) {
    return db.transaction(async (tx) => {
      if (session) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: session.user.id, role: "authenticated" })]);
        await tx.exec("set local role authenticated");
      } else {
        await tx.exec("set local role anon");
      }
      return tx.query(sql, params);
    });
  }

  /** 結果を supabase-js と同じ {data, error} にする */
  const wrap = async (fn) => {
    try { return { data: await fn(), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
  };

  /** from(表) で作る「問い合わせ」 */
  class Query {
    /** 問い合わせを作る（はじめは「読む」） */
    constructor(table) {
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
    select() { if (this.op === "select") this.op = "select"; else this.returning = true; return this; }
    insert(rows) { this.op = "insert"; this.payload = [].concat(rows); return this; }
    upsert(rows, opt = {}) { this.op = "upsert"; this.payload = [].concat(rows); this.conflict = opt.onConflict; return this; }
    update(obj) { this.op = "update"; this.payload = obj; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.filters.push([c, "=", v]); return this; }
    neq(c, v) { this.filters.push([c, "<>", v]); return this; }
    gt(c, v) { this.filters.push([c, ">", v]); return this; }
    gte(c, v) { this.filters.push([c, ">=", v]); return this; }
    lt(c, v) { this.filters.push([c, "<", v]); return this; }
    lte(c, v) { this.filters.push([c, "<=", v]); return this; }
    in(c, list) { this.filters.push([c, "in", list]); return this; }
    order(c, opt = {}) { this.orders.push([c, opt.ascending !== false]); return this; }
    limit(n) { this.limitN = n; return this; }
    range(a, b) { this.offsetN = a; this.limitN = b - a + 1; return this; }   // a行目〜b行目（0から数える）
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    then(ok, ng) { return this.exec().then(ok, ng); }

    /** 値を SQL に渡せる形にする（オブジェクト・配列の列は JSON） */
    static val(v) { return v !== null && typeof v === "object" ? JSON.stringify(v) : v; }

    /** where の部分を作る */
    where(params) {
      if (!this.filters.length) return "";
      return " where " + this.filters.map(([c, op, v]) => {
        if (op === "in") { params.push(v); return `${c}::text = any($${params.length}::text[])`; }
        params.push(v); return `${c} ${op} $${params.length}`;
      }).join(" and ");
    }

    /** SQL を作って動かす */
    async exec() {
      return wrap(async () => {
        const params = [];   // SQL に渡す値
        let sql = "";   // 作る SQL
        const t = `public.${this.table}`;   // 表の名前（public.〇〇）
        if (this.op === "select") {
          sql = `select * from ${t}${this.where(params)}`;
          if (this.orders.length) sql += " order by " + this.orders.map(([c, asc]) => `${c} ${asc ? "asc" : "desc"}`).join(", ");
          if (this.limitN) sql += ` limit ${this.limitN}`;
          if (this.offsetN) sql += ` offset ${this.offsetN}`;
        } else if (this.op === "insert" || this.op === "upsert") {
          const cols = [...new Set(this.payload.flatMap((r) => Object.keys(r)))];   // 入れる列
          const values = this.payload.map((r) => "(" + cols.map((c) => { params.push(Query.val(r[c] ?? null)); return `$${params.length}`; }).join(",") + ")");   // 入れる値の行
          sql = `insert into ${t} (${cols.join(",")}) values ${values.join(",")}`;
          if (this.op === "upsert") {
            const keys = (this.conflict || "id").split(",").map((x) => x.trim());   // 同じとみなす列
            const rest = cols.filter((c) => !keys.includes(c));   // 上書きする列
            sql += ` on conflict (${keys.join(",")}) do ` + (rest.length ? `update set ${rest.map((c) => `${c} = excluded.${c}`).join(",")}` : "nothing");
          }
          if (this.returning) sql += " returning *";
        } else if (this.op === "update") {
          const sets = Object.entries(this.payload).map(([c, v]) => { params.push(Query.val(v)); return `${c} = $${params.length}`; });   // 直す列と値
          sql = `update ${t} set ${sets.join(",")}${this.where(params)}${this.returning ? " returning *" : ""}`;
        } else if (this.op === "delete") {
          sql = `delete from ${t}${this.where(params)}`;
        }
        const rows = (await run(sql, params)).rows;   // 結果の行
        if (this.op !== "select" && !this.returning) return null;
        if (this.mode === "single") { if (rows.length !== 1) throw new Error(`1行のはずが ${rows.length}行`); return rows[0]; }
        if (this.mode === "maybe") { if (rows.length > 1) throw new Error("2行以上あります"); return rows[0] ?? null; }
        return rows;
      });
    }
  }

  const client = {   // アプリに渡す道具（supabase-js のかわり）
    from: (table) => new Query(table),
    /** データベースの関数を呼ぶ */
    rpc: (name, args = {}) => wrap(async () => {
      const keys = Object.keys(args);   // 関数に渡す名前
      const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;   // 関数を呼ぶ SQL
      return (await run(sql, keys.map((k) => args[k]))).rows[0].r;
    }),
    auth: {
      /** ID（メール）とパスワードでログイン */
      async signInWithPassword({ email, password }) {
        const r = await db.query("select id from auth.users where email = $1 and password = $2", [email, password]);   // IDとパスワードが合う人
        if (!r.rows.length) return { data: null, error: { message: "Invalid login credentials" } };
        session = { user: { id: r.rows[0].id, email } };
        return { data: { session, user: session.user }, error: null };
      },
      async signOut() { session = null; return { error: null }; },
      async getSession() { return { data: { session }, error: null }; },
    },
  };

  const admin = {   // テストの準備用の道具
    /** ログインの人を作る（本物では Worker の /activate がする）→ そのIDを返す */
    async createUser(email, password) {
      return (await db.query("insert into auth.users(email, password) values ($1, $2) returning id", [email, password])).rows[0].id;
    },
    /** 決まりを通らずに SQL を流す（テストの準備・確かめ用） */
    sql: (q, p) => db.query(q, p),
    exec: (q) => db.exec(q),
  };

  return { client, admin };
}
