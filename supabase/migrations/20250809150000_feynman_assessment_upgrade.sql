alter table if exists public.feynman_sessions
  add column if not exists target_question_count integer not null default 5,
  add column if not exists current_question_count integer not null default 0,
  add column if not exists extra_follow_up_count integer not null default 0;

alter table if exists public.feynman_results
  add column if not exists misconceptions text[] not null default '{}',
  add column if not exists knowledge_rating text;

update public.feynman_sessions
set target_question_count = greatest(5, coalesce(target_question_count, 5)),
    current_question_count = coalesce(current_question_count, 0),
    extra_follow_up_count = coalesce(extra_follow_up_count, 0);

update public.feynman_results
set misconceptions = coalesce(misconceptions, '{}'),
    knowledge_rating = coalesce(
      knowledge_rating,
      case
        when overall_score >= 85 then 'Advanced'
        when overall_score >= 70 then 'Proficient'
        when overall_score >= 50 then 'Developing'
        else 'Foundational'
      end
    );
