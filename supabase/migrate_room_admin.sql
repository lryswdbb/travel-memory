-- ============================================================
-- Room member management (incremental migration)
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- Keep this file ASCII-only, no inline Chinese comments.
-- Reason: pasting a comment-heavy version into the SQL Editor
-- on Windows dropped a line and produced
--   ERROR 42601: syntax error at or near "returns"
-- because the `create or replace function ...` line was lost
-- during clipboard transfer. Plain ASCII pastes reliably.
-- ============================================================

-- Transfer room ownership.
--
-- Why not just `update rooms set owner_id = ...` from the client?
-- The RLS policy rooms_update_owner uses using(is_room_owner(id)),
-- and Postgres reuses the USING expression as an implicit WITH CHECK
-- for UPDATE. After changing owner_id the new row no longer satisfies
-- "I am the owner", so the whole update is rejected. Hence a
-- SECURITY DEFINER function that validates the caller up front.
create or replace function public.transfer_room_ownership(p_room_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from rooms where id = p_room_id and owner_id = auth.uid()
  ) then
    raise exception 'only the room owner can transfer ownership';
  end if;

  if not exists (
    select 1 from room_members where room_id = p_room_id and user_id = p_new_owner
  ) then
    raise exception 'target user is not a member of this room';
  end if;

  if p_new_owner = auth.uid() then
    raise exception 'you are already the owner';
  end if;

  update rooms set owner_id = p_new_owner where id = p_room_id;
end;
$fn$;

-- Member list for a room: owner first, then by join time.
-- Only members of the room can read it (see the is_room_member guard).
create or replace function public.room_members_of(p_room_id uuid)
returns table(user_id uuid, display_name text, joined_at timestamptz, is_owner boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    m.user_id,
    coalesce(nullif(m.display_name, ''), 'member'),
    m.joined_at,
    (r.owner_id = m.user_id)
  from room_members m
  join rooms r on r.id = m.room_id
  where m.room_id = p_room_id
    and public.is_room_member(p_room_id)
  order by (r.owner_id = m.user_id) desc, m.joined_at asc;
$fn$;
