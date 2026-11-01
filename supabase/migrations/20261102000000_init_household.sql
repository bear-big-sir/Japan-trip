-- =============================================================================
-- 兔兔家的日本自由行：雲端資料庫（第三步）
--
-- 在 Supabase：左側選單 SQL Editor → New query → 貼上整個檔案 → Run。
-- 這個檔案只需要執行一次。
--
-- 設計重點：
-- 1. 所有家庭資料都有 household_id，只有該家庭的成員能讀寫（RLS 在資料庫層強制）。
-- 2. 每筆資料都有 id、created_at、updated_at、created_by、updated_by、version。
-- 3. 修改時必須帶上「讀到的 version」；版本不符代表別人已改過 → 拒絕並回報衝突，不會默默覆蓋。
-- 4. 每次新增、修改、刪除都由資料庫自動寫入 audit_logs（修改紀錄），使用者無法竄改。
-- 5. 不開放任意加入家庭：只能由家庭管理者（owner）用 Email 邀請，被邀請的人登入後才能加入。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 家庭工作區與成員
-- -----------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  version integer not null default 1
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  -- 一個帳號只屬於一個家庭（unique），前端就不必選擇工作區
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  display_name text not null default '' check (char_length(display_name) <= 50),
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null check (email = lower(email) and email like '%_@_%'),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create unique index household_invites_pending_email
  on public.household_invites (email) where accepted_at is null;

-- 目前登入者所屬的家庭（沒有則為 null）。security definer：避免 RLS 自己查自己造成無限遞迴。
create or replace function public.my_household_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members where household_id = hid and user_id = auth.uid()
  )
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  )
$$;

-- -----------------------------------------------------------------------------
-- 共用觸發器：時間、操作者、版本
-- -----------------------------------------------------------------------------

create or replace function public.tg_stamp_insert()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.created_at := coalesce(new.created_at, now());
  new.updated_at := now();
  new.version := 1;
  return new;
end
$$;

-- 修改時：
-- * 前端必須送上原本讀到的 version；和資料庫不同 → 代表別人已經改過 → 拒絕（版本衝突）。
-- * id、household_id、建立者、建立時間不允許被修改。
create or replace function public.tg_stamp_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.version is distinct from old.version then
    raise exception 'VERSION_CONFLICT: 這筆資料已被其他人修改（目前版本 %，你的版本 %）', old.version, new.version
      using errcode = 'P0409', hint = 'reload';
  end if;
  if new.id is distinct from old.id then
    raise exception '不允許修改 id' using errcode = 'P0403';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end
$$;

create trigger households_stamp_insert before insert on public.households
  for each row execute function public.tg_stamp_insert();
create trigger households_stamp_update before update on public.households
  for each row execute function public.tg_stamp_update();

-- -----------------------------------------------------------------------------
-- 修改紀錄（只能由觸發器寫入，任何人都不能修改或刪除）
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index audit_logs_household_time on public.audit_logs (household_id, changed_at desc);
create index audit_logs_record on public.audit_logs (record_id);

create or replace function public.tg_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (household_id, table_name, record_id, action, changed_by, old_data, new_data)
  values (
    (rec ->> 'household_id')::uuid,
    tg_table_name,
    (rec ->> 'id')::uuid,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end
$$;

-- -----------------------------------------------------------------------------
-- 旅行資料
-- -----------------------------------------------------------------------------

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  year integer not null check (year between 1990 and 2200),
  start_date date,
  end_date date,
  destination text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  -- 讓子資料可以用 (trip_id, household_id) 確認「旅行屬於同一個家庭」
  unique (id, household_id),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index trips_household on public.trips (household_id, year desc);

create table public.flights (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  trip_id uuid not null,
  airline text not null default '',
  flight_number text not null default '',
  depart_at timestamp, -- 當地時間，不換算時區
  depart_airport text not null default '',
  depart_terminal text not null default '',
  arrive_at timestamp,
  arrive_airport text not null default '',
  arrive_terminal text not null default '',
  booking_info text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade
);
create index flights_trip on public.flights (trip_id);

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  trip_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  address text not null default '',
  phone text not null default '',
  check_in date,
  check_out date,
  booking_number text not null default '', -- 私人資料：只有家庭成員能讀
  room_type text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade,
  check (check_out is null or check_in is null or check_out >= check_in)
);
create index hotels_trip on public.hotels (trip_id);

