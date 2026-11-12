-- ============================================================
-- 迁移：为已有项目添加「实况照片」支持
-- 只对「之前已经跑过 schema.sql」的 Supabase 项目执行一次。
-- 全新项目直接跑 schema.sql 即可，不需要这个文件。
-- ============================================================

-- 1) photos 表新增视频路径列（空字符串 = 普通照片）
alter table public.photos
  add column if not exists video_path text not null default '';

-- 2) 允许往 room-photos 桶上传视频（原策略只放行 .jpg）
drop policy if exists "rp_insert" on storage.objects;
create policy "rp_insert" on storage.objects for insert
  with check (bucket_id = 'room-photos' and public.is_room_member(((storage.foldername(name))[1])::uuid)
              and (name like '%.jpg' or name like '%.mp4' or name like '%.mov' or name like '%.webm'));

-- 3) 注销账号时一并删除实况视频文件（原函数只删了 storage_path）
create or replace function public.delete_own_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  paths text[];
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select coalesce(array_agg(p), '{}') into paths
    from (
      select storage_path as p from photos where uploader_id = uid
      union all
      select video_path from photos where uploader_id = uid and video_path <> ''
    ) t;
  if cardinality(paths) > 0 then
    delete from storage.objects
     where bucket_id = 'room-photos' and name = any(paths);
  end if;
  delete from photos where uploader_id = uid;
  delete from room_members where user_id = uid;
  delete from auth.users where id = uid;
end $$;
