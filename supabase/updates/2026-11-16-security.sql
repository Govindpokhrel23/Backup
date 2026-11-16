-- ============================================================
-- supabase/updates/2026-11-16-security.sql — セキュリティを強くする
-- ------------------------------------------------------------
-- このファイルは、もう動いているデータベースを、セキュリティを強くした形にするSQLのファイルです（2026年11月16日）。
-- Supabase の SQL Editor に貼って「Run」を1回押す。何回押しても大丈夫
--   ① 初回コードを当てられにくい作り方にする
--   ② 店員は、ほかの店員にお知らせを送れない（店長にだけ送れる）
--   ③ 締切をすぎた週・受付が終わった週の希望は、データベースでも変えられない
-- ============================================================

-- 6けたの初回コードを作る（random() ではなく、当てられにくい gen_random_uuid() を使う）
create or replace function secure_code() returns text   -- 6けたのでたらめな数を返す関数
language sql volatile set search_path = public as $$   -- 毎回ちがう値を返す
  select lpad((((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint) % 900000) + 100000)::text, 6, '0')   -- 当てられにくい乱数から 100000〜999999
$$;   -- 関数の終わり

-- その人が店長か（お知らせを送ってよい相手か調べる）
create or replace function member_is_manager(mid text) returns boolean   -- 店長か返す関数
language sql stable security definer set search_path = public as $$   -- 表のルールをこえて読める関数
  select exists(select 1 from members where id = mid and role = 'manager' and active)   -- 店長ならtrue
$$;   -- 関数の終わり

-- 希望の見張り：店員は、締切をすぎた週・受付が終わった週の希望を変えられない（アプリだけでなくデータベースでも止める）
create or replace function guard_hopes() returns trigger   -- 希望を変える前に調べる関数
language plpgsql security definer set search_path = public as $$   -- 表のルールをこえて読める
declare   -- 使う変数
  r availabilities := coalesce(new, old);   -- 変える希望（消す時は old）
  monday date := r.date - (extract(isodow from r.date)::int - 1);   -- その週の月曜
  store text;   -- その人のメインの店舗
begin   -- 始まり
  if auth.uid() is null or i_am_manager() then return coalesce(new, old); end if;   -- サーバー（管理用の鍵）と店長は止めない
  if (now() at time zone 'Asia/Tokyo')::date > monday - 1 then raise exception 'この週は締切をすぎています'; end if;   -- 締切（前の日曜24時）をすぎた
  select main_store_id into store from members where id = r.member_id;   -- メインの店舗
  if exists(select 1 from periods where store_id = store and week_start = monday and status <> 'open') then raise exception 'この週は受付が終わっています'; end if;   -- 受付が終わった
  return coalesce(new, old);   -- 変えてよい
end $$;   -- 関数の終わり
drop trigger if exists hopes_guard on availabilities;   -- 前の見張りを消す
create trigger hopes_guard before insert or update or delete on availabilities for each row execute function guard_hopes();   -- 見張りをつける

-- ② お知らせを送れる相手をしぼる
drop policy if exists notes_write on notifications;   -- 前の決まりを消す
create policy notes_write on notifications for insert with check (member_in_my_company(member_id) and my_member_id() is not null and (i_am_manager() or member_is_manager(member_id)));   -- お知らせ：店長は会社の人に、店員は店長にだけ送れる（2026年11月16日）

-- ① 初回コードを出す関数を、当てられにくい作り方にする
-- 初回コードを出す（店長）。アカウント作成・パスワードを忘れた時
create or replace function issue_login_code(p_member_id text) returns json   -- 初回コードを作る関数
language plpgsql security definer set search_path = public as $$   -- 表のルールをこえて動く
declare   -- 使う変数
  m members;      -- コードを出す店員
  c text;         -- 6桁のコード
begin   -- 始まり
  if not i_am_manager() then raise exception '店長だけができる操作です'; end if;   -- 店長でなければ止める
  select * into m from members where id = p_member_id and company_id = my_company();   -- 店員を探す
  if m.id is null then raise exception '店員が見つかりません'; end if;   -- いなければ止める
  c := secure_code();   -- 6けたのでたらめな数（当てられにくい作り方。2026年11月16日）
  insert into login_codes(login_id, code, used, created_at) values (m.login_id, c, false, now())   -- 保存
    on conflict (login_id) do update set code = excluded.code, used = false, attempts = 0, created_at = now();   -- あれば作り直す
  if m.account = 'none' then update members set account = 'invited' where id = m.id; end if;   -- アカウントなしなら招待中にする
  return json_build_object('loginId', m.login_id, 'code', c);   -- IDとコードを返す
end $$;   -- 関数の終わり

select 'セキュリティを強くしました' as "結果";   -- できたら出る
