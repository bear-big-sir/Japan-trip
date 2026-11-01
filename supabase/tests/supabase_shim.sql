-- 只在本機測試用：模擬 Supabase 內建的角色、auth 結構與 Realtime publication。
-- 真正的 Supabase 已經有這些東西，不要在 Supabase 上執行這個檔案。
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
create publication supabase_realtime;
