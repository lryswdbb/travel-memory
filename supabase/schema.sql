-- ============================================================
-- 旅行记忆 · 云端房间 数据库结构
-- 在 Supabase Dashboard → SQL Editor 中整体粘贴运行一次
-- ============================================================

-- ============ 表 ============
create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  salt       text not null,                    -- 16 字节随机盐（hex），仅用于让相同密码在不同房间哈希不同
  pass_hash  text not null,                    -- sha256(salt + password) 的 hex，只在 RPC 内比对
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.room_members (
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  joined_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index on public.room_members (user_id);

create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  loc_key       text not null,                 -- 与本地一致的地点 key：world:.. | cn_prov:.. | cn:adcode:.. | us_state:.. | us:..
  uploader_id   uuid not null default auth.uid(),
  uploader_name text not null default '',
  cap           text not null default '',
  shoot_date    text not null default '',      -- 'YYYY-MM-DD' 或 ''
  ts            bigint not null default (extract(epoch from now()) * 1000)::bigint,
  storage_path  text not null,                 -- '<room_id>/<photo_id>.jpg'
  created_at    timestamptz not null default now()
);
create index on public.photos (room_id, loc_key);

-- ============ 辅助函数：成员/房主判定（供 RLS 与 Storage 策略使用） ============
-- 放在建表之后；用 plpgsql 而非 language sql —— 后者创建时即解析函数体，
-- 表还不存在会报 42P01 relation "room_members" does not exist
create or replace function public.is_room_member(rid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from room_members where room_id = rid and user_id = auth.uid());
end $$;

create or replace function public.is_room_owner(rid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from rooms where id = rid and owner_id = auth.uid());
end $$;

-- ============ 行级安全（RLS） ============
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.photos enable row level security;

-- rooms：仅成员可读（pass_hash 客户端永不查询，比对在 RPC 内完成）；房主可改/删
create policy "rooms_select" on public.rooms for select
  using (public.is_room_member(id));
create policy "rooms_update_owner" on public.rooms for update
  using (public.is_room_owner(id));
create policy "rooms_delete_owner" on public.rooms for delete
  using (public.is_room_owner(id));

-- room_members：成员或本人可读；本人退出 / 房主踢人可删（插入只发生在 RPC 内）
create policy "members_select" on public.room_members for select
  using (public.is_room_member(room_id) or user_id = auth.uid());
create policy "members_delete_self" on public.room_members for delete
  using (user_id = auth.uid() or public.is_room_owner(room_id));

-- photos：成员可读；成员可往自己所在房间插入（且只能署自己名）；改/删 = 上传者本人或房主
create policy "photos_select" on public.photos for select
  using (public.is_room_member(room_id));
create policy "photos_insert" on public.photos for insert
  with check (public.is_room_member(room_id) and uploader_id = auth.uid());
create policy "photos_update" on public.photos for update
  using (uploader_id = auth.uid() or public.is_room_owner(room_id));
create policy "photos_delete" on public.photos for delete
  using (uploader_id = auth.uid() or public.is_room_owner(room_id));

-- ============ RPC（密码只在服务端比对，明文/哈希都不暴露） ============

-- 创建房间（同时把创建者加为成员）
create or replace function public.create_room(p_name text, p_salt text, p_hash text, p_display text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into rooms(name, salt, pass_hash, owner_id)
    values (p_name, p_salt, p_hash, auth.uid()) returning id into rid;
  insert into room_members(room_id, user_id, display_name)
    values (rid, auth.uid(), coalesce(p_display, ''));
  return rid;
end $$;

-- 取房间盐（盐不是秘密；哈希才是凭据且永不可读）
create or replace function public.room_salt(p_room_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select salt from rooms where id = p_room_id;
$$;

-- 用密码哈希加入房间；密码错误返回 false
create or replace function public.join_room(p_room_id uuid, p_hash text, p_display text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if public.is_room_member(p_room_id) then return true; end if;
  if not exists (select 1 from rooms where id = p_room_id and pass_hash = p_hash) then
    return false;
  end if;
  insert into room_members(room_id, user_id, display_name)
    values (p_room_id, auth.uid(), coalesce(p_display, ''))
    on conflict do nothing;
  return true;
end $$;

-- 房间目录：仅暴露 id + 名称 + 人数（进房仍需密码）
create or replace function public.search_rooms(p_q text default '')
returns table(id uuid, name text, member_count int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.name,
         (select count(*)::int from room_members m where m.room_id = r.id),
         r.created_at
  from rooms r
  where p_q = '' or r.name ilike '%' || p_q || '%'
  order by r.created_at desc limit 50;
$$;

-- ============ Realtime（房间内照片实时同步） ============
alter publication supabase_realtime add table public.photos;

-- ============ Storage：私有桶 + 策略（路径 <room_id>/<photo_id>.jpg） ============
insert into storage.buckets (id, name, public) values ('room-photos', 'room-photos', false)
on conflict (id) do nothing;

create policy "rp_select" on storage.objects for select
  using (bucket_id = 'room-photos' and public.is_room_member(((storage.foldername(name))[1])::uuid));
-- 注意：storage.foldername() 只含文件夹段、不含文件名，
-- <room_id>/<photo_id>.jpg 的 [2] 是 NULL，不能用它判断扩展名，须直接检查 name
create policy "rp_insert" on storage.objects for insert
  with check (bucket_id = 'room-photos' and public.is_room_member(((storage.foldername(name))[1])::uuid)
              and name like '%.jpg');
create policy "rp_delete" on storage.objects for delete
  using (bucket_id = 'room-photos' and public.is_room_member(((storage.foldername(name))[1])::uuid)
         and (owner::text = auth.uid()::text or public.is_room_owner(((storage.foldername(name))[1])::uuid)));