create table public.itinerary_days (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  trip_id uuid not null,
  day_date date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade,
  unique (trip_id, day_date),
  unique (id, trip_id)
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  trip_id uuid not null,
  -- 前端只要填 day_date；day_id 由觸發器自動找到（或建立）對應的「那一天」
  day_id uuid,
  day_date date not null,
  start_time time,
  title text not null check (char_length(title) between 1 and 200),
  address text not null default '',
  transport text not null default '',
  duration text not null default '',
  food_shopping text not null default '',
  notes text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade,
  foreign key (day_id, trip_id) references public.itinerary_days (id, trip_id) on delete cascade
);
create index itinerary_items_trip on public.itinerary_items (trip_id, day_date, sort_order);

create or replace function public.tg_itinerary_item_day()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  insert into public.itinerary_days (household_id, trip_id, day_date)
  values (new.household_id, new.trip_id, new.day_date)
  on conflict (trip_id, day_date) do nothing;
  select id into new.day_id from public.itinerary_days
  where trip_id = new.trip_id and day_date = new.day_date;
  return new;
end
$$;

-- 景點及餐廳（原本的「旅遊功課」）
create table public.places (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  trip_id uuid not null,
  category text not null default 'other'
    check (category in ('sight', 'food', 'shopping', 'transport', 'tips', 'other')),
  title text not null check (char_length(title) between 1 and 200),
  address text not null default '',
  url text not null default '',
  content text not null default '',
  priority smallint not null default 0 check (priority between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade
);
create index places_trip on public.places (trip_id);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  trip_id uuid not null,
  category text not null default 'other'
    check (category in ('flight', 'hotel', 'documents', 'network', 'luggage', 'other')),
  title text not null check (char_length(title) between 1 and 200),
  done boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade
);
create index todos_trip on public.todos (trip_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  trip_id uuid not null,
  category text not null default 'other'
    check (category in ('flight', 'hotel', 'transport', 'food', 'shopping', 'tickets', 'other')),
  name text not null check (char_length(name) between 1 and 200),
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
  spent_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade
);
create index expenses_trip on public.expenses (trip_id);

create trigger itinerary_items_day before insert or update of day_date, trip_id on public.itinerary_items
  for each row execute function public.tg_itinerary_item_day();

-- 每張資料表都裝上：時間／操作者／版本觸發器、修改紀錄觸發器、RLS 權限
do $$
declare
  t text;
begin
  foreach t in array array['trips', 'flights', 'hotels', 'itinerary_days', 'itinerary_items', 'places', 'todos', 'expenses']
  loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.tg_stamp_insert()', t || '_stamp_insert', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.tg_stamp_update()', t || '_stamp_update', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit()', t || '_audit', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_household_member(household_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_household_member(household_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_household_member(household_id))', t || '_delete', t);

    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- 子資料不能被搬到另一個家庭（household_id 跟著旅行，不能修改）
create or replace function public.tg_lock_household()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception '不允許把資料搬到其他家庭' using errcode = 'P0403';
  end if;
  return new;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['households', 'trips', 'flights', 'hotels', 'itinerary_days', 'itinerary_items', 'places', 'todos', 'expenses']
  loop
    if t <> 'households' then
      execute format('create trigger %I before update on public.%I for each row execute function public.tg_lock_household()', t || '_lock_household', t);
    end if;
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 家庭、成員、邀請、修改紀錄的權限
-- -----------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.audit_logs enable row level security;

create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_household_owner(id)) with check (public.is_household_owner(id));
-- 不建立 insert / delete 規則：家庭只能透過 create_household() 建立，且不能從網頁刪除

create policy household_members_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id));
-- 成員只能透過下方的函式加入、移除

create policy household_invites_select on public.household_invites for select to authenticated
  using (public.is_household_owner(household_id));

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_household_member(household_id));
-- 沒有 insert / update / delete 規則：修改紀錄只能由觸發器寫入

