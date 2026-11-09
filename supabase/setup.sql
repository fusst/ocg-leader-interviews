create extension if not exists pgcrypto;

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role text not null default 'interviewer',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_applications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  requested_at timestamptz not null default now()
);

drop trigger if exists staff_members_audit_change on public.staff_members;
alter table public.staff_members drop constraint if exists staff_members_role_check;
update public.staff_members
set role = case role
  when 'admin' then 'sc_crime'
  when 'sc_crime' then 'sc_crime'
  when 'dep_sc_crime' then 'dep_sc_crime'
  else 'interviewer'
end;
alter table public.staff_members
  add constraint staff_members_role_check
  check (role in ('sc_crime', 'dep_sc_crime', 'interviewer'));

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  discord text not null check (length(btrim(discord)) between 1 and 100),
  target_ocgs text[] not null check (
    cardinality(target_ocgs) between 1 and 4
    and target_ocgs <@ array['Tambov', 'Kurgan', 'Orekhov', 'Caucasian']::text[]
  ),
  interviewer text not null default 'Not started' check (length(btrim(interviewer)) between 1 and 100),
  status text not null default 'Pending' check (
    status in ('Pending', 'In Progress', 'Passed', 'Borderline', 'Failed', 'Disqualified', 'Did Not Attend (DNA)')
  ),
  focus_warnings integer not null default 0 check (focus_warnings >= 0),
  cycle_date date not null default current_date,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.candidates add column if not exists interviewer text not null default 'Not started';
alter table public.candidates add column if not exists focus_warnings integer not null default 0;
alter table public.candidates add column if not exists cycle_date date not null default current_date;
alter table public.candidates add column if not exists updated_at timestamptz not null default now();
alter table public.candidates drop constraint if exists candidates_status_check;
alter table public.candidates
  add constraint candidates_status_check
  check (status in ('Pending', 'In Progress', 'Passed', 'Borderline', 'Failed', 'Disqualified', 'Did Not Attend (DNA)'));

create table if not exists public.candidate_results (
  candidate_id uuid primary key references public.candidates (id) on delete cascade,
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  private_notes text not null default '' check (length(private_notes) <= 5000),
  updated_at timestamptz not null default now()
);
alter table public.candidate_results drop column if exists score_percent;

drop trigger if exists candidates_guard_interviewer_update on public.candidates;
drop trigger if exists candidates_set_interviewer_name on public.candidates;
drop trigger if exists candidates_audit_change on public.candidates;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'candidates' and column_name = 'scores'
  ) then
    execute $migration$
      insert into public.candidate_results (candidate_id, scores)
      select c.id,
        coalesce(c.scores, '{}'::jsonb)
      from public.candidates c
      on conflict (candidate_id) do nothing
    $migration$;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'candidates' and column_name = 'notes'
  ) then
    execute $migration$
      update public.candidate_results r
      set private_notes = c.notes
      from public.candidates c
      where r.candidate_id = c.id and r.private_notes = '' and c.notes <> ''
    $migration$;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'candidates' and column_name = 'assigned_interviewer'
  ) then
    execute $migration$
      update public.candidates
      set interviewer = 'Not started'
      where assigned_interviewer is not null
    $migration$;
  end if;
end;
$$;

update public.candidate_results results
set scores = (
  select coalesce(jsonb_object_agg(entry.key,
    case when entry.value = '"SKIP"'::jsonb then '0'::jsonb else entry.value end), '{}'::jsonb)
  from jsonb_each(results.scores) as entry(key, value)
);

update public.candidates candidate
set status = case
  when evaluated.total_points >= 11.25 then 'Passed'
  when evaluated.total_points >= 9 then 'Borderline'
  else 'Failed'
