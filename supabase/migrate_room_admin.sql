-- ============================================================
-- 旅行记忆 · 房间成员管理（增量迁移）
-- 已建过站点的项目在 Supabase SQL Editor 里跑一次即可
-- ============================================================

-- 转让房主：把 rooms.owner_id 改成指定成员。
-- 为什么不直接在客户端 update rooms？
--   rooms_update_owner 策略是 using(is_room_owner(id))，Postgres 对 UPDATE
--   会把 using 表达式同时当作 with check，改完 owner_id 之后新行就不再满足
--   「我是房主」，整条更新会被拒绝。所以必须用 security definer 的函数，
--   在函数内先校验「调用者确实是当前房主、目标确实是本房间成员」。
create or replace function public.transfer_room_ownership(p_room_id uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  -- 调用者必须是现任房主
  if not exists (select 1 from rooms where id = p_room_id and owner_id = auth.uid()) then
    raise exception '只有房主可以转让房间';
  end if;

  -- 目标必须是本房间成员，且不能是自己（自己转让给自己无意义）
  if not exists (select 1 from room_members where room_id = p_room_id and user_id = p_new_owner) then
    raise exception '该用户不在房间里';
  end if;
  if p_new_owner = auth.uid() then
    raise exception '你已经是房主了';
  end if;

  update rooms set owner_id = p_new_owner where id = p_room_id;
end $$;

-- 成员列表：只返回本房间成员。成员可读自己的房间，复用现有 RLS 即可，
-- 这里额外提供 display_name 的兜底（老数据可能为空）。
create or replace function public.room_members_of(p_room_id uuid)
returns table(user_id uuid, display_name text, joined_at timestamptz, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id,
         coalesce(nullif(m.display_name, ''), '成员'),
         m.joined_at,
         (r.owner_id = m.user_id)
  from room_members m
  join rooms r on r.id = m.room_id
  where m.room_id = p_room_id
    and public.is_room_member(p_room_id)   -- 只有本房间成员能看
  order by (r.owner_id = m.user_id) desc, m.joined_at asc;
$$;
