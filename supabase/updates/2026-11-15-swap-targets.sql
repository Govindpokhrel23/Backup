-- ============================================================
-- supabase/updates/2026-11-15-swap-targets.sql — 交代の「頼む人」を足す
-- ------------------------------------------------------------
-- このファイルは、もう動いているデータベースに「交代を頼む人」を足すSQLのファイルです（2026年11月15日）。
-- Supabase の SQL Editor に貼って「Run」を1回押す。何回押しても大丈夫
-- ============================================================

alter table swaps add column if not exists targets jsonb not null default '[]';   -- 頼む人（空なら行ける人みんな）

-- 「代わります」の関数：頼む人を決めてあれば、その人だけ代われる
create or replace function take_swap(p_swap_id text) returns json   -- 交代を引き受ける関数
language plpgsql security definer set search_path = public as $$   -- 表のルールをこえて動く
declare   -- 使う変数
  me_id text := my_member_id();   -- ログイン中の人
  me_name text;                   -- その人の名前
  x swaps;                        -- その交代のお願い
begin   -- 始まり
  select * into x from swaps where id = p_swap_id and store_in_my_company(store_id);   -- 交代を探す
  if x.id is null or x.status <> 'open' then raise exception 'この交代はもう受け付けていません'; end if;   -- 募集中でなければ止める
  if x.from_member_id = me_id then raise exception '自分の勤務には代われません'; end if;   -- 自分の勤務なら止める
  if jsonb_array_length(x.targets) > 0 and not (x.targets ? me_id) then raise exception 'この交代は、頼まれた人だけが代われます'; end if;   -- 頼む人を決めてあれば、その人だけ
  if exists(select 1 from assignments a where a.member_id = me_id and a.date = x.date and a.from_min < x.to_min and x.from_min < a.to_min) then   -- 同じ時間に勤務があれば
    raise exception '同じ時間にほかの勤務が入っています';   -- 止める
  end if;   -- ここまで
  update swaps set status = 'taken', taker_id = me_id where id = x.id;   -- 引き受けた状態にする
  select name into me_name from members where id = me_id;   -- 自分の名前
  insert into notifications(member_id, text)   -- お知らせを足す
    select id, to_char(x.date, 'FMMM/FMDD') || ' の交代：' || me_name || 'さんが代わると言っています（承認待ち）'   -- 「11/9 の交代：〇〇さんが代わると言っています」
    from members where company_id = my_company() and role = 'manager' and active;   -- 会社の店長たちに
  return json_build_object('id', x.id, 'status', 'taken');   -- 結果を返す
end $$;   -- 終わり

select '交代の「頼む人」を足しました' as "結果";   -- できたら出る