end
from (
  select results.candidate_id,
    coalesce(sum(case
      when jsonb_typeof(mark.value) = 'number' then (mark.value #>> '{}')::numeric
      else 0
    end), 0) as total_points
  from public.candidate_results results
  cross join lateral jsonb_each(results.scores) as mark(key, value)
  group by results.candidate_id
) evaluated
where candidate.id = evaluated.candidate_id
  and candidate.status in ('Passed', 'Borderline', 'Failed');

drop trigger if exists candidates_guard_interviewer_update on public.candidates;
drop trigger if exists candidates_set_interviewer_name on public.candidates;
drop trigger if exists candidates_audit_change on public.candidates;
drop function if exists public.guard_interviewer_candidate_update();
drop function if exists public.set_candidate_interviewer_name();
drop policy if exists "Staff can read candidates" on public.candidates;
drop policy if exists "Staff can add candidates as themselves" on public.candidates;
drop policy if exists "Staff can update candidates" on public.candidates;
drop policy if exists "Admins can delete candidates" on public.candidates;
drop policy if exists "Managers and assigned interviewers can read candidates" on public.candidates;
drop policy if exists "Candidate managers can add candidates" on public.candidates;
drop policy if exists "Candidate managers can update candidates" on public.candidates;
drop policy if exists "Assigned interviewers can update assigned candidates" on public.candidates;
drop policy if exists "Senior authorities can delete candidates" on public.candidates;
alter table public.candidates drop column if exists assigned_interviewer;
alter table public.candidates drop column if exists scores;
alter table public.candidates drop column if exists notes;
drop function if exists public.valid_candidate_scores(jsonb);

create index if not exists candidates_created_at_idx on public.candidates (created_at desc);
create index if not exists candidates_cycle_date_idx on public.candidates (cycle_date);
create index if not exists candidates_status_idx on public.candidates (status);
create index if not exists candidates_target_ocgs_idx on public.candidates using gin (target_ocgs);

create table if not exists public.question_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 500),
  active boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.question_batches (id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) between 1 and 2000),
  reference_answer text not null check (length(btrim(reference_answer)) between 1 and 5000),
  sort_order integer not null check (sort_order between 1 and 15),
  unique (batch_id, sort_order)
);

create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  interviewer_id uuid not null references public.staff_members (user_id),
  question_ids uuid[] not null check (cardinality(question_ids) = 15),
  current_question_number integer not null default 1 check (current_question_number between 1 and 15),
  focus_warnings integer not null default 0 check (focus_warnings >= 0),
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists interview_sessions_one_active_candidate_idx
  on public.interview_sessions (candidate_id) where status = 'active';
create index if not exists interview_sessions_interviewer_idx
  on public.interview_sessions (interviewer_id, started_at desc);

create table if not exists public.candidate_answers (
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  question_id uuid not null references public.interview_questions (id),
  response text not null default '' check (length(response) <= 5000),
  score_mark text check (score_mark is null or score_mark in ('0', '0.5', '1', 'SKIP')),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_name text not null,
  actor_role text not null,
  page text not null,
  action text not null,
  summary text not null,
  candidate_id uuid,
  target_user_id uuid,
  occurred_at timestamptz not null default now()
);
create index if not exists audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index if not exists audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id, occurred_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, occurred_at desc);

create table if not exists public.staff_presence (
  user_id uuid primary key references public.staff_members (user_id) on delete cascade,
  page text not null,
  activity text not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists staff_presence_last_seen_idx on public.staff_presence (last_seen_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidates_set_updated_at on public.candidates;
create trigger candidates_set_updated_at
before update on public.candidates
for each row execute function public.set_updated_at();

drop trigger if exists candidate_results_set_updated_at on public.candidate_results;
create trigger candidate_results_set_updated_at
before update on public.candidate_results
for each row execute function public.set_updated_at();

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sm.role
  from public.staff_members sm
  where sm.user_id = (select auth.uid()) and sm.enabled
  limit 1;
$$;

create or replace function public.is_enabled_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_staff_role() is not null;
$$;

create or replace function public.is_staff_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_staff_role() in ('sc_crime', 'dep_sc_crime');
$$;

create or replace function public.capture_staff_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name := left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'global_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    'Discord user'
  ), 100);
  insert into public.staff_applications (user_id, display_name)
  values (new.id, profile_name)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_user_staff_application on auth.users;
create trigger auth_user_staff_application
after insert on auth.users
for each row execute function public.capture_staff_application();

insert into public.staff_applications (user_id, display_name)
select users.id,
  left(coalesce(
    nullif(btrim(users.raw_user_meta_data ->> 'global_name'), ''),
    nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(users.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(users.raw_user_meta_data ->> 'username'), ''),
    'Discord user'
  ), 100)
from auth.users users
where not exists (
  select 1 from public.staff_members members where members.user_id = users.id
)
on conflict (user_id) do nothing;

create or replace function public.approve_staff_application(
  p_user_id uuid,
  p_role text
)
returns public.staff_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.staff_applications%rowtype;
  appointed public.staff_members%rowtype;
