create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  education_level text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  parent_folder_id uuid references public.folders(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null,
  original_filename text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint,
  extracted_text text,
  user_notes text,
  processing_status text not null default 'uploaded',
  completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  last_opened_at timestamptz
);

create table if not exists public.document_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  title text,
  content text not null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question text not null,
  answer text not null,
  difficulty text,
  status text not null default 'unseen',
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.feynman_sessions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null,
  status text not null default 'active',
  completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  started_at timestamptz not null default timezone('utc'::text, now()),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.feynman_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.feynman_sessions(id) on delete cascade,
  role text not null check (role in ('ai', 'user', 'system')),
  content text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.feynman_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.feynman_sessions(id) on delete cascade,
  overall_score integer not null check (overall_score between 0 and 100),
  concept_accuracy integer not null check (concept_accuracy between 0 and 100),
  clarity integer not null check (clarity between 0 and 100),
  completeness integer not null check (completeness between 0 and 100),
  teaching_ability integer not null check (teaching_ability between 0 and 100),
  strengths text[] not null default '{}',
  improvement_points text[] not null default '{}',
  ai_feedback text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.progress_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  stat_date date not null,
  study_minutes integer not null default 0,
  mastery_score integer not null default 0 check (mastery_score between 0 and 100),
  flashcards_known integer not null default 0,
  flashcards_difficult integer not null default 0,
  feynman_score integer check (feynman_score between 0 and 100),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.recent_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  session_id uuid references public.feynman_sessions(id) on delete cascade,
  activity_type text not null,
  title text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists folders_user_id_idx on public.folders(user_id);
create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_folder_id_idx on public.documents(folder_id);
create index if not exists document_sections_document_id_idx on public.document_sections(document_id);
create index if not exists flashcards_document_id_idx on public.flashcards(document_id);
create index if not exists flashcards_user_id_idx on public.flashcards(user_id);
create index if not exists feynman_sessions_document_id_idx on public.feynman_sessions(document_id);
create index if not exists feynman_sessions_user_id_idx on public.feynman_sessions(user_id);
create index if not exists feynman_messages_session_id_idx on public.feynman_messages(session_id);
create index if not exists progress_stats_user_id_idx on public.progress_stats(user_id);
create index if not exists progress_stats_document_id_idx on public.progress_stats(document_id);
create index if not exists recent_activity_user_id_idx on public.recent_activity(user_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_folders_updated_at on public.folders;
create trigger set_folders_updated_at
before update on public.folders
for each row
execute function public.set_updated_at();

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row
execute function public.set_updated_at();

drop trigger if exists set_flashcards_updated_at on public.flashcards;
create trigger set_flashcards_updated_at
before update on public.flashcards
for each row
execute function public.set_updated_at();

drop trigger if exists set_feynman_sessions_updated_at on public.feynman_sessions;
create trigger set_feynman_sessions_updated_at
before update on public.feynman_sessions
for each row
execute function public.set_updated_at();

drop trigger if exists set_progress_stats_updated_at on public.progress_stats;
create trigger set_progress_stats_updated_at
before update on public.progress_stats
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = timezone('utc'::text, now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_sections enable row level security;
alter table public.flashcards enable row level security;
alter table public.feynman_sessions enable row level security;
alter table public.feynman_messages enable row level security;
alter table public.feynman_results enable row level security;
alter table public.progress_stats enable row level security;
alter table public.recent_activity enable row level security;

drop policy if exists "Users can manage their own profile" on public.profiles;
create policy "Users can manage their own profile"
on public.profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can manage their own folders" on public.folders;
create policy "Users can manage their own folders"
on public.folders
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own documents" on public.documents;
create policy "Users can manage their own documents"
on public.documents
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage sections for their own documents" on public.document_sections;
create policy "Users can manage sections for their own documents"
on public.document_sections
for all
using (
  exists (
    select 1
    from public.documents
    where public.documents.id = public.document_sections.document_id
      and public.documents.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.documents
    where public.documents.id = public.document_sections.document_id
      and public.documents.user_id = auth.uid()
  )
);

drop policy if exists "Users can manage their own flashcards" on public.flashcards;
create policy "Users can manage their own flashcards"
on public.flashcards
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own feynman sessions" on public.feynman_sessions;
create policy "Users can manage their own feynman sessions"
on public.feynman_sessions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage messages for their own sessions" on public.feynman_messages;
create policy "Users can manage messages for their own sessions"
on public.feynman_messages
for all
using (
  exists (
    select 1
    from public.feynman_sessions
    where public.feynman_sessions.id = public.feynman_messages.session_id
      and public.feynman_sessions.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.feynman_sessions
    where public.feynman_sessions.id = public.feynman_messages.session_id
      and public.feynman_sessions.user_id = auth.uid()
  )
);

drop policy if exists "Users can manage results for their own sessions" on public.feynman_results;
create policy "Users can manage results for their own sessions"
on public.feynman_results
for all
using (
  exists (
    select 1
    from public.feynman_sessions
    where public.feynman_sessions.id = public.feynman_results.session_id
      and public.feynman_sessions.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.feynman_sessions
    where public.feynman_sessions.id = public.feynman_results.session_id
      and public.feynman_sessions.user_id = auth.uid()
  )
);

drop policy if exists "Users can manage their own progress stats" on public.progress_stats;
create policy "Users can manage their own progress stats"
on public.progress_stats
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own recent activity" on public.recent_activity;
create policy "Users can manage their own recent activity"
on public.recent_activity
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Users can upload their own documents" on storage.objects;
create policy "Users can upload their own documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can read their own documents" on storage.objects;
create policy "Users can read their own documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update their own documents" on storage.objects;
create policy "Users can update their own documents"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete their own documents" on storage.objects;
create policy "Users can delete their own documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);
