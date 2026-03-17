alter table public.feynman_sessions
add column if not exists session_summary text;

create index if not exists feynman_sessions_status_idx
on public.feynman_sessions(user_id, document_id, status, created_at desc);