begin
  if not public.is_staff_admin() then
    raise exception 'Senior authority is required to approve staff applications';
  end if;
  if p_role is null or p_role not in ('sc_crime', 'dep_sc_crime', 'interviewer') then
    raise exception 'Invalid staff role';
  end if;
  select * into application
  from public.staff_applications
  where user_id = p_user_id
  for update;
  if application.user_id is null then
    raise exception 'Staff application not found or already reviewed';
  end if;
  insert into public.staff_members (user_id, display_name, role, enabled)
  values (application.user_id, application.display_name, p_role, true)
  returning * into appointed;
  delete from public.staff_applications where user_id = application.user_id;
  return appointed;
end;
$$;

create or replace function public.can_manage_candidates()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_staff_role() in ('sc_crime', 'dep_sc_crime');
$$;

create or replace function public.prevent_self_staff_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_seniors bigint;
begin
  perform pg_advisory_xact_lock(711204);
  if old.user_id = (select auth.uid())
    and (new.role is distinct from old.role or new.enabled is distinct from old.enabled) then
    raise exception 'You cannot change your own authority or disable your own access';
  end if;
  if old.role in ('sc_crime', 'dep_sc_crime') and old.enabled
    and (new.role not in ('sc_crime', 'dep_sc_crime') or not new.enabled) then
    select count(*) into active_seniors
    from public.staff_members sm
    where sm.enabled and sm.role in ('sc_crime', 'dep_sc_crime') and sm.user_id <> old.user_id;
    if active_seniors = 0 then
      raise exception 'At least one enabled senior authority must remain';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_members_prevent_self_lockout on public.staff_members;
create trigger staff_members_prevent_self_lockout
before update on public.staff_members
for each row execute function public.prevent_self_staff_lockout();

create or replace function public.write_audit_event(
  p_actor uuid,
  p_actor_name text,
  p_actor_role text,
  p_page text,
  p_action text,
  p_summary text,
  p_candidate_id uuid default null,
  p_target_user_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    actor_user_id, actor_name, actor_role, page, action, summary, candidate_id, target_user_id
  )
  values (
    p_actor, coalesce(nullif(p_actor_name, ''), 'System / service'),
    coalesce(nullif(p_actor_role, ''), 'system'), p_page, p_action, p_summary,
    p_candidate_id, p_target_user_id
  );
$$;

create or replace function public.audit_candidate_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_record public.staff_members%rowtype;
  event_action text;
  event_summary text;
begin
  select * into actor_record from public.staff_members where user_id = actor_id;
  if tg_op = 'INSERT' then
    perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role, 'candidates',
      'candidate_created', 'Added candidate ' || new.name, new.id);
    return new;
  elsif tg_op = 'UPDATE' then
    event_action := case
      when old.status is distinct from new.status and new.status = 'In Progress' then 'interview_started'
      when old.status is distinct from new.status and new.status in ('Passed', 'Borderline', 'Failed', 'Disqualified', 'Did Not Attend (DNA)') then 'candidate_result_updated'
      when old.interviewer is distinct from new.interviewer then 'interviewer_recorded'
      else 'candidate_updated'
    end;
    event_summary := 'Updated ' || new.name;
    if old.status is distinct from new.status then
      event_summary := event_summary || ': ' || old.status || ' → ' || new.status;
    elsif old.interviewer is distinct from new.interviewer then
      event_summary := event_summary || ': interviewer recorded';
    end if;
    perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role, 'candidates',
      event_action, event_summary, new.id);
    return new;
  else
    perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role, 'candidates',
      'candidate_deleted', 'Removed candidate ' || old.name, old.id);
    return old;
  end if;
end;
$$;

create trigger candidates_audit_change
after insert or update or delete on public.candidates
for each row execute function public.audit_candidate_change();

create or replace function public.audit_staff_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_record public.staff_members%rowtype;
begin
  select * into actor_record from public.staff_members where user_id = actor_id;
  if tg_op = 'INSERT' then
    perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role, 'staff',
      'staff_appointed', 'Appointed ' || new.display_name || ' as ' || new.role, null, new.user_id);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.role is distinct from new.role or old.enabled is distinct from new.enabled or old.display_name is distinct from new.display_name then
      perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role, 'staff',
        'staff_updated', 'Updated staff appointment for ' || new.display_name, null, new.user_id);
    end if;
    return new;
  else
    perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role, 'staff',
      'staff_removed', 'Removed staff appointment for ' || old.display_name, null, old.user_id);
    return old;
  end if;
end;
$$;

drop trigger if exists staff_members_audit_change on public.staff_members;
create trigger staff_members_audit_change
after insert or update or delete on public.staff_members
for each row execute function public.audit_staff_change();

