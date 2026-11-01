-- 資料庫權限（RLS）、版本衝突、修改紀錄的自動測試。
-- 用 scripts/test-db.sh 在本機的臨時 PostgreSQL 執行，不會連到 Supabase。
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

create schema test;
grant usage on schema test to anon, authenticated;
create table test.results (n serial, name text, ok boolean, detail text);
grant all on test.results to anon, authenticated;
grant usage on sequence test.results_n_seq to anon, authenticated;

-- 切換成某個登入使用者（null = 未登入）
create function test.act_as(uid uuid, email text) returns void language plpgsql as $$
begin
  perform set_config('role', case when uid is null then 'anon' else 'authenticated' end, false);
  perform set_config('request.jwt.claims',
    case when uid is null then '{}' else json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text end, false);
end $$;
grant execute on function test.act_as(uuid, text) to anon, authenticated;

create function test.ok(name text, cond boolean, detail text default '') returns void language plpgsql as $$
begin
  insert into test.results (name, ok, detail) values (name, coalesce(cond, false), detail);
end $$;

-- 執行一段 SQL，預期失敗且錯誤訊息符合 pattern
create function test.fails(name text, stmt text, pattern text) returns void language plpgsql as $$
begin
  execute stmt;
  perform test.ok(name, false, '預期失敗，但執行成功');
exception when others then
  perform test.ok(name, sqlerrm ~* pattern, sqlerrm);
end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'usagi@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'husband@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@example.com');

-- 1. 未登入不能讀
select test.act_as(null, null);
select test.fails('未登入不能讀取旅行', 'select * from public.trips', 'permission denied');
select test.fails('未登入不能建立家庭', 'select public.create_household(''x'')', 'permission denied');

-- 2. 兔兔建立家庭與資料
select test.act_as('11111111-1111-1111-1111-111111111111', 'usagi@example.com');
create temp table ctx as select public.create_household('兔兔家', '兔兔') as hid;
grant select on ctx to anon, authenticated;
select test.ok('兔兔建立家庭並成為管理者',
  (select role from public.household_members where user_id = auth.uid()) = 'owner');
select test.fails('不能重複建立家庭', 'select public.create_household(''第二個家'')', '已經屬於');

insert into public.trips (id, household_id, name, year, start_date, end_date, destination)
select 'aaaaaaaa-0000-0000-0000-000000000001', hid, '北海道旅行', 2027, '2027-02-01', '2027-02-07', '北海道' from ctx;
insert into public.flights (household_id, trip_id, airline, flight_number, depart_at)
select hid, 'aaaaaaaa-0000-0000-0000-000000000001', '長榮', 'BR116', '2027-02-01 09:00' from ctx;
insert into public.itinerary_items (id, household_id, trip_id, day_date, start_time, title)
select 'bbbbbbbb-0000-0000-0000-000000000001', hid, 'aaaaaaaa-0000-0000-0000-000000000001', '2027-02-02', '10:00', '小樽運河' from ctx;
insert into public.todos (household_id, trip_id, category, title)
select hid, 'aaaaaaaa-0000-0000-0000-000000000001', 'documents', '護照' from ctx;
insert into public.expenses (household_id, trip_id, category, name, amount, currency)
select hid, 'aaaaaaaa-0000-0000-0000-000000000001', 'food', '拉麵', 1200, 'JPY' from ctx;
insert into public.places (household_id, trip_id, category, title)
select hid, 'aaaaaaaa-0000-0000-0000-000000000001', 'food', '湯咖哩' from ctx;

select test.ok('新增行程時自動建立「那一天」',
  (select count(*) from public.itinerary_days where day_date = '2027-02-02') = 1
  and (select day_id is not null from public.itinerary_items where id = 'bbbbbbbb-0000-0000-0000-000000000001'));
