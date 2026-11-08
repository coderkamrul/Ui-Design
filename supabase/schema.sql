-- canvas-tool — Supabase schema
-- =====================================================================
-- Paste this whole file into the Supabase SQL editor (Dashboard →
-- SQL Editor → New query) and run it once after creating the project.
-- It is written to be safe to re-run: tables/policies use
-- "if not exists" / drop-then-create where Postgres requires it.
--
-- What it creates:
--   public.files          one row per design file; the document is a
--                         jsonb column, its version history (M7) is a
--                         second jsonb column, and dashboard metadata
--                         is denormalised onto the row (see
--                         lib/rows.js)
--   storage bucket        "assets" (public) for image uploads, with
--                         owner-folder write policies
--   RLS                   owner-only access to files: a signed-in user
--                         can read/write exactly their own rows
--                         (auth.uid() = owner_id). Share settings are
--                         stored as metadata only for now — there is
--                         deliberately NO public/link access policy;
--                         link enforcement is a later design step.
-- =====================================================================

-- ---------------------------------------------------------------------
-- files table
-- ---------------------------------------------------------------------
create table if not exists public.files (
  id          text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  doc         jsonb not null,
  versions    jsonb not null default '[]'::jsonb,
  share       jsonb not null default '{"access":"anyone","permission":"edit"}'::jsonb,
  archived    boolean not null default false,
  swatch      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- M7 migration for EXISTING projects (created before version history):
-- fresh installs already have the column from the CREATE TABLE above.
-- Safe to re-run — "if not exists" makes it a no-op the second time.
alter table public.files
  add column if not exists versions jsonb not null default '[]'::jsonb;

create index if not exists files_owner_id_idx on public.files (owner_id);
create index if not exists files_owner_updated_idx
  on public.files (owner_id, updated_at desc);

-- Keep updated_at current on every update, even if a client forgets.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists files_touch_updated_at on public.files;
create trigger files_touch_updated_at
  before update on public.files
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security — owner-scoped with link sharing
-- ---------------------------------------------------------------------
alter table public.files enable row level security;

drop policy if exists "files: owner can read"   on public.files;
drop policy if exists "files: owner can insert" on public.files;
drop policy if exists "files: owner can update" on public.files;
drop policy if exists "files: owner can delete" on public.files;
drop policy if exists "files: owner or shared read" on public.files;

-- Allow reading files owned by the user, or files shared with 'anyone'
create policy "files: owner or shared read"
  on public.files for select
  using (
    auth.uid() = owner_id
    or (share->>'access') = 'anyone'
  );

create policy "files: owner can insert"
  on public.files for insert
  with check (auth.uid() = owner_id);

create policy "files: owner can update"
  on public.files for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "files: owner can delete"
  on public.files for delete
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------
-- Storage: the "assets" bucket for image uploads
-- ---------------------------------------------------------------------
-- lib/images.js uploads to  assets/<userId>/<assetId>.<ext>  and stores
-- the public URL in the document. The bucket is public for READS (the
-- URLs are capability URLs — unguessable asset ids), while writes are
-- restricted to each user's own folder by the policies below.
insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do nothing;

drop policy if exists "assets: public read"        on storage.objects;
drop policy if exists "assets: owner can upload"   on storage.objects;
drop policy if exists "assets: owner can update"   on storage.objects;
drop policy if exists "assets: owner can delete"   on storage.objects;

create policy "assets: public read"
  on storage.objects for select
  using (bucket_id = 'assets');

create policy "assets: owner can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "assets: owner can update"
  on storage.objects for update
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "assets: owner can delete"
  on storage.objects for delete
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