revoke all on public.households, public.household_members, public.household_invites, public.audit_logs from anon, public;
grant select, update on public.households to authenticated;
grant select on public.household_members, public.household_invites, public.audit_logs to authenticated;

-- -----------------------------------------------------------------------------
-- 受控的操作（RPC）：只能透過這些函式建立家庭、邀請、加入、移除成員
-- -----------------------------------------------------------------------------

-- 第一個帳號建立家庭，自己成為管理者（owner）。已經屬於某個家庭的人不能再建立。
create or replace function public.create_household(household_name text, my_display_name text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception '請先登入' using errcode = 'P0401';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception '你已經屬於一個家庭工作區' using errcode = 'P0409';
  end if;
  insert into public.households (name) values (household_name) returning id into hid;
  insert into public.household_members (household_id, user_id, role, display_name, email)
  values (hid, auth.uid(), 'owner', coalesce(my_display_name, ''), coalesce(lower(auth.jwt() ->> 'email'), ''));
  return hid;
end
$$;

-- 管理者用 Email 邀請家人。對方必須用同一個 Email 的帳號登入才能加入。
create or replace function public.invite_member(invite_email text, invite_display_name text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  hid uuid := public.my_household_id();
  iid uuid;
begin
  if hid is null or not public.is_household_owner(hid) then
    raise exception '只有家庭管理者可以邀請成員' using errcode = 'P0403';
  end if;
  delete from public.household_invites
  where email = lower(trim(invite_email)) and accepted_at is null and household_id = hid;
  insert into public.household_invites (household_id, email, display_name)
  values (hid, lower(trim(invite_email)), coalesce(invite_display_name, ''))
  returning id into iid;
  return iid;
end
$$;

-- 被邀請的人登入後呼叫：如果有寄給自己 Email 的有效邀請，就加入該家庭。
create or replace function public.accept_invite()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.household_invites;
  my_email text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or my_email is null then
    raise exception '請先登入' using errcode = 'P0401';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    return public.my_household_id();
  end if;
  select * into inv from public.household_invites
  where email = my_email and accepted_at is null and expires_at > now()
  order by created_at desc limit 1;
  if inv.id is null then
    return null;
  end if;
  insert into public.household_members (household_id, user_id, role, display_name, email)
  values (inv.household_id, auth.uid(), 'member', inv.display_name, my_email);
  update public.household_invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.household_id;
end
$$;

create or replace function public.cancel_invite(invite_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.household_invites
  where id = invite_id and accepted_at is null and public.is_household_owner(household_id);
end
$$;

-- 管理者移除成員（不能移除自己，避免家庭沒有管理者）
create or replace function public.remove_member(member_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  hid uuid := public.my_household_id();
begin
  if hid is null or not public.is_household_owner(hid) then
    raise exception '只有家庭管理者可以移除成員' using errcode = 'P0403';
  end if;
  if member_user_id = auth.uid() then
    raise exception '不能移除自己' using errcode = 'P0403';
  end if;
  delete from public.household_members where household_id = hid and user_id = member_user_id;
end
$$;

-- 修改自己的顯示名稱（例如「兔兔」「先生」），用來顯示「最後更新者」
create or replace function public.set_my_display_name(new_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.household_members set display_name = left(coalesce(new_name, ''), 50)
  where user_id = auth.uid();
end
$$;

revoke execute on function
  public.create_household(text, text), public.invite_member(text, text), public.accept_invite(),
  public.cancel_invite(uuid), public.remove_member(uuid), public.set_my_display_name(text),
  public.my_household_id(), public.is_household_member(uuid), public.is_household_owner(uuid)
  from anon, public;
grant execute on function
  public.create_household(text, text), public.invite_member(text, text), public.accept_invite(),
  public.cancel_invite(uuid), public.remove_member(uuid), public.set_my_display_name(text),
  public.my_household_id(), public.is_household_member(uuid), public.is_household_owner(uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 即時同步：把資料表加入 Supabase Realtime（Realtime 也會依照上面的 RLS 過濾）
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.trips, public.flights, public.hotels, public.itinerary_days, public.itinerary_items,
  public.places, public.todos, public.expenses, public.household_members;