select test.ok('建立者、版本自動填入',
  (select created_by = auth.uid() and updated_by = auth.uid() and version = 1
   from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select test.fails('金額不能是負數',
  'insert into public.expenses (household_id, trip_id, name, amount) select hid, ''aaaaaaaa-0000-0000-0000-000000000001'', ''x'', -1 from ctx',
  'check constraint');
select test.fails('回程日期不能早於出發日期',
  'update public.trips set end_date = ''2027-01-01'' where id = ''aaaaaaaa-0000-0000-0000-000000000001''',
  'check constraint');

-- 3. 先生在被邀請前：看不到任何資料、不能寫入
select test.act_as('22222222-2222-2222-2222-222222222222', 'husband@example.com');
select test.ok('未加入家庭前看不到旅行', (select count(*) from public.trips) = 0);
select test.ok('未加入家庭前看不到修改紀錄', (select count(*) from public.audit_logs) = 0);
select test.ok('沒有邀請時無法加入', public.accept_invite() is null);
select test.fails('非成員不能寫入別人家的旅行',
  'insert into public.trips (household_id, name, year) select hid, ''偷偷新增'', 2027 from ctx',
  'row-level security');
select test.fails('非成員不能邀請別人', 'select public.invite_member(''x@example.com'')', '只有家庭管理者');

-- 4. 兔兔邀請先生，先生登入後加入
select test.act_as('11111111-1111-1111-1111-111111111111', 'usagi@example.com');
select public.invite_member('Husband@Example.com', '先生');
select test.act_as('22222222-2222-2222-2222-222222222222', 'husband@example.com');
select test.ok('先生接受邀請加入同一個家庭', public.accept_invite() = (select hid from ctx));
select test.ok('先生看得到兔兔新增的旅行', (select count(*) from public.trips) = 1);
select test.ok('先生看得到航班、行程、待辦、預算、景點',
  (select count(*) from public.flights) = 1 and (select count(*) from public.itinerary_items) = 1
  and (select count(*) from public.todos) = 1 and (select count(*) from public.expenses) = 1
  and (select count(*) from public.places) = 1);
insert into public.hotels (household_id, trip_id, name, check_in, check_out, booking_number)
select hid, 'aaaaaaaa-0000-0000-0000-000000000001', '函館飯店', '2027-02-03', '2027-02-05', 'ABC123' from ctx;
select test.ok('先生可以新增飯店', (select count(*) from public.hotels) = 1);
select test.fails('一般成員不能邀請別人', 'select public.invite_member(''x@example.com'')', '只有家庭管理者');
select test.fails('一般成員不能移除成員',
  'select public.remove_member(''11111111-1111-1111-1111-111111111111'')', '只有家庭管理者');
select test.fails('不能繞過邀請，自行把別人加進家庭',
  'insert into public.household_members (household_id, user_id) select hid, ''33333333-3333-3333-3333-333333333333'' from ctx',
  'permission denied');
update public.households set name = '改名', version = 1;
select test.ok('一般成員不能改家庭名稱（只有管理者可以）',
  (select name from public.households) = '兔兔家');

-- 5. 版本衝突：兩人都拿到 version 1，兔兔先存，先生後存 → 先生被擋下
select test.act_as('11111111-1111-1111-1111-111111111111', 'usagi@example.com');
update public.trips set notes = '兔兔的備註', version = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select test.ok('兔兔修改成功，版本變成 2',
  (select version from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2);
select test.act_as('22222222-2222-2222-2222-222222222222', 'husband@example.com');
select test.fails('先生用舊版本修改同一筆 → 版本衝突',
  'update public.trips set notes = ''先生的備註'', version = 1 where id = ''aaaaaaaa-0000-0000-0000-000000000001''',
  'VERSION_CONFLICT');
select test.ok('衝突時兔兔的內容沒有被覆蓋',
  (select notes from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001') = '兔兔的備註');
update public.hotels set notes = '先生修改不同資料', version = 1;
select test.ok('兩人修改不同資料互不影響',
  (select notes from public.hotels) = '先生修改不同資料'
  and (select notes from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001') = '兔兔的備註');
update public.trips set notes = '先生重新讀取後修改', version = 2 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select test.ok('重新讀取最新版本後可以修改，並記錄更新者是先生',
  (select updated_by = '22222222-2222-2222-2222-222222222222' and created_by = '11111111-1111-1111-1111-111111111111' and version = 3
   from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select test.fails('不能修改資料的 id',
  'update public.trips set id = gen_random_uuid(), version = 3 where id = ''aaaaaaaa-0000-0000-0000-000000000001''',
  '不允許');

-- 6. 修改紀錄
select test.ok('修改紀錄有記下兩人的操作',
  (select count(distinct changed_by) from public.audit_logs) = 2
  and (select count(*) from public.audit_logs where table_name = 'trips' and action = 'update') = 2);
select test.fails('不能新增假的修改紀錄',
  'insert into public.audit_logs (household_id, table_name, record_id, action) select hid, ''trips'', gen_random_uuid(), ''insert'' from ctx',
  'permission denied');
select test.fails('不能刪除修改紀錄', 'delete from public.audit_logs', 'permission denied');

-- 7. 陌生人：自己建立家庭也碰不到兔兔家的資料
select test.act_as('33333333-3333-3333-3333-333333333333', 'stranger@example.com');
select test.ok('陌生人沒有邀請無法加入', public.accept_invite() is null);
select test.ok('陌生人看不到任何旅行', (select count(*) from public.trips) = 0);
select test.ok('陌生人看不到訂房編號', (select count(*) from public.hotels) = 0);
select test.ok('陌生人看不到成員名單', (select count(*) from public.household_members) = 0);
create temp table ctx3 as select public.create_household('陌生人家') as hid;
select test.fails('陌生人不能把資料掛到兔兔家的旅行底下',
  'insert into public.flights (household_id, trip_id) select hid, ''aaaaaaaa-0000-0000-0000-000000000001'' from ctx3',
  'foreign key');
update public.trips set notes = '入侵' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select test.act_as('11111111-1111-1111-1111-111111111111', 'usagi@example.com');
select test.ok('陌生人的修改與刪除都沒有效果',
  (select notes from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001') = '先生重新讀取後修改');
select test.ok('兔兔家看不到陌生人家的資料', (select count(*) from public.households) = 1);

-- 8. 刪除旅行會一起刪除底下資料，並留下修改紀錄可供查詢
delete from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select test.ok('刪除旅行時底下資料一起刪除',
  (select count(*) from public.flights) + (select count(*) from public.hotels) + (select count(*) from public.itinerary_items)
  + (select count(*) from public.itinerary_days) + (select count(*) from public.todos) + (select count(*) from public.expenses)
  + (select count(*) from public.places) = 0);
select test.ok('刪除的內容仍保存在修改紀錄裡',
  (select old_data ->> 'name' from public.audit_logs where table_name = 'trips' and action = 'delete') = '北海道旅行');

-- 9. 管理者移除成員後，對方就看不到資料
insert into public.trips (household_id, name, year) select hid, '九州', 2028 from ctx;
select public.remove_member('22222222-2222-2222-2222-222222222222');
select test.act_as('22222222-2222-2222-2222-222222222222', 'husband@example.com');
select test.ok('被移除的成員看不到資料', (select count(*) from public.trips) = 0);

-- 結果
reset role;
\o
\set QUIET off
\pset footer off
select n as "#", case when ok then '✓' else '✗' end as "結果", name as "測試項目",
       case when ok then '' else detail end as "失敗原因"
from test.results order by n;
select count(*) filter (where ok) as "通過", count(*) filter (where not ok) as "失敗" from test.results;
do $$ begin
  if exists (select 1 from test.results where not ok) then raise exception '有測試失敗'; end if;
end $$;
