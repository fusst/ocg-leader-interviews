# OCG Leadership Interview Portal

Discord-authenticated staff portal for candidate intake, randomized interviews, role-restricted master results, staff presence, audit history, and Discord-ready PNG exports. Built with React 18, Vite, Tailwind CSS, Lucide, and Supabase.

## Requirements

- Node.js 20.19+ or 22.12+
- Supabase project with Discord OAuth configured

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using your Supabase project URL and publishable/anon key.
3. Apply the single SQL file [supabase/setup.sql](./supabase/setup.sql) in the Supabase SQL Editor. It is designed to initialize a new project or reconcile the previous three portal migrations into the current schema.
4. In Supabase **Authentication → Providers**, enable Discord and configure the OAuth client ID and secret. Set the callback URL shown by Supabase in your Discord application.
5. Add the local origin (for example `http://localhost:5173`) to Supabase **Authentication → URL Configuration → Redirect URLs**.
6. Run `npm run dev`.

For production, add the deployed app origin to Supabase's allowed redirect URLs and build with `npm run build`.

## Bootstrap the first senior account

Discord sign-in authenticates an identity but does not grant staff access. After applying `supabase/setup.sql`, sign in once with the account that will become the first SC Crime. In the Supabase SQL Editor, replace the example UUID and name:

```sql
insert into public.staff_members (user_id, display_name, role)
values ('00000000-0000-0000-0000-000000000000', 'Your staff name', 'sc_crime');
```

After that account signs in, it can approve new staff access requests and assign roles directly from the portal. New Discord signups are added to the pending queue automatically; senior staff no longer need to look up user IDs in Supabase. Keep at least one enabled senior account. Legacy `admin` maps to `sc_crime`; legacy `chief_cc` and `crime_curator` map to `interviewer`.

## Roles and permissions

| Role | Access |
|---|---|
| SC Crime | Full candidate, question-bank, master-result, staff, and audit access |
| Dep SC Crime | Same portal permissions as SC Crime |
| Interviewer | Can choose and interview any candidate; cannot manage candidates or staff, access question batches, view master results, or read audit logs |

Senior-only permissions are enforced in PostgreSQL RLS and security-definer RPCs as well as hidden in the UI. Interviewers cannot directly update candidates, candidate results, question batches, reference answers, or interview records.

## Question batches and interview flow

- Senior staff create batches containing exactly 15 prompts and private reference answers. A batch cannot be activated unless all 15 questions are valid.
- The Question Batches screen supports manual entry and CSV/TSV import. Import 15 rows with two columns (`Question`, `Reference answer`); an optional header is supported, CSV quotes and commas within fields are allowed, and imported questions can be reviewed or edited before saving.
- Every interview selects 15 distinct questions at random from the combined pool of active batches. Questions are presented one at a time; the database persists the selected order, answer notes, score, current question, and focus-warning count.
- Interviewers request each reference answer separately during the active interview. Interviewers have no direct read permission on the question bank or answer-key columns.
- Score each question `1.0`, `0.5`, `0.0`, or `SKIP`. `SKIP` counts as `0` points; all 15 questions must be marked to finish. Results are reported only as points out of 15, with no percentage.
- Each question has a 90-second timer. Tab/window focus losses are recorded, but do not automatically disqualify a candidate.
- Final thresholds are **Passed ≥ 11.25/15**, **Borderline ≥ 9/15 and < 11.25/15**, and **Failed < 9/15**. Senior staff can set manual statuses such as Disqualified and Did Not Attend (DNA).

The UI disables casual copy/context-menu actions on displayed prompts and fetches an answer key only when requested. This is a deterrent, not cryptographic copy protection: an authorized interviewer can still take screenshots, photographs, or manually transcribe displayed content.

## Roster, results, and oversight

- Candidate intake supports a single entry or newline-separated rows in `Name | Discord | OCG(s)` format. OCG names are comma-separated; any combination of Tambov, Kurgan, Orekhov, and Caucasian is supported. Interviews are not pre-assigned; the staff member who starts the interview is recorded. Discord IDs are retained for internal identification but are not shown in the candidate roster or results UI.
- Master results and scores are stored separately from the roster and are readable only by the two senior roles. The results page supports filtering and a colorful, publication-ready PNG with candidate name, Q1–Q15 marks, total points out of 15, and final verdict. The image intentionally omits Discord IDs, OCG targets, interviewer names, portal branding, and a footer. A skipped question displays and scores as zero. The detailed image supports up to 100 rows; filter and export smaller groups for larger cycles. The evaluated count excludes Pending and In Progress candidates.
- Senior staff can permanently delete a candidate from the roster. Deleting also removes associated interview sessions, answers, and result records; the audit log retains the candidate-deletion event.
- Senior authorities have a live staff activity dashboard, realtime audit feed, and staff appointment history. Candidate response text and answer keys are not written into the audit log. Realtime Presence is senior-only; heartbeat activity expires from the dashboard after 90 seconds.
- Existing candidate scores and private notes are moved into the senior-only results table when the setup script reconciles the older schema. The old interviewer assignment field is removed; legacy assigned candidates are reset to `Not started`.

## Security notes

Never put the Supabase service-role key in a Vite environment variable or browser. The portal uses only the public anon/publishable key; database access relies on authenticated staff roles, RLS, and narrowly granted RPCs. The setup SQL does not create senior staff accounts automatically; bootstrap only the first senior account after Discord sign-in.
