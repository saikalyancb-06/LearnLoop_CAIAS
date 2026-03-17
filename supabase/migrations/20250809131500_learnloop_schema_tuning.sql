create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create index if not exists folders_parent_folder_id_idx on public.folders(parent_folder_id);
create index if not exists recent_activity_document_id_idx on public.recent_activity(document_id);
create index if not exists recent_activity_session_id_idx on public.recent_activity(session_id);

drop policy if exists "Users can manage their own profile" on public.profiles;
create policy "Users can manage their own profile"
on public.profiles
for all
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Users can manage their own folders" on public.folders;
create policy "Users can manage their own folders"
on public.folders
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own documents" on public.documents;
create policy "Users can manage their own documents"
on public.documents
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage sections for their own documents" on public.document_sections;
create policy "Users can manage sections for their own documents"
on public.document_sections
for all
using (
  exists (
    select 1
    from public.documents
    where public.documents.id = public.document_sections.document_id
      and public.documents.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.documents
    where public.documents.id = public.document_sections.document_id
      and public.documents.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can manage their own flashcards" on public.flashcards;
create policy "Users can manage their own flashcards"
on public.flashcards
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own feynman sessions" on public.feynman_sessions;
create policy "Users can manage their own feynman sessions"
on public.feynman_sessions
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage messages for their own sessions" on public.feynman_messages;
create policy "Users can manage messages for their own sessions"
on public.feynman_messages
for all
using (
  exists (
    select 1
    from public.feynman_sessions
    where public.feynman_sessions.id = public.feynman_messages.session_id
      and public.feynman_sessions.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.feynman_sessions
    where public.feynman_sessions.id = public.feynman_messages.session_id
      and public.feynman_sessions.user_id = (select auth.uid())
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
      and public.feynman_sessions.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.feynman_sessions
    where public.feynman_sessions.id = public.feynman_results.session_id
      and public.feynman_sessions.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can manage their own progress stats" on public.progress_stats;
create policy "Users can manage their own progress stats"
on public.progress_stats
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own recent activity" on public.recent_activity;
create policy "Users can manage their own recent activity"
on public.recent_activity
for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