create or replace function public.log_page_visit(p_page text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_record public.staff_members%rowtype;
begin
  if p_page not in ('overview', 'candidates', 'results', 'staff', 'audit', 'questions') then
    raise exception 'Invalid portal page';
  end if;
  select * into actor_record from public.staff_members where user_id = actor_id and enabled;
  if actor_record.user_id is null then raise exception 'Enabled staff access is required'; end if;
  if p_page in ('staff', 'audit', 'questions') and actor_record.role not in ('sc_crime', 'dep_sc_crime') then
    raise exception 'Senior authority is required for this page';
  end if;
  if p_page = 'results' and actor_record.role = 'interviewer' then
    raise exception 'Interviewers cannot access master results';
  end if;
  perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role,
    p_page, 'page_view', 'Opened ' || p_page || ' page');
end;
$$;

create or replace function public.log_result_export()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_record public.staff_members%rowtype;
begin
  select * into actor_record from public.staff_members where user_id = actor_id and enabled;
  if actor_record.user_id is null or actor_record.role = 'interviewer' then
    raise exception 'Candidate-management access is required';
  end if;
  perform public.write_audit_event(actor_id, actor_record.display_name, actor_record.role,
    'results', 'result_image_exported', 'Downloaded master results image');
end;
$$;

create or replace function public.update_staff_presence(p_page text, p_activity text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := public.current_staff_role();
  expected_activity text;
begin
  if actor_role is null then raise exception 'Enabled staff access is required'; end if;
  if p_page not in ('overview', 'candidates', 'results', 'staff', 'audit', 'questions') then
    raise exception 'Invalid portal page';
  end if;
  if (p_page in ('staff', 'audit', 'questions') and actor_role not in ('sc_crime', 'dep_sc_crime'))
    or (p_page = 'results' and actor_role = 'interviewer') then
    raise exception 'Your role cannot access this page';
  end if;
  if p_activity not in (
    'Viewing overview', 'Viewing candidates', 'Viewing results',
    'Managing staff', 'Reviewing audit', 'Viewing questions', 'Conducting an interview'
  ) then raise exception 'Invalid staff activity'; end if;
  expected_activity := case p_page
      when 'overview' then 'Viewing overview'
      when 'candidates' then 'Viewing candidates'
      when 'results' then 'Viewing results'
      when 'staff' then 'Managing staff'
      when 'audit' then 'Reviewing audit'
      when 'questions' then 'Viewing questions'
    end;
  if p_activity <> expected_activity
    and not (p_page = 'candidates' and p_activity = 'Conducting an interview') then
    raise exception 'Activity does not match the current portal page';
  end if;
  insert into public.staff_presence (user_id, page, activity, last_seen_at)
  values (actor_id, p_page, p_activity, now())
  on conflict (user_id) do update
  set page = excluded.page, activity = excluded.activity, last_seen_at = now();
end;
$$;

create or replace function public.create_question_batch(p_name text, p_description text, p_questions jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  batch_id uuid;
  question_item jsonb;
  question_number integer := 0;
begin
  if not public.is_staff_admin() then raise exception 'Senior authority is required'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 100 then raise exception 'Batch name must be 1–100 characters'; end if;
  if length(coalesce(p_description, '')) > 500 then raise exception 'Batch description is too long'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'Question payload must be an array';
  end if;
  if jsonb_array_length(p_questions) <> 15 then
    raise exception 'A question batch must contain exactly 15 questions';
  end if;
  insert into public.question_batches (name, description, created_by)
  values (btrim(p_name), coalesce(p_description, ''), actor_id)
  returning id into batch_id;
  for question_item in select value from jsonb_array_elements(p_questions)
  loop
    question_number := question_number + 1;
    if jsonb_typeof(question_item) <> 'object'
      or length(btrim(coalesce(question_item ->> 'prompt', ''))) not between 1 and 2000
      or length(btrim(coalesce(question_item ->> 'reference_answer', ''))) not between 1 and 5000 then
      raise exception 'Question % must include a valid prompt and reference answer', question_number;
    end if;
    insert into public.interview_questions (batch_id, prompt, reference_answer, sort_order)
    values (batch_id, btrim(question_item ->> 'prompt'), btrim(question_item ->> 'reference_answer'), question_number);
  end loop;
  perform public.write_audit_event(actor_id, (select sm.display_name from public.staff_members sm where sm.user_id = actor_id),
    public.current_staff_role(), 'questions', 'question_batch_created', 'Created question batch ' || btrim(p_name));
  return batch_id;
end;
$$;

create or replace function public.set_question_batch_active(p_batch_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_name text;
  question_count integer;
begin
  if not public.is_staff_admin() then raise exception 'Senior authority is required'; end if;
  if p_active is null then raise exception 'Batch activation state is required'; end if;
  select b.name into batch_name
  from public.question_batches b
  where b.id = p_batch_id
  for update;
  if batch_name is null then raise exception 'Question batch not found'; end if;
  select count(*)::integer into question_count
  from public.interview_questions q where q.batch_id = p_batch_id;
  if p_active and question_count <> 15 then raise exception 'Only complete 15-question batches can be activated'; end if;
  update public.question_batches set active = p_active where id = p_batch_id;
  perform public.write_audit_event((select auth.uid()),
    (select sm.display_name from public.staff_members sm where sm.user_id = (select auth.uid())),
    public.current_staff_role(), 'questions', 'question_batch_updated',
    case when p_active then 'Activated question batch ' else 'Deactivated question batch ' end || batch_name);
end;
$$;

create or replace function public.start_interview(p_candidate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  candidate_status text;
  active_session public.interview_sessions%rowtype;
  selected_questions uuid[];
  active_count integer;
  new_session_id uuid;
begin
  select sm.display_name into actor_name
  from public.staff_members sm where sm.user_id = actor_id and sm.enabled;
  if actor_name is null then raise exception 'Enabled staff access is required'; end if;
  select c.status into candidate_status from public.candidates c where c.id = p_candidate_id for update;
  if candidate_status is null then raise exception 'Candidate not found'; end if;
  if candidate_status not in ('Pending', 'In Progress') then
    raise exception 'Only pending or in-progress candidates can be interviewed';
  end if;
  select s.* into active_session
  from public.interview_sessions s
  where s.candidate_id = p_candidate_id and s.status = 'active'
  for update;
  if active_session.id is not null then
    if active_session.interviewer_id <> actor_id then
      raise exception 'This candidate has an active interview with another staff member';
    end if;
    return active_session.id;
  end if;
  select count(*)::integer into active_count
  from public.interview_questions q
  join public.question_batches b on b.id = q.batch_id
  where b.active;
  if active_count < 15 then raise exception 'At least 15 questions across active batches are required'; end if;
  select array_agg(pool.id order by pool.random_order) into selected_questions
  from (
    select q.id, random() as random_order
    from public.interview_questions q
    join public.question_batches b on b.id = q.batch_id
    where b.active
    order by random()
    limit 15
  ) pool;
  if cardinality(selected_questions) <> 15 then raise exception 'Could not select 15 active questions'; end if;
  insert into public.interview_sessions (candidate_id, interviewer_id, question_ids)
  values (p_candidate_id, actor_id, selected_questions)
  returning id into new_session_id;
  update public.candidates
  set status = 'In Progress', interviewer = actor_name
  where id = p_candidate_id;
  return new_session_id;
end;
$$;

create or replace function public.get_interview_question(p_session_id uuid)
returns table (
  id uuid,
  batch_id uuid,
  prompt text,
  sort_order integer,
  question_number integer,
  total_questions integer,
  response text,
  score text,
  focus_warnings integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_session public.interview_sessions%rowtype;
begin
  select s.* into active_session from public.interview_sessions s
  where s.id = p_session_id and s.interviewer_id = (select auth.uid())
    and s.status = 'active' and public.is_enabled_staff();
  if active_session.id is null then raise exception 'Active interview session not found'; end if;
  return query
  select q.id, q.batch_id, q.prompt, q.sort_order,
    active_session.current_question_number, 15,
    coalesce(a.response, ''), a.score_mark, active_session.focus_warnings
  from public.interview_questions q
  left join public.candidate_answers a on a.session_id = active_session.id and a.question_id = q.id
  where q.id = active_session.question_ids[active_session.current_question_number];
end;
$$;

create or replace function public.get_interview_progress(p_session_id uuid)
returns table (question_id uuid, question_number integer, score text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_session public.interview_sessions%rowtype;
begin
  select s.* into active_session from public.interview_sessions s
  where s.id = p_session_id and s.interviewer_id = (select auth.uid())
    and s.status = 'active' and public.is_enabled_staff();
  if active_session.id is null then raise exception 'Active interview session not found'; end if;
  return query
  select selected.question_id, selected.question_number::integer, a.score_mark
  from unnest(active_session.question_ids) with ordinality as selected(question_id, question_number)
  left join public.candidate_answers a on a.session_id = active_session.id and a.question_id = selected.question_id
  order by selected.question_number;
end;
$$;

create or replace function public.save_interview_answer(
  p_session_id uuid,
  p_question_id uuid,
  p_response text,
  p_score text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_session public.interview_sessions%rowtype;
begin
  select s.* into active_session from public.interview_sessions s
  where s.id = p_session_id and s.interviewer_id = (select auth.uid())
    and s.status = 'active' and public.is_enabled_staff()
  for update;
  if active_session.id is null then raise exception 'Active interview session not found'; end if;
  if not (p_question_id = any(active_session.question_ids)) then raise exception 'Question is not part of this interview'; end if;
  if length(coalesce(p_response, '')) > 5000 then raise exception 'Response notes exceed 5000 characters'; end if;
  if p_score is not null and p_score not in ('0', '0.5', '1', 'SKIP') then raise exception 'Invalid score mark'; end if;
  insert into public.candidate_answers (session_id, question_id, response, score_mark)
  values (p_session_id, p_question_id, coalesce(p_response, ''), p_score)
  on conflict (session_id, question_id) do update
  set response = excluded.response, score_mark = excluded.score_mark, updated_at = now();
end;
$$;

create or replace function public.set_interview_question(p_session_id uuid, p_question_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.interview_sessions
  set current_question_number = p_question_number
  where id = p_session_id and interviewer_id = (select auth.uid())
    and status = 'active' and public.is_enabled_staff() and p_question_number between 1 and 15;
  if not found then raise exception 'Active interview session or question not found'; end if;
end;
$$;

create or replace function public.reveal_interview_answer(p_session_id uuid, p_question_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  answer_key text;
begin
  select q.reference_answer into answer_key
  from public.interview_sessions s
  join public.interview_questions q on q.id = s.question_ids[s.current_question_number]
  where s.id = p_session_id and s.interviewer_id = (select auth.uid())
    and s.status = 'active' and public.is_enabled_staff() and q.id = p_question_id;
  if answer_key is null then raise exception 'The requested answer is not available in the active interview'; end if;
  return answer_key;
end;
$$;

create or replace function public.record_interview_focus_warning(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  warning_count integer;
begin
  update public.interview_sessions
  set focus_warnings = focus_warnings + 1
  where id = p_session_id and interviewer_id = (select auth.uid()) and status = 'active'
    and public.is_enabled_staff()
  returning focus_warnings into warning_count;
  if warning_count is null then raise exception 'Active interview session not found'; end if;
  return warning_count;
end;
$$;

create or replace function public.finish_interview(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_session public.interview_sessions%rowtype;
  answer_count integer;
  points numeric;
  final_status text;
  answer_scores jsonb;
  actor_name text;
begin
  select s.* into active_session from public.interview_sessions s
  where s.id = p_session_id and s.interviewer_id = (select auth.uid())
    and s.status = 'active' and public.is_enabled_staff()
  for update;
  if active_session.id is null then raise exception 'Active interview session not found'; end if;
  select count(*) filter (where a.score_mark is not null),
    coalesce(sum(case when a.score_mark is null or a.score_mark = 'SKIP' then 0 else a.score_mark::numeric end), 0)
  into answer_count, points
  from unnest(active_session.question_ids) as selected(question_id)
  left join public.candidate_answers a on a.session_id = active_session.id and a.question_id = selected.question_id;
  if answer_count <> 15 then raise exception 'Score each question or explicitly mark it SKIP before finishing'; end if;
  final_status := case
    when points >= 11.25 then 'Passed'
    when points >= 9 then 'Borderline'
    else 'Failed'
  end;
  select coalesce(jsonb_object_agg(a.question_id::text,
      case when a.score_mark = 'SKIP' then to_jsonb(0::numeric) else to_jsonb(a.score_mark::numeric) end), '{}'::jsonb)
  into answer_scores
  from public.candidate_answers a
  where a.session_id = active_session.id;
  select sm.display_name into actor_name from public.staff_members sm where sm.user_id = (select auth.uid());
  insert into public.candidate_results (candidate_id, scores)
  values (active_session.candidate_id, answer_scores)
  on conflict (candidate_id) do update
  set scores = excluded.scores, updated_at = now();
  update public.candidates
  set status = final_status, interviewer = actor_name, focus_warnings = active_session.focus_warnings
  where id = active_session.candidate_id;
  update public.interview_sessions set status = 'completed', finished_at = now() where id = active_session.id;
  return jsonb_build_object('status', final_status, 'total_points', points, 'scores', answer_scores);
end;
$$;

create or replace function public.get_candidate_result_details()
returns table (candidate_id uuid, question_number integer, score_mark text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'Senior authority is required to view result details';
  end if;
  return query
  with latest_completed as (
    select distinct on (s.candidate_id) s.candidate_id, s.id, s.question_ids
    from public.interview_sessions s
    where s.status = 'completed'
    order by s.candidate_id, s.finished_at desc nulls last, s.started_at desc
  )
  select latest.candidate_id, selected.question_number::integer, answers.score_mark
  from latest_completed latest
  cross join lateral unnest(latest.question_ids) with ordinality as selected(question_id, question_number)
  left join public.candidate_answers answers
    on answers.session_id = latest.id and answers.question_id = selected.question_id
  order by latest.candidate_id, selected.question_number;
end;
$$;

alter table public.staff_members enable row level security;
alter table public.staff_applications enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_results enable row level security;
alter table public.question_batches enable row level security;
alter table public.interview_questions enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.candidate_answers enable row level security;
alter table public.audit_logs enable row level security;
alter table public.staff_presence enable row level security;

drop policy if exists "Enabled staff can read own staff profile" on public.staff_members;
drop policy if exists "Admins can read staff profiles" on public.staff_members;
drop policy if exists "Admins can appoint staff" on public.staff_members;
drop policy if exists "Admins can update staff appointments" on public.staff_members;
drop policy if exists "Staff can read enabled staff directory" on public.staff_members;
drop policy if exists "Senior authorities can appoint staff" on public.staff_members;
drop policy if exists "Senior authorities can update staff" on public.staff_members;
drop policy if exists "Staff can read permitted staff profiles" on public.staff_members;
drop policy if exists "Applicants can read their own request" on public.staff_applications;
drop policy if exists "Senior authorities can read staff applications" on public.staff_applications;
create policy "Staff can read permitted staff profiles" on public.staff_members
for select to authenticated
using ((select public.is_staff_admin()) or (user_id = (select auth.uid()) and enabled));
create policy "Senior authorities can appoint staff" on public.staff_members
for insert to authenticated with check ((select public.is_staff_admin()));
create policy "Senior authorities can update staff" on public.staff_members
for update to authenticated using ((select public.is_staff_admin()))
with check ((select public.is_staff_admin()));
create policy "Applicants can read their own request" on public.staff_applications
for select to authenticated using (user_id = (select auth.uid()));
create policy "Senior authorities can read staff applications" on public.staff_applications
for select to authenticated using ((select public.is_staff_admin()));

drop policy if exists "Staff can read candidates" on public.candidates;
drop policy if exists "Staff can add candidates as themselves" on public.candidates;
drop policy if exists "Staff can update candidates" on public.candidates;
drop policy if exists "Admins can delete candidates" on public.candidates;
drop policy if exists "Managers and assigned interviewers can read candidates" on public.candidates;
drop policy if exists "Candidate managers can add candidates" on public.candidates;
drop policy if exists "Candidate managers can update candidates" on public.candidates;
drop policy if exists "Assigned interviewers can update assigned candidates" on public.candidates;
drop policy if exists "Senior authorities can delete candidates" on public.candidates;
drop policy if exists "Enabled staff can read candidate roster" on public.candidates;
drop policy if exists "Senior authorities can add candidates" on public.candidates;
drop policy if exists "Senior authorities can update candidates" on public.candidates;
drop policy if exists "Senior authorities can delete candidates" on public.candidates;
create policy "Enabled staff can read candidate roster" on public.candidates
for select to authenticated using ((select public.is_enabled_staff()));
create policy "Senior authorities can add candidates" on public.candidates
for insert to authenticated with check ((select public.is_staff_admin()) and created_by = (select auth.uid()));
create policy "Senior authorities can update candidates" on public.candidates
for update to authenticated using ((select public.is_staff_admin()))
with check ((select public.is_staff_admin()));
create policy "Senior authorities can delete candidates" on public.candidates
for delete to authenticated using ((select public.is_staff_admin()));

drop policy if exists "Senior authorities can read candidate results" on public.candidate_results;
drop policy if exists "Senior authorities can read question batches" on public.question_batches;
drop policy if exists "Senior authorities can read interview questions" on public.interview_questions;
drop policy if exists "Senior authorities can read audit logs" on public.audit_logs;
drop policy if exists "Senior authorities can read staff presence" on public.staff_presence;
create policy "Senior authorities can read candidate results" on public.candidate_results
for select to authenticated using ((select public.is_staff_admin()));
create policy "Senior authorities can read question batches" on public.question_batches
for select to authenticated using ((select public.is_staff_admin()));
create policy "Senior authorities can read interview questions" on public.interview_questions
for select to authenticated using ((select public.is_staff_admin()));
create policy "Senior authorities can read audit logs" on public.audit_logs
for select to authenticated using ((select public.is_staff_admin()));
create policy "Senior authorities can read staff presence" on public.staff_presence
for select to authenticated using ((select public.is_staff_admin()));

revoke all on public.staff_members from anon, authenticated;
grant select, insert, update on public.staff_members to authenticated;
revoke all on public.staff_applications from anon, authenticated;
grant select on public.staff_applications to authenticated;
revoke all on public.candidates from anon, authenticated;
grant select, insert, update, delete on public.candidates to authenticated;
revoke all on public.candidate_results from anon, authenticated;
grant select on public.candidate_results to authenticated;
revoke all on public.question_batches, public.interview_questions from anon, authenticated;
grant select on public.question_batches, public.interview_questions to authenticated;
revoke all on public.interview_sessions, public.candidate_answers from anon, authenticated;
revoke all on public.audit_logs, public.staff_presence from anon, authenticated;
grant select on public.audit_logs, public.staff_presence to authenticated;

revoke all on function public.current_staff_role() from public, anon;
revoke all on function public.is_enabled_staff() from public, anon;
revoke all on function public.is_staff_admin() from public, anon;
revoke all on function public.capture_staff_application() from public, anon, authenticated;
revoke all on function public.approve_staff_application(uuid, text) from public, anon, authenticated;
revoke all on function public.can_manage_candidates() from public, anon;
revoke all on function public.write_audit_event(uuid, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.prevent_self_staff_lockout() from public, anon, authenticated;
revoke all on function public.audit_candidate_change() from public, anon, authenticated;
revoke all on function public.audit_staff_change() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_enabled_staff() to authenticated;
grant execute on function public.is_staff_admin() to authenticated;
grant execute on function public.approve_staff_application(uuid, text) to authenticated;
grant execute on function public.can_manage_candidates() to authenticated;

revoke all on function public.log_page_visit(text) from public, anon;
revoke all on function public.log_result_export() from public, anon;
revoke all on function public.update_staff_presence(text, text) from public, anon;
revoke all on function public.create_question_batch(text, text, jsonb) from public, anon;
revoke all on function public.set_question_batch_active(uuid, boolean) from public, anon;
revoke all on function public.start_interview(uuid) from public, anon;
revoke all on function public.get_interview_question(uuid) from public, anon;
revoke all on function public.get_interview_progress(uuid) from public, anon;
revoke all on function public.save_interview_answer(uuid, uuid, text, text) from public, anon;
revoke all on function public.set_interview_question(uuid, integer) from public, anon;
revoke all on function public.reveal_interview_answer(uuid, uuid) from public, anon;
revoke all on function public.record_interview_focus_warning(uuid) from public, anon;
revoke all on function public.finish_interview(uuid) from public, anon;
revoke all on function public.get_candidate_result_details() from public, anon;
grant execute on function public.log_page_visit(text) to authenticated;
grant execute on function public.log_result_export() to authenticated;
grant execute on function public.update_staff_presence(text, text) to authenticated;
grant execute on function public.create_question_batch(text, text, jsonb) to authenticated;
grant execute on function public.set_question_batch_active(uuid, boolean) to authenticated;
grant execute on function public.start_interview(uuid) to authenticated;
grant execute on function public.get_interview_question(uuid) to authenticated;
grant execute on function public.get_interview_progress(uuid) to authenticated;
grant execute on function public.save_interview_answer(uuid, uuid, text, text) to authenticated;
grant execute on function public.set_interview_question(uuid, integer) to authenticated;
grant execute on function public.reveal_interview_answer(uuid, uuid) to authenticated;
grant execute on function public.record_interview_focus_warning(uuid) to authenticated;
grant execute on function public.finish_interview(uuid) to authenticated;
grant execute on function public.get_candidate_result_details() to authenticated;

drop policy if exists "Senior authorities can monitor staff presence" on realtime.messages;
create policy "Senior authorities can monitor staff presence" on realtime.messages
for select to authenticated
using (extension = 'presence' and (select public.is_staff_admin()));
drop policy if exists "Senior authorities can publish staff presence" on realtime.messages;
create policy "Senior authorities can publish staff presence" on realtime.messages
for insert to authenticated
with check (extension = 'presence' and (select public.is_staff_admin()));

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_logs'
  ) is false then
    alter publication supabase_realtime add table public.audit_logs;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_presence'
  ) is false then
    alter publication supabase_realtime add table public.staff_presence;
  end if;
end;
$$;
