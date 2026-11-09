import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Check,
  Clock3, Download, FileText, Filter, LogOut, Plus, Radio, RefreshCw, Shield,
  Sparkles, Users, UserPlus, X, History, BookOpen, Eye, EyeOff, LockKeyhole, Upload, Trash2,
} from 'lucide-react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import StatusBadge from './components/StatusBadge'
import { getScore, scoreLabel } from './lib/interview'
import { drawResultCard } from './lib/resultCard'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import { OCGS, STATUSES } from './types'
import { canManageCandidates, isSeniorRole, STAFF_ROLE_LABELS, STAFF_ROLES } from './types'
import type { AuditEvent, Candidate, CandidateStatus, InterviewQuestion, Ocg, OnlineStaffMember, Question, QuestionBatch, ScoreMark, StaffApplication, StaffMember } from './types'

type View = 'overview' | 'candidates' | 'results' | 'staff' | 'audit' | 'questions'
type Draft = { name: string; discord: string; target_ocgs: Ocg[] }

const today = () => new Date().toISOString().slice(0, 10)
const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-400'
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-sm font-bold text-cyan-200 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50'
const emptyDraft = (): Draft => ({ name: '', discord: '', target_ocgs: [] })

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

function scoreMarkFromValue(value: unknown): ScoreMark | null {
  if (value === 'SKIP') return 'SKIP'
  if (value === 0 || value === 0.5 || value === 1) return value
  if (value === '0') return 0
  if (value === '0.5') return 0.5
  if (value === '1') return 1
  return null
}

function parseQuestionImport(source: string) {
  const text = source.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field.length === 0) quoted = true
    else if (character === delimiter) {
      row.push(field.trim())
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field.trim())
      if (row.some((value) => value.length)) rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  if (quoted) throw new Error('The import has an unclosed quoted field.')
  row.push(field.trim())
  if (row.some((value) => value.length)) rows.push(row)

  const header = rows[0]?.map((value) => value.toLowerCase().replace(/[^a-z]/g, '')) ?? []
  const hasHeader = header.length === 2
    && ['prompt', 'question'].includes(header[0])
    && ['answer', 'referenceanswer', 'expectedanswer'].includes(header[1])
  const questionRows = hasHeader ? rows.slice(1) : rows
  if (questionRows.length !== 15) throw new Error(`Import must contain exactly 15 question rows; found ${questionRows.length}.`)
  return questionRows.map((values, index) => {
    if (values.length !== 2 || !values[0] || !values[1]) {
      throw new Error(`Row ${index + 1} must contain a question and its reference answer.`)
    }
    if (values[0].length > 2000 || values[1].length > 5000) {
      throw new Error(`Row ${index + 1} exceeds the question or reference-answer length limit.`)
    }
    return { prompt: values[0], reference_answer: values[1] }
  })
}

function SignInScreen({ error, onSignIn, busy }: { error: string; onSignIn: () => void; busy: boolean }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-5 text-slate-200 md:px-8">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute -left-40 top-28 h-[520px] w-[520px] rounded-full bg-cyan-500/[.08] blur-[140px]" />
      <div className="pointer-events-none absolute -right-36 bottom-0 h-[460px] w-[460px] rounded-full bg-indigo-500/[.08] blur-[140px]" />
      <header className="relative mx-auto flex max-w-7xl items-center justify-between border-b border-slate-800/80 py-5">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300"><Shield size={20} /></div><div><div className="text-sm font-extrabold tracking-wide text-white">OCG OPERATIONS</div><div className="font-mono text-[9px] uppercase tracking-[.2em] text-slate-500">Leadership interview system</div></div></div>
        <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Secure Discord authentication</div>
      </header>
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 py-14 md:py-20 lg:grid-cols-[1.15fr_.85fr] lg:gap-20">
        <section>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.18em] text-cyan-200"><Activity size={13} /> Leadership access // 01</div>
          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">One command center.<br /><span className="bg-gradient-to-r from-cyan-300 via-indigo-300 to-emerald-300 bg-clip-text text-transparent">Clearer decisions.</span></h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-400">A secure workspace for OCG leadership interviews, candidate evaluation, and staff coordination. Access is granted only after a senior authority reviews your Discord account.</p>
          <div className="mt-9 grid max-w-2xl gap-3 sm:grid-cols-3">
            {[['01', 'Authenticate', 'Use your Discord account'], ['02', 'Get verified', 'A senior reviews your request'], ['03', 'Get appointed', 'Your role unlocks the portal']].map(([number, title, detail]) => <div key={number} className="rounded-xl border border-slate-800 bg-slate-900/55 p-4"><span className="font-mono text-[10px] text-cyan-400">{number} / ACCESS</span><h2 className="mt-3 text-sm font-bold text-white">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div>)}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500"><span className="inline-flex items-center gap-2"><Users size={14} className="text-indigo-300" /> SC Crime · Dep SC Crime · Interviewer</span><span className="inline-flex items-center gap-2"><LockKeyhole size={13} className="text-emerald-300" /> Role-based access controls</span></div>
        </section>
        <section className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-cyan-400">Staff identity</p><h2 className="mt-2 text-2xl font-extrabold text-white">Welcome to the portal</h2></div><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-400/10 text-indigo-300"><Shield size={19} /></div></div>
          <p className="mt-3 text-sm leading-6 text-slate-400">New here? Continue with Discord to create an access request. Existing staff can use the same button to sign in.</p>
          {!hasSupabaseConfig && <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>.</div>}
          {error && <div role="alert" className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
          <button onClick={onSignIn} disabled={!hasSupabaseConfig || busy} className={`${primaryClass} mt-6 w-full justify-center py-3.5 text-sm`}>
            {busy ? <RefreshCw size={17} className="animate-spin" /> : <DiscordMark />}
            {busy ? 'Connecting to Discord…' : 'Sign up / sign in with Discord'}
          </button>
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-5 text-slate-500"><Shield size={14} className="mt-0.5 shrink-0 text-emerald-400" /><span>Authentication does not grant staff access. Every new account remains outside the portal until a senior authority assigns a role.</span></div>
          <p className="mt-5 text-center text-[10px] uppercase tracking-wider text-slate-600">Discord OAuth 2.0 · Restricted operations environment</p>
        </section>
      </div>
      <footer className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 py-5 font-mono text-[9px] uppercase tracking-wider text-slate-600"><span>Leadership operations</span><span>Identity verified · Access controlled</span></footer>
    </main>
  )
}

function PendingAccessScreen({ displayName, requestExists, loading, error, onRefresh, onSignOut }: {
  displayName: string
  requestExists: boolean
  loading: boolean
  error: string
  onRefresh: () => void
  onSignOut: () => void
}) {
  return <main className="relative min-h-screen overflow-hidden bg-slate-950 px-5 py-8 text-slate-200 md:px-8">
    <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
    <div className="pointer-events-none absolute left-1/2 top-1/3 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-cyan-500/[.07] blur-[140px]" />
    <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col">
      <header className="flex items-center justify-between border-b border-slate-800/80 pb-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300"><Shield size={20} /></div><div><div className="text-sm font-extrabold text-white">OCG OPERATIONS</div><div className="font-mono text-[9px] uppercase tracking-[.2em] text-slate-500">Access verification</div></div></div><button onClick={onSignOut} className={buttonClass}><LogOut size={14} /> Sign out</button></header>
      <section className="my-auto grid gap-8 py-12 lg:grid-cols-[1fr_.8fr] lg:items-center">
        <div><div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-amber-200"><Clock3 size={13} /> {requestExists ? 'Verification in progress' : 'Access not yet assigned'}</div><h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-5xl">You’re on the list,<br /><span className="text-cyan-300">{displayName}.</span></h1><p className="mt-5 max-w-xl text-sm leading-7 text-slate-400">{requestExists ? 'Your Discord account is authenticated and your access request is waiting for review. A senior authority will assign the correct staff role. This page will unlock automatically after approval.' : 'Your account is authenticated, but its access request could not be found. Try refreshing; if this continues, contact a senior authority to check the portal setup.'}</p>
          <div className="mt-8 flex flex-wrap gap-3"><button onClick={onRefresh} disabled={loading} className={primaryClass}>{loading ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />} Check verification status</button><div className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400"><span className={`h-2 w-2 rounded-full ${requestExists ? 'animate-pulse bg-amber-400' : 'bg-slate-600'}`} /> {requestExists ? 'Awaiting senior review' : 'Request not recorded'}</div></div>
          {error && <div role="alert" className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/65 p-6 sm:p-7"><p className="font-mono text-[10px] uppercase tracking-[.2em] text-slate-500">Your access path</p><div className="mt-6 space-y-5">
          {[['01', 'Discord account verified', true], ['02', 'Senior authority reviews request', requestExists], ['03', 'Role assigned and portal unlocked', false]].map(([step, title, complete]) => <div key={String(step)} className="flex items-start gap-4"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border font-mono text-xs ${complete ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-700 bg-slate-950 text-slate-500'}`}>{complete ? <Check size={16} /> : step}</div><div className="pt-1"><div className={`text-sm font-semibold ${complete ? 'text-slate-200' : 'text-slate-500'}`}>{title}</div><div className="mt-1 text-xs text-slate-600">{step === '01' ? 'Authentication complete' : step === '02' && requestExists ? 'Your request is in the staff queue' : step === '03' && complete ? 'Access granted' : 'Waiting for the previous step'}</div></div></div>)}
        </div><div className="mt-7 rounded-lg border border-cyan-500/15 bg-cyan-500/[.04] p-3 text-xs leading-5 text-slate-400"><Shield size={13} className="mr-1.5 inline text-cyan-300" />No candidate or staff data is available until your role is approved.</div></div>
      </section>
      <footer className="border-t border-slate-800/70 pt-5 font-mono text-[9px] uppercase tracking-wider text-slate-600">Secure staff onboarding · Access is granted by senior authority</footer>
    </div>
  </main>
}

function DiscordMark() {
  return <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true"><path d="M19.73 5.1A19.2 19.2 0 0 0 15 3.65a.07.07 0 0 0-.07.04c-.2.36-.42.83-.58 1.2a17.7 17.7 0 0 0-5.3 0c-.16-.38-.38-.84-.59-1.2a.07.07 0 0 0-.07-.04A19.1 19.1 0 0 0 3.68 5.1a.06.06 0 0 0-.03.03C.64 9.55-.18 13.86.22 18.12c0 .02.01.04.03.05a19.3 19.3 0 0 0 5.8 2.93.07.07 0 0 0 .08-.03c.45-.62.85-1.28 1.19-1.97a.07.07 0 0 0-.04-.1 12.7 12.7 0 0 1-1.81-.86.07.07 0 0 1 0-.12l.36-.28a.07.07 0 0 1 .07-.01c3.8 1.74 7.92 1.74 11.67 0a.07.07 0 0 1 .07.01c.12.1.24.2.36.28a.07.07 0 0 1 0 .12c-.58.34-1.18.63-1.82.86a.07.07 0 0 0-.04.1c.35.69.75 1.35 1.19 1.97a.07.07 0 0 0 .08.03 19.2 19.2 0 0 0 5.81-2.93.07.07 0 0 0 .03-.05c.47-4.92-.8-9.2-3.43-12.99a.06.06 0 0 0-.03-.03ZM8.02 14.7c-1.14 0-2.08-1.05-2.08-2.34s.92-2.34 2.08-2.34c1.16 0 2.1 1.06 2.08 2.34 0 1.29-.92 2.34-2.08 2.34Zm7.7 0c-1.14 0-2.08-1.05-2.08-2.34s.92-2.34 2.08-2.34c1.16 0 2.1 1.06 2.08 2.34 0 1.29-.92 2.34-2.08 2.34Z" /></svg>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [accessError, setAccessError] = useState('')
  const [accessRequestExists, setAccessRequestExists] = useState(false)
  const [accessRefresh, setAccessRefresh] = useState(0)
  const [staff, setStaff] = useState<StaffMember | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)
  const [staffRows, setStaffRows] = useState<StaffMember[]>([])
  const [staffApplications, setStaffApplications] = useState<StaffApplication[]>([])
  const [staffTableLoading, setStaffTableLoading] = useState(false)
  const [staffApplicationsLoading, setStaffApplicationsLoading] = useState(false)
  const [staffSaving, setStaffSaving] = useState(false)
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditRefresh, setAuditRefresh] = useState(0)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [onlineStaff, setOnlineStaff] = useState<OnlineStaffMember[]>([])
  const [seniorOnlineCount, setSeniorOnlineCount] = useState(0)
  const [view, setView] = useState<View>('overview')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showIntake, setShowIntake] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [batchText, setBatchText] = useState('')
  const [filterOcg, setFilterOcg] = useState<'All' | Ocg>('All')
  const [filterStatus, setFilterStatus] = useState<'All' | CandidateStatus>('All')
  const [search, setSearch] = useState('')
  const [interviewId, setInterviewId] = useState<string | null>(null)
  const [interviewSessionId, setInterviewSessionId] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null)
  const [answerResponse, setAnswerResponse] = useState('')
  const [referenceAnswer, setReferenceAnswer] = useState('')
  const [referenceVisible, setReferenceVisible] = useState(false)
  const [scores, setScores] = useState<Record<string, ScoreMark>>({})
  const [warnings, setWarnings] = useState(0)
  const [questionIndex, setQuestionIndex] = useState(1)
  const [secondsLeft, setSecondsLeft] = useState(90)
  const [questionBatches, setQuestionBatches] = useState<QuestionBatch[]>([])
  const [questionBank, setQuestionBank] = useState<Question[]>([])
  const [questionBankLoading, setQuestionBankLoading] = useState(false)
  const [questionSaving, setQuestionSaving] = useState(false)
  const lastFocusWarning = useRef(0)
  const presenceChannel = useRef<RealtimeChannel | null>(null)

  const notifyError = (message: string) => {
    setError(message)
    setNotice('')
  }
  const notifySuccess = (message: string) => {
    setNotice(message)
    setError('')
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 3500)
  }

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }
    let active = true
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setAuthError(sessionError.message)
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthError('')
      setAccessError('')
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async () => {
    if (!supabase) return
    setBusy(true)
    setAuthError('')
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: window.location.origin },
    })
    if (signInError) {
      setAuthError(signInError.message)
      setBusy(false)
    }
  }

  const deleteCandidate = async (candidate: Candidate) => {
    if (!supabase || !staff || !canManageCandidates(staff.role) || busy) return
    const confirmed = window.confirm(
      `Permanently delete ${candidate.name} and all of their interview results and answers? This cannot be undone. The audit log will retain a deletion record.`,
    )
    if (!confirmed) return

    setBusy(true)
    try {
      const { data, error: deleteError } = await supabase.from('candidates')
        .delete()
        .eq('id', candidate.id)
        .select('id')
      if (deleteError) {
        notifyError(`Could not delete ${candidate.name}: ${deleteError.message}`)
        return
      }
      if (!data?.some((row) => row.id === candidate.id)) {
        notifyError(`Could not delete ${candidate.name}. The candidate may already be deleted or your role may not have permission.`)
        return
      }
      setCandidates((current) => current.filter((item) => item.id !== candidate.id))
      notifySuccess(`${candidate.name} and their interview records were deleted.`)
    } catch (deleteError) {
      notifyError(`Could not delete ${candidate.name}: ${errorText(deleteError)}`)
    } finally {
      setBusy(false)
    }
  }

  const loadCandidates = useCallback(async () => {
    if (!supabase || !session) return
    setLoading(true)
    const { data, error: queryError } = await supabase.from('candidates')
      .select('id, name, discord, target_ocgs, interviewer, status, focus_warnings, cycle_date, created_at, updated_at, created_by')
      .order('created_at', { ascending: false })
    if (queryError) notifyError(queryError.message)
    else {
      const roster = (data ?? []).map((candidate) => ({ ...candidate, scores: {}, question_marks: [] })) as Candidate[]
      if (staff && canManageCandidates(staff.role)) {
        const [
          { data: results, error: resultsError },
          { data: questionDetails, error: questionDetailsError },
        ] = await Promise.all([
          supabase.from('candidate_results').select('candidate_id, scores'),
          supabase.rpc('get_candidate_result_details'),
        ])
        if (resultsError || questionDetailsError) {
          notifyError(`Could not load result breakdown: ${resultsError?.message ?? questionDetailsError?.message}`)
        } else {
          const resultMap = new Map((results ?? []).map((result) => [result.candidate_id, result.scores as Record<string, ScoreMark>]))
          const questionMarkMap = new Map<string, Array<ScoreMark | null>>()
          for (const detail of questionDetails ?? []) {
            const marks = questionMarkMap.get(detail.candidate_id) ?? Array.from({ length: 15 }, () => null)
            const mark = scoreMarkFromValue(detail.score_mark)
            if (detail.question_number >= 1 && detail.question_number <= 15) marks[detail.question_number - 1] = mark
            questionMarkMap.set(detail.candidate_id, marks)
          }
          setCandidates(roster.map((candidate) => ({
            ...candidate,
            scores: resultMap.get(candidate.id) ?? {},
            question_marks: questionMarkMap.get(candidate.id) ?? [],
          })))
          setLoading(false)
          return
        }
      }
      setCandidates(roster)
    }
    setLoading(false)
  }, [session, staff])

  const loadQuestionBank = useCallback(async () => {
    if (!supabase || !staff || !isSeniorRole(staff.role)) return false
    setQuestionBankLoading(true)
    const [{ data: batches, error: batchError }, { data: questions, error: questionError }] = await Promise.all([
      supabase.from('question_batches').select('id, name, description, active, created_at, created_by').order('created_at', { ascending: false }),
      supabase.from('interview_questions').select('id, batch_id, prompt, reference_answer, sort_order').order('sort_order'),
    ])
    setQuestionBankLoading(false)
    if (batchError || questionError) {
      notifyError(`Could not load question batches: ${batchError?.message ?? questionError?.message}`)
      return false
    }
    setQuestionBatches((batches ?? []) as QuestionBatch[])
    setQuestionBank((questions ?? []) as Question[])
    return true
  }, [staff])

  useEffect(() => {
    if (view === 'questions' && staff && isSeniorRole(staff.role)) void loadQuestionBank()
  }, [view, staff, loadQuestionBank])

  const loadAuditLogs = useCallback(async () => {
    if (!supabase || !staff || !isSeniorRole(staff.role)) return
    setAuditLoading(true)
    const { data, error: queryError } = await supabase.from('audit_logs')
      .select('id, actor_user_id, actor_name, actor_role, page, action, summary, candidate_id, target_user_id, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(250)
    if (queryError) notifyError(`Could not load the audit log: ${queryError.message}`)
    else setAuditLogs((data ?? []) as AuditEvent[])
    setAuditLoading(false)
  }, [staff])

  const loadStaffPresence = useCallback(async () => {
    if (!supabase || !staff || !isSeniorRole(staff.role)) return
    const [{ data: presenceRows, error: presenceError }, { data: staffData, error: staffError }] = await Promise.all([
      supabase.from('staff_presence')
        .select('user_id, page, activity, last_seen_at')
        .gte('last_seen_at', new Date(Date.now() - 90_000).toISOString()),
      supabase.from('staff_members')
        .select('user_id, display_name, role')
        .eq('enabled', true),
    ])
    if (presenceError || staffError) {
      notifyError(`Could not load live staff activity: ${presenceError?.message ?? staffError?.message}`)
      return
    }
    const directory = new Map((staffData ?? []).map((member) => [member.user_id, member]))
    setOnlineStaff((presenceRows ?? []).flatMap((presence) => {
      const member = directory.get(presence.user_id)
      if (!member || !STAFF_ROLES.includes(member.role as StaffMember['role'])) return []
      return [{
        user_id: presence.user_id,
        display_name: member.display_name,
        role: member.role as StaffMember['role'],
        page: presence.page,
        activity: presence.activity,
        online_at: presence.last_seen_at,
      }]
    }))
  }, [staff])

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setStaff(null)
      return
    }
    let active = true
    setAccessLoading(true)
    Promise.all([
      supabase.from('staff_members')
        .select('user_id, display_name, role, enabled')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      supabase.from('staff_applications')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle(),
    ]).then(([{ data, error: queryError }, { data: application, error: applicationError }]) => {
        if (!active) return
        if (queryError || applicationError) {
          const accessCheckError = queryError?.message ?? applicationError?.message
          setAccessError(`Could not check staff access. Confirm the setup SQL has been applied. Details: ${accessCheckError}`)
          setStaff(null)
        } else {
          setAccessError('')
          if (data?.enabled) setStaff(data as StaffMember)
          else {
            setStaff(null)
            setAccessRequestExists(Boolean(application))
          }
        }
        setAccessLoading(false)
      })
    return () => { active = false }
  }, [session, accessRefresh])

  useEffect(() => {
    if (!supabase || !session || staff || accessError) return
    const client = supabase
    const timer = window.setInterval(async () => {
      const { data: staffData, error: staffError } = await client.from('staff_members')
        .select('user_id, display_name, role, enabled')
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (staffError) {
        setAccessError(`Could not check staff access. Confirm the setup SQL has been applied. Details: ${staffError.message}`)
        return
      }
      if (staffData?.enabled) {
        setStaff(staffData as StaffMember)
        setAccessRequestExists(false)
        return
      }
      const { data: application, error: applicationError } = await client.from('staff_applications')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (applicationError) setAccessError(`Could not check your verification request. Confirm the setup SQL has been applied. Details: ${applicationError.message}`)
      else setAccessRequestExists(Boolean(application))
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [session, staff, accessError])

  useEffect(() => {
    if (!supabase || !staff || !isSeniorRole(staff.role) || view !== 'staff') return
    let active = true
    setStaffTableLoading(true)
    setStaffApplicationsLoading(true)
    Promise.all([
      supabase.from('staff_members')
        .select('user_id, display_name, role, enabled')
        .order('display_name'),
      supabase.from('staff_applications')
        .select('user_id, display_name, requested_at')
        .order('requested_at', { ascending: true }),
    ]).then(([{ data, error: queryError }, { data: applications, error: applicationsError }]) => {
        if (!active) return
        if (queryError || applicationsError) notifyError(`Could not load staff access requests: ${queryError?.message ?? applicationsError?.message}`)
        else {
          setStaffRows((data ?? []) as StaffMember[])
          setStaffApplications((applications ?? []) as StaffApplication[])
        }
        setStaffTableLoading(false)
        setStaffApplicationsLoading(false)
      })
    return () => { active = false }
  }, [staff, view])

  useEffect(() => {
    if (!supabase || !staff || !session || !isSeniorRole(staff.role) || view !== 'audit') return
    void loadAuditLogs()
    void loadStaffPresence()
    const client = supabase
    const channel = client.channel(`senior-audit-stream-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        setAuditLogs((current) => [payload.new as AuditEvent, ...current].slice(0, 250))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_presence' }, () => {
        void loadStaffPresence()
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') notifyError(`Live audit connection status: ${status}`)
      })
    return () => { void client.removeChannel(channel) }
  }, [staff, session, view, auditRefresh, loadAuditLogs, loadStaffPresence])

  useEffect(() => {
    if (!staff) {
      setCandidates([])
      return
    }
    void loadCandidates()
  }, [staff, loadCandidates])

  useEffect(() => {
    if (!supabase || !staff || !session || !isSeniorRole(staff.role)) {
      setSeniorOnlineCount(0)
      return
    }
    const client = supabase
    const channel = client.channel('ocg-staff-presence', {
      config: { private: true, presence: { key: session.user.id } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<Record<string, unknown>>>
        const members = Object.values(state).flatMap((metas) => metas.flatMap((meta) => {
          if (typeof meta.user_id !== 'string' || typeof meta.display_name !== 'string' || typeof meta.role !== 'string') return []
          if (!STAFF_ROLES.includes(meta.role as StaffMember['role'])) return []
          return [{
            user_id: meta.user_id,
            display_name: meta.display_name,
            role: meta.role as StaffMember['role'],
            page: typeof meta.page === 'string' ? meta.page : 'unknown',
            activity: typeof meta.activity === 'string' ? meta.activity : 'Active',
            online_at: typeof meta.online_at === 'string' ? meta.online_at : new Date().toISOString(),
          }]
        }))
        setSeniorOnlineCount(members.length)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const trackStatus = await channel.track({
            user_id: session.user.id,
            display_name: staff.display_name,
            role: staff.role,
            page: view,
            activity: interviewId ? 'Conducting an interview' : `Viewing ${view}`,
            online_at: new Date().toISOString(),
          })
          if (trackStatus !== 'ok') notifyError(`Presence could not be published: ${trackStatus}`)
        }
      })
    presenceChannel.current = channel
    return () => {
      presenceChannel.current = null
      void client.removeChannel(channel)
    }
  }, [session, staff])

  useEffect(() => {
    if (!session || !staff || !supabase) return
    if ((view === 'staff' || view === 'audit' || view === 'questions') && !isSeniorRole(staff.role)) {
      setView('overview')
      return
    }
    if (view === 'results' && staff.role === 'interviewer') {
      setView('candidates')
      return
    }
    const pageNames: Record<View, string> = {
      overview: 'overview',
      candidates: 'candidates',
      results: 'results',
      staff: 'staff',
      audit: 'audit',
      questions: 'questions',
    }
    supabase.rpc('log_page_visit', { p_page: pageNames[view] }).then(({ error: logError }) => {
      if (logError) notifyError(`Could not record page visit: ${logError.message}`)
    })
    if (presenceChannel.current) {
      void presenceChannel.current.track({
        user_id: session.user.id,
        display_name: staff.display_name,
        role: staff.role,
        page: view,
        activity: interviewId ? 'Conducting an interview' : `Viewing ${view}`,
        online_at: new Date().toISOString(),
      })
    }
  }, [session, staff, view])

  useEffect(() => {
    if (!session || !staff || !presenceChannel.current) return
    void presenceChannel.current.track({
      user_id: session.user.id,
      display_name: staff.display_name,
      role: staff.role,
      page: view,
      activity: interviewId ? 'Conducting an interview' : `Viewing ${view}`,
      online_at: new Date().toISOString(),
    })
  }, [session, staff, view, interviewId])

  useEffect(() => {
    if (!supabase || !session || !staff) return
    const client = supabase
    const activity = interviewId ? 'Conducting an interview'
      : view === 'staff' ? 'Managing staff'
        : view === 'audit' ? 'Reviewing audit'
          : `Viewing ${view}`
    const publishPresence = () => {
      client.rpc('update_staff_presence', { p_page: view, p_activity: activity }).then(({ error: presenceError }) => {
        if (presenceError) notifyError(`Could not update staff activity: ${presenceError.message}`)
      })
    }
    publishPresence()
    const heartbeat = window.setInterval(publishPresence, 25_000)
    return () => window.clearInterval(heartbeat)
  }, [session, staff, view, interviewId])

  const openInterview = async (candidate: Candidate) => {
    if (!supabase || !session || !staff) return
    setBusy(true)
    const { data: sessionData, error: startError } = await supabase.rpc('start_interview', { p_candidate_id: candidate.id })
    if (startError) {
      notifyError(startError.message)
      setBusy(false)
      return
    }
    const activeSessionId = typeof sessionData === 'string' ? sessionData : ''
    if (!activeSessionId) {
      notifyError('The interview session could not be started. Contact a senior administrator.')
      setBusy(false)
      return
    }
    const { data: progressData, error: progressError } = await supabase.rpc('get_interview_progress', { p_session_id: activeSessionId })
    if (progressError) {
      notifyError(progressError.message)
      setBusy(false)
      return
    }
    const progress = (progressData ?? []) as Array<{ question_id: string; score: unknown }>
    setScores(Object.fromEntries(progress.flatMap((entry) => {
      const mark = scoreMarkFromValue(entry.score)
      return mark === null ? [] : [[entry.question_id, mark]]
    })))
    setInterviewId(candidate.id)
    setInterviewSessionId(activeSessionId)
    setCandidates((current) => current.map((item) => item.id === candidate.id
      ? { ...item, interviewer: staff.display_name, status: 'In Progress' }
      : item))
    const { data: questionData, error: questionError } = await supabase.rpc('get_interview_question', { p_session_id: activeSessionId })
    if (questionError) {
      setInterviewId(null)
      setInterviewSessionId(null)
      notifyError(questionError.message)
      setBusy(false)
      return
    }
    const questionRow = Array.isArray(questionData) ? questionData[0] : questionData
    if (!questionRow) {
      setInterviewId(null)
      setInterviewSessionId(null)
      notifyError('The active interview session has no available question.')
      setBusy(false)
      return
    }
    const row = questionRow as InterviewQuestion
    setCurrentQuestion({ ...row, score: scoreMarkFromValue(row.score) })
    setQuestionIndex(row.question_number)
    setAnswerResponse(row.response ?? '')
    setWarnings(row.focus_warnings ?? 0)
    setReferenceAnswer('')
    setReferenceVisible(false)
    setSecondsLeft(90)
    setBusy(false)
  }

  useEffect(() => {
    if (!interviewSessionId) return
    const timer = window.setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [interviewSessionId, questionIndex])

  useEffect(() => {
    if (!interviewSessionId || !supabase) return
    const client = supabase
    const warn = () => {
      const now = Date.now()
      if (now - lastFocusWarning.current < 1500) return
      lastFocusWarning.current = now
      client.rpc('record_interview_focus_warning', { p_session_id: interviewSessionId }).then(({ data, error: warningError }) => {
        if (warningError) notifyError(`Could not record focus warning: ${warningError.message}`)
        else setWarnings(Number(data))
      })
    }
    const warnOnHidden = () => {
      if (document.hidden) warn()
    }
    window.addEventListener('blur', warn)
    document.addEventListener('visibilitychange', warnOnHidden)
    return () => {
      window.removeEventListener('blur', warn)
      document.removeEventListener('visibilitychange', warnOnHidden)
    }
  }, [interviewSessionId])

  const updateScore = (mark: ScoreMark) => {
    if (!currentQuestion) return
    setScores((current) => ({ ...current, [currentQuestion.id]: mark }))
  }

  const saveCurrentAnswer = async () => {
    if (!supabase || !interviewSessionId || !currentQuestion) return false
    const mark = scores[currentQuestion.id]
    const { error: saveError } = await supabase.rpc('save_interview_answer', {
      p_session_id: interviewSessionId,
      p_question_id: currentQuestion.id,
      p_response: answerResponse,
      p_score: mark === undefined ? null : String(mark),
    })
    if (saveError) {
      notifyError(saveError.message)
      return false
    }
    return true
  }

  const loadInterviewQuestion = async (activeSessionId: string) => {
    if (!supabase) return false
    const { data, error: queryError } = await supabase.rpc('get_interview_question', { p_session_id: activeSessionId })
    if (queryError) {
      notifyError(queryError.message)
      return false
    }
    const questionRow = Array.isArray(data) ? data[0] : data
    if (!questionRow) {
      notifyError('Could not load the selected interview question.')
      return false
    }
    const row = questionRow as InterviewQuestion
    setCurrentQuestion({ ...row, score: scoreMarkFromValue(row.score) })
    setQuestionIndex(row.question_number)
    setAnswerResponse(row.response ?? '')
    setWarnings(row.focus_warnings ?? 0)
    setReferenceAnswer('')
    setReferenceVisible(false)
    setSecondsLeft(90)
    return true
  }

  const moveToQuestion = async (questionNumber: number) => {
    if (!supabase || !interviewSessionId || busy) return
    setBusy(true)
    if (!await saveCurrentAnswer()) {
      setBusy(false)
      return
    }
    const { error: moveError } = await supabase.rpc('set_interview_question', {
      p_session_id: interviewSessionId,
      p_question_number: questionNumber,
    })
    if (moveError) notifyError(moveError.message)
    else await loadInterviewQuestion(interviewSessionId)
    setBusy(false)
  }

  const revealReferenceAnswer = async () => {
    if (!supabase || !interviewSessionId || !currentQuestion || busy) return
    if (referenceVisible) {
      setReferenceVisible(false)
      setReferenceAnswer('')
      return
    }
    setBusy(true)
    const { data, error: answerError } = await supabase.rpc('reveal_interview_answer', {
      p_session_id: interviewSessionId,
      p_question_id: currentQuestion.id,
    })
    setBusy(false)
    if (answerError) {
      notifyError(answerError.message)
      return
    }
    setReferenceAnswer(String(data ?? ''))
    setReferenceVisible(true)
  }

  const saveInterview = async (finish: boolean) => {
    if (!supabase || !interviewId || !interviewSessionId || busy) return
    setBusy(true)
    if (!await saveCurrentAnswer()) {
      setBusy(false)
      return
    }
    if (!finish) {
      setBusy(false)
      setInterviewId(null)
      setInterviewSessionId(null)
      setCurrentQuestion(null)
      notifySuccess('Interview progress saved securely.')
      return
    }
    const { data: finishData, error: finishError } = await supabase.rpc('finish_interview', { p_session_id: interviewSessionId })
    if (finishError) {
      notifyError(finishError.message)
      setBusy(false)
      return
    }
    const result = (Array.isArray(finishData) ? finishData[0] : finishData) as {
      status?: CandidateStatus
      scores?: Record<string, ScoreMark>
    } | null
    const { data: detailData, error: detailError } = await supabase.rpc('get_candidate_result_details')
    setBusy(false)
    if (!result?.status || !result.scores) {
      notifyError('The interview was finalized, but the server returned an invalid result payload. Refresh the roster before continuing.')
      return
    }
    if (detailError) {
      notifyError(`Interview finalized, but the per-question marks could not be loaded: ${detailError.message}`)
      return
    }
    const finalStatus = result.status
    const finalScores = result.scores ?? {}
    const finalQuestionMarks: Array<ScoreMark | null> = Array.from({ length: 15 }, () => null)
    for (const detail of detailData ?? []) {
      if (detail.candidate_id !== interviewId || detail.question_number < 1 || detail.question_number > 15) continue
      finalQuestionMarks[detail.question_number - 1] = scoreMarkFromValue(detail.score_mark)
    }
    setCandidates((current) => current.map((item) => item.id === interviewId
      ? { ...item, scores: finalScores, question_marks: finalQuestionMarks, focus_warnings: warnings, status: finalStatus, interviewer: staff?.display_name ?? item.interviewer }
      : item))
    setInterviewId(null)
    setInterviewSessionId(null)
    setCurrentQuestion(null)
    notifySuccess(`Interview finalized. Automated result: ${finalStatus}.`)
  }

  const updateStatus = async (candidate: Candidate, status: CandidateStatus) => {
    if (!supabase || !staff || !canManageCandidates(staff.role)) return
    const { error: updateError } = await supabase.from('candidates').update({ status }).eq('id', candidate.id)
    if (updateError) notifyError(updateError.message)
    else {
      setCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, status } : item))
      notifySuccess(`${candidate.name}: status updated to ${status}.`)
    }
  }

  const approveStaffApplication = async (application: StaffApplication, role: StaffMember['role']) => {
    if (!supabase || !staff || !isSeniorRole(staff.role)) return
    setStaffSaving(true)
    try {
      const { data, error: approvalError } = await supabase.rpc('approve_staff_application', {
        p_user_id: application.user_id,
        p_role: role,
      })
      if (approvalError) {
        notifyError(`Could not approve ${application.display_name}: ${approvalError.message}`)
        return
      }
      const row = (Array.isArray(data) ? data[0] : data) as StaffMember | null
      if (!row?.user_id) {
        notifyError(`The approval for ${application.display_name} returned no staff record. Refresh the staff page before retrying.`)
        return
      }
      setStaffRows((current) => [...current.filter((member) => member.user_id !== row.user_id), row].sort((a, b) => a.display_name.localeCompare(b.display_name)))
      setStaffApplications((current) => current.filter((entry) => entry.user_id !== application.user_id))
      notifySuccess(`${row.display_name} has been appointed as ${STAFF_ROLE_LABELS[row.role]}.`)
    } catch (approvalError) {
      notifyError(`Could not approve ${application.display_name}: ${errorText(approvalError)}`)
    } finally {
      setStaffSaving(false)
    }
  }

  const saveStaffMember = async (member: StaffMember) => {
    if (!supabase || !staff || !isSeniorRole(staff.role)) return
    setStaffSaving(true)
    const { data, error: updateError } = await supabase.from('staff_members')
      .update({ display_name: member.display_name.trim(), role: member.role, enabled: member.enabled })
      .eq('user_id', member.user_id)
      .select('user_id, display_name, role, enabled')
      .single()
    setStaffSaving(false)
    if (updateError) {
      notifyError(updateError.message)
      return
    }
    setStaffRows((current) => current.map((row) => row.user_id === member.user_id ? data as StaffMember : row))
    if (member.user_id === session?.user.id) setStaff(data as StaffMember)
    notifySuccess(`Staff appointment updated for ${member.display_name}.`)
  }

  const editStaffMember = (userId: string, updates: Partial<StaffMember>) => {
    setStaffRows((current) => current.map((member) => member.user_id === userId ? { ...member, ...updates } : member))
  }

  const toggleOcg = (ocg: Ocg) => setDraft((current) => ({
    ...current,
    target_ocgs: current.target_ocgs.includes(ocg)
      ? current.target_ocgs.filter((item) => item !== ocg)
      : [...current.target_ocgs, ocg],
  }))

  const addSingle = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session || !staff || !canManageCandidates(staff.role)) return
    if (!draft.name.trim() || !draft.discord.trim() || !draft.target_ocgs.length) {
      notifyError('Enter the candidate details and choose at least one OCG.')
      return
    }
    setBusy(true)
    const payload = {
      name: draft.name.trim(),
      discord: draft.discord.trim(),
      target_ocgs: draft.target_ocgs,
      interviewer: 'Not started',
      created_by: session.user.id,
      status: 'Pending' as const,
      focus_warnings: 0,
      cycle_date: today(),
    }
    const { data, error: insertError } = await supabase.from('candidates').insert(payload).select('*').single()
    setBusy(false)
    if (insertError) {
      notifyError(insertError.message)
      return
    }
    setCandidates((current) => [{ ...data, scores: {}, question_marks: [] } as Candidate, ...current])
    setShowIntake(false)
    setDraft(emptyDraft())
    notifySuccess('Candidate added to the interview roster.')
  }

  const addBatch = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session || !staff || !canManageCandidates(staff.role)) return
    const lines = batchText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (!lines.length) {
      notifyError('Paste at least one candidate row.')
      return
    }
    const parsed: Omit<Candidate, 'id' | 'created_at' | 'updated_at' | 'scores' | 'question_marks'>[] = []
    const invalid: string[] = []
    lines.forEach((line, index) => {
      const columns = line.split('|').map((part) => part.trim())
      if (columns.length !== 3) {
        invalid.push(`${index + 1}`)
        return
      }
      const [name = '', discord = '', ocgText = ''] = columns
      const target_ocgs = ocgText.split(',').map((part) => part.trim()).filter(Boolean)
      const validOcgs = target_ocgs.length > 0 && target_ocgs.every((ocg) => OCGS.includes(ocg as Ocg))
      if (!name || !discord || !validOcgs) {
        invalid.push(`${index + 1}`)
        return
      }
      parsed.push({
        name, discord, target_ocgs: [...new Set(target_ocgs as Ocg[])],
        interviewer: 'Not started',
        status: 'Pending', focus_warnings: 0,
        cycle_date: today(), created_by: session.user.id,
      })
    })
    if (invalid.length) {
      notifyError(`Rows ${invalid.join(', ')} need: Name | Discord | OCG(s). Use exact OCG names separated by commas.`)
      return
    }
    setBusy(true)
    const { data, error: insertError } = await supabase.from('candidates').insert(parsed).select('*')
    setBusy(false)
    if (insertError) {
      notifyError(insertError.message)
      return
    }
    setCandidates((current) => [...(data ?? []).map((candidate) => ({ ...candidate, scores: {}, question_marks: [] } as Candidate)), ...current])
    setShowIntake(false)
    setBatchText('')
    notifySuccess(`${parsed.length} candidate${parsed.length === 1 ? '' : 's'} added to the roster.`)
  }

  const createQuestionBatch = async (name: string, description: string, entries: Array<{ prompt: string; reference_answer: string }>) => {
    if (!supabase || !staff || !isSeniorRole(staff.role)) return false
    setQuestionSaving(true)
    const { error: createError } = await supabase.rpc('create_question_batch', {
      p_name: name.trim(),
      p_description: description.trim(),
      p_questions: entries,
    })
    if (createError) {
      setQuestionSaving(false)
      notifyError(`Could not create question batch: ${createError.message}`)
      return false
    }
    const refreshed = await loadQuestionBank()
    setQuestionSaving(false)
    if (!refreshed) return false
    notifySuccess(`Question batch "${name.trim()}" created with 15 questions.`)
    return true
  }

  const setQuestionBatchActive = async (batch: QuestionBatch, active: boolean) => {
    if (!supabase || !staff || !isSeniorRole(staff.role)) return
    setQuestionSaving(true)
    const { error: updateError } = await supabase.rpc('set_question_batch_active', {
      p_batch_id: batch.id,
      p_active: active,
    })
    if (updateError) {
      setQuestionSaving(false)
      notifyError(`Could not update batch activation: ${updateError.message}`)
      return
    }
    const refreshed = await loadQuestionBank()
    setQuestionSaving(false)
    if (!refreshed) return
    notifySuccess(`Question batch "${batch.name}" ${active ? 'activated' : 'deactivated'}.`)
  }

  const visibleCandidates = useMemo(() => candidates.filter((candidate) => {
    const matchesOcg = filterOcg === 'All' || candidate.target_ocgs.includes(filterOcg)
    const matchesStatus = filterStatus === 'All' || candidate.status === filterStatus
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || [candidate.name, candidate.discord, candidate.interviewer].some((value) => value.toLowerCase().includes(query))
    return matchesOcg && matchesStatus && matchesSearch
  }), [candidates, filterOcg, filterStatus, search])

  const evaluatedCount = candidates.filter((candidate) => !['Pending', 'In Progress'].includes(candidate.status)).length
  const counts = useMemo(() => ({
    total: candidates.length,
    pending: candidates.filter((item) => item.status === 'Pending').length,
    progress: candidates.filter((item) => item.status === 'In Progress').length,
    passed: candidates.filter((item) => item.status === 'Passed').length,
  }), [candidates])

  const downloadResultImage = (canvas: HTMLCanvasElement) => {
    try {
      const link = document.createElement('a')
      link.download = `interview-results-${today()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      supabase?.rpc('log_result_export').then(({ error: logError }) => {
        if (logError) notifyError(`Image downloaded, but the export could not be recorded: ${logError.message}`)
      })
      notifySuccess('Results image downloaded. Upload it to the Discord results channel.')
    } catch (imageError) {
      notifyError(`Could not export the result image: ${errorText(imageError)}`)
    }
  }

  const signOut = async () => {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) notifyError(signOutError.message)
    else {
      setStaff(null)
      setSession(null)
      setCandidates([])
    }
  }

  if (authLoading || (session && accessLoading)) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400"><RefreshCw className="mr-2 inline animate-spin" size={16} /> Authenticating staff access…</main>
  }
  if (!session) {
    return <SignInScreen error={authError} onSignIn={() => void signIn()} busy={busy} />
  }
  if (!staff) {
    const metadata = session.user.user_metadata
    const name = typeof metadata.global_name === 'string'
      ? metadata.global_name
      : typeof metadata.full_name === 'string'
        ? metadata.full_name
        : typeof metadata.name === 'string'
          ? metadata.name
          : typeof metadata.username === 'string'
            ? metadata.username
            : 'there'
    return <PendingAccessScreen
      displayName={name}
      requestExists={accessRequestExists}
      loading={accessLoading}
      error={accessError}
      onRefresh={() => setAccessRefresh((current) => current + 1)}
      onSignOut={() => void signOut()}
    />
  }

  const interviewCandidate = candidates.find((candidate) => candidate.id === interviewId)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <div className="pointer-events-none fixed inset-0 grid-bg opacity-25" />
      <div className="pointer-events-none fixed -right-52 -top-56 h-[550px] w-[550px] rounded-full bg-cyan-500/[.035] blur-[120px]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1500px]">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-slate-950/80 px-4 py-6 lg:flex">
          <Brand />
          <div className="mt-10 px-3 font-mono text-[10px] uppercase tracking-[.2em] text-slate-600">Operations</div>
          <nav className="mt-3 space-y-1">
            <NavButton active={view === 'overview'} icon={<Activity size={17} />} label="Overview" onClick={() => setView('overview')} />
            <NavButton active={view === 'candidates'} icon={<Users size={17} />} label="Candidates" onClick={() => setView('candidates')} count={counts.total} />
            {canManageCandidates(staff.role) && <NavButton active={view === 'results'} icon={<FileText size={17} />} label="Master results" onClick={() => setView('results')} />}
            {isSeniorRole(staff.role) && <>
              <NavButton active={view === 'questions'} icon={<BookOpen size={17} />} label="Question batches" onClick={() => setView('questions')} count={questionBatches.length} />
              <NavButton active={view === 'staff'} icon={<UserPlus size={17} />} label="Staff appointments" onClick={() => setView('staff')} count={staffApplications.length} />
              <NavButton active={view === 'audit'} icon={<History size={17} />} label="Audit & live activity" onClick={() => setView('audit')} />
            </>}
          </nav>
          {isSeniorRole(staff.role) ? <div className="mt-auto rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" /> Senior authorities online</div>
            <p className="mt-2 text-2xl font-bold text-white">{seniorOnlineCount}</p>
            <p className="mt-1 text-[11px] text-slate-500">Private live presence feed</p>
          </div> : <div className="mt-auto rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><Shield size={14} className="text-cyan-400" /> Restricted access</div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">You can interview any roster candidate; question banks, staff controls, results, and audits stay restricted.</p>
          </div>}
        </aside>
        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-slate-800/80 bg-slate-950/85 px-5 backdrop-blur-xl md:px-8">
            <div className="flex items-center gap-3">
              <div className="lg:hidden"><Brand compact /></div>
              <span className="hidden font-mono text-xs text-slate-500 sm:block">OCG / <span className="text-slate-300">{view === 'overview' ? 'OVERVIEW' : view === 'candidates' ? 'CANDIDATE ROSTER' : view === 'results' ? 'MASTER RESULTS' : view === 'staff' ? 'STAFF APPOINTMENTS' : view === 'questions' ? 'QUESTION BATCHES' : 'AUDIT & LIVE ACTIVITY'}</span></span>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1.5 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /><span className="text-xs text-slate-400">{staff.display_name}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-400">{STAFF_ROLE_LABELS[staff.role]}</span>
              </div>
              <button onClick={() => void signOut()} title="Sign out" className="rounded-lg border border-slate-800 p-2 text-slate-400 hover:border-slate-600 hover:text-white"><LogOut size={16} /></button>
            </div>
          </header>
          <nav aria-label="Main navigation" className="flex gap-1 overflow-x-auto border-b border-slate-800/80 bg-slate-950/75 px-3 py-2 lg:hidden">
            <NavButton compact active={view === 'overview'} icon={<Activity size={15} />} label="Overview" onClick={() => setView('overview')} />
            <NavButton compact active={view === 'candidates'} icon={<Users size={15} />} label="Candidates" onClick={() => setView('candidates')} />
            {canManageCandidates(staff.role) && <NavButton compact active={view === 'results'} icon={<FileText size={15} />} label="Results" onClick={() => setView('results')} />}
            {isSeniorRole(staff.role) && <NavButton compact active={view === 'questions'} icon={<BookOpen size={15} />} label="Questions" onClick={() => setView('questions')} />}
            {isSeniorRole(staff.role) && <NavButton compact active={view === 'staff'} icon={<UserPlus size={15} />} label="Staff" onClick={() => setView('staff')} />}
            {isSeniorRole(staff.role) && <NavButton compact active={view === 'audit'} icon={<History size={15} />} label="Audit" onClick={() => setView('audit')} />}
          </nav>
          <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-10">
            {(error || notice) && (
              <div role={error ? 'alert' : 'status'} className={`mb-6 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
                <span>{error || notice}</span><button aria-label="Dismiss" onClick={() => { setError(''); setNotice('') }}><X size={15} /></button>
              </div>
            )}
            {view === 'overview' && (
              <Overview
                staff={staff}
                counts={counts}
                candidates={candidates}
                busy={busy}
                loading={loading}
                canManage={canManageCandidates(staff.role)}
                onIntake={() => { setShowIntake(true); setBatchMode(false); setDraft(emptyDraft()) }}
                onViewCandidates={() => setView('candidates')}
                onInterview={(candidate) => void openInterview(candidate)}
                onRefresh={() => void loadCandidates()}
              />
            )}
            {view === 'candidates' && (
              <CandidateList
                candidates={visibleCandidates}
                filterOcg={filterOcg}
                filterStatus={filterStatus}
                search={search}
                busy={busy}
                onFilterOcg={setFilterOcg}
                onFilterStatus={setFilterStatus}
                onSearch={setSearch}
                onIntake={() => { setShowIntake(true); setBatchMode(false); setDraft(emptyDraft()) }}
                onInterview={(candidate) => void openInterview(candidate)}
                onStatus={updateStatus}
                onDelete={(candidate) => void deleteCandidate(candidate)}
                canManage={canManageCandidates(staff.role)}
              />
            )}
            {view === 'results' && (
              <Results
                candidates={visibleCandidates}
                allCount={candidates.length}
                evaluatedCount={evaluatedCount}
                filterOcg={filterOcg}
                filterStatus={filterStatus}
                search={search}
                onFilterOcg={setFilterOcg}
                onFilterStatus={setFilterStatus}
                onSearch={setSearch}
                onExport={downloadResultImage}
                onStatus={updateStatus}
              />
            )}
            {view === 'staff' && isSeniorRole(staff.role) && (
              <StaffManagement
                members={staffRows}
                applications={staffApplications}
                currentUserId={session.user.id}
                loading={staffTableLoading}
                applicationsLoading={staffApplicationsLoading}
                saving={staffSaving}
                onApprove={(application, role) => void approveStaffApplication(application, role)}
                onEdit={editStaffMember}
                onSave={(member) => void saveStaffMember(member)}
              />
            )}
            {view === 'audit' && isSeniorRole(staff.role) && (
              <AuditDashboard events={auditLogs} onlineStaff={onlineStaff} loading={auditLoading} onRefresh={() => setAuditRefresh((current) => current + 1)} />
            )}
            {view === 'questions' && isSeniorRole(staff.role) && (
              <QuestionBatchManager
                batches={questionBatches}
                questions={questionBank}
                loading={questionBankLoading}
                saving={questionSaving}
                onRefresh={() => void loadQuestionBank()}
                onCreate={createQuestionBatch}
                onToggleActive={setQuestionBatchActive}
              />
            )}
          </div>
        </section>
      </div>
      {showIntake && (
        <IntakeModal
          batchMode={batchMode}
          draft={draft}
          batchText={batchText}
          busy={busy}
          onClose={() => setShowIntake(false)}
          onBatchMode={setBatchMode}
          onDraft={setDraft}
          onBatchText={setBatchText}
          onToggleOcg={toggleOcg}
          onSingleSubmit={(event) => void addSingle(event)}
          onBatchSubmit={(event) => void addBatch(event)}
        />
      )}
      {interviewCandidate && (
        <InterviewModal
          candidate={interviewCandidate}
          question={currentQuestion}
          scores={scores}
          response={answerResponse}
          referenceAnswer={referenceAnswer}
          referenceVisible={referenceVisible}
          warnings={warnings}
          questionIndex={questionIndex}
          secondsLeft={secondsLeft}
          busy={busy}
          onClose={() => void saveInterview(false)}
          onScore={updateScore}
          onResponse={setAnswerResponse}
          onRevealAnswer={() => void revealReferenceAnswer()}
          onQuestion={(index) => void moveToQuestion(index)}
          onSave={(finish) => void saveInterview(finish)}
        />
      )}
    </main>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3">
    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><Shield size={20} /></div>
    {!compact && <div><div className="text-sm font-extrabold tracking-wide text-white">OCG <span className="text-cyan-400">OPS</span></div><div className="mt-0.5 font-mono text-[9px] uppercase tracking-[.18em] text-slate-500">Leadership command</div></div>}
  </div>
}

function NavButton({ active, icon, label, count, onClick, compact = false }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void; compact?: boolean }) {
  return <button onClick={onClick} className={`flex ${compact ? 'w-auto shrink-0' : 'w-full'} items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? 'border border-cyan-400/10 bg-cyan-400/[.08] font-semibold text-cyan-200' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}>
    {icon}<span className="flex-1">{label}</span>{count !== undefined && <span className="font-mono text-[10px] text-slate-500">{count}</span>}
  </button>
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div><p className="font-mono text-[10px] uppercase tracking-[.22em] text-cyan-500">{eyebrow}</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white">{title}</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">{description}</p></div>
    {action}
  </div>
}

function Overview({ staff, counts, candidates, busy, loading, canManage, onIntake, onViewCandidates, onInterview, onRefresh }: {
  staff: StaffMember; counts: { total: number; pending: number; progress: number; passed: number }; candidates: Candidate[]
  busy: boolean; loading: boolean; canManage: boolean; onIntake: () => void; onViewCandidates: () => void
  onInterview: (candidate: Candidate) => void; onRefresh: () => void
}) {
  const cards = [
    { label: 'Total candidates', value: counts.total, icon: <Users size={17} />, color: 'text-cyan-300' },
    { label: 'Pending', value: counts.pending, icon: <Clock3 size={17} />, color: 'text-amber-300' },
    { label: 'In progress', value: counts.progress, icon: <Activity size={17} />, color: 'text-sky-300' },
    { label: 'Passed', value: counts.passed, icon: <BadgeCheck size={17} />, color: 'text-emerald-300' },
  ]
  return <>
    <PageHeading eyebrow={`${STAFF_ROLE_LABELS[staff.role]} // command view`} title={`Good to see you, ${staff.display_name.split(' ')[0]}.`} description={staff.role === 'interviewer' ? 'Choose any candidate from the roster and conduct a secure, randomized interview.' : 'Manage the candidate pipeline, question bank, and leadership interviews.'} action={canManage ? <button className={primaryClass} onClick={onIntake}><Plus size={16} /> Add candidates</button> : undefined} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/55 p-5">
        <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-400">{card.label}</span><span className={card.color}>{card.icon}</span></div>
        <div className="mt-4 font-mono text-3xl font-medium text-white">{card.value.toString().padStart(2, '0')}</div>
      </div>)}
    </div>
    <div className="mt-8 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <section className="rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div><h2 className="text-sm font-bold text-white">Recent candidates</h2><p className="mt-1 text-xs text-slate-500">Latest additions to the interview roster</p></div>
          <button onClick={onRefresh} disabled={loading} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Refresh roster"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="divide-y divide-slate-800/70">
          {candidates.slice(0, 5).map((candidate) => <div key={candidate.id} className="flex items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-200">{candidate.name}</div><div className="mt-1 truncate text-xs text-slate-500">{candidate.target_ocgs.join(', ')} · {candidate.interviewer}</div></div>
            <div className="flex shrink-0 items-center gap-3"><StatusBadge status={candidate.status} />{candidate.status === 'Pending' && <button disabled={busy} onClick={() => onInterview(candidate)} className="hidden text-xs font-semibold text-cyan-300 hover:text-cyan-200 sm:block">Start</button>}</div>
          </div>)}
          {!candidates.length && <div className="px-5 py-12 text-center text-sm text-slate-500">{loading ? 'Loading roster…' : 'No candidates yet. Add one or import a batch to begin.'}</div>}
        </div>
        {!!candidates.length && <button onClick={onViewCandidates} className="flex w-full items-center justify-center gap-2 border-t border-slate-800 px-5 py-3 text-xs font-semibold text-slate-400 hover:text-cyan-300">View full roster <ArrowRight size={14} /></button>}
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2"><Radio size={16} className="text-emerald-400" /><h2 className="text-sm font-bold text-white">Operations status</h2></div>
        <div className="mt-5 space-y-3">
          {OCGS.map((ocg) => <div key={ocg} className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/50 px-3.5 py-3">
            <span className="text-sm text-slate-300">{ocg}</span><span className="font-mono text-xs text-slate-500">{candidates.filter((candidate) => candidate.target_ocgs.includes(ocg)).length.toString().padStart(2, '0')} candidates</span>
          </div>)}
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-cyan-500/15 bg-cyan-500/[.04] p-3 text-xs leading-5 text-slate-400"><Sparkles size={14} className="mt-0.5 shrink-0 text-cyan-400" /> Joint interviews are supported across any combination of the four OCGs.</div>
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">Command hierarchy</div>
          <div className="space-y-2">
            {(['SC Crime', 'Dep SC Crime', 'Interviewer'] as const).map((rank, index) => <div key={rank} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${index < 2 ? 'border-cyan-500/20 bg-cyan-500/[.04]' : 'border-slate-800 bg-slate-950/40'}`}><span className="text-xs text-slate-300">{rank}</span><span className="font-mono text-[9px] uppercase text-slate-500">{index < 2 ? 'Senior authority' : 'Interview access'}</span></div>)}
          </div>
        </div>
      </section>
    </div>
  </>
}

function Filters({ filterOcg, filterStatus, search, onFilterOcg, onFilterStatus, onSearch }: {
  filterOcg: 'All' | Ocg; filterStatus: 'All' | CandidateStatus; search: string
  onFilterOcg: (value: 'All' | Ocg) => void; onFilterStatus: (value: 'All' | CandidateStatus) => void; onSearch: (value: string) => void
}) {
  return <section className="mb-5 rounded-xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900/95 to-indigo-950/40 p-4 shadow-lg shadow-black/10">
    <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><Filter size={15} /></div><div><h2 className="text-sm font-bold text-white">Filter roster</h2><p className="text-[10px] text-slate-500">Narrow candidates by name, OCG, or current status</p></div></div><div className="hidden rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-slate-400 sm:block">Live filters</div></div>
    <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_220px_220px]">
      <label className="block text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Search candidate<div className="relative mt-1.5"><Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Name or interviewer…" className={`${inputClass} border-slate-700/90 pl-9`} /></div></label>
      <label className="block text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Target OCG<select value={filterOcg} onChange={(event) => onFilterOcg(event.target.value as 'All' | Ocg)} className={`${inputClass} mt-1.5 border-slate-700/90`}><option value="All">All OCGs</option>{OCGS.map((ocg) => <option key={ocg}>{ocg}</option>)}</select></label>
      <label className="block text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Candidate status<select value={filterStatus} onChange={(event) => onFilterStatus(event.target.value as 'All' | CandidateStatus)} className={`${inputClass} mt-1.5 border-slate-700/90`}><option value="All">All statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
    </div>
  </section>
}

function CandidateList({ candidates, filterOcg, filterStatus, search, busy, canManage, onFilterOcg, onFilterStatus, onSearch, onIntake, onInterview, onStatus, onDelete }: {
  candidates: Candidate[]; filterOcg: 'All' | Ocg; filterStatus: 'All' | CandidateStatus; search: string; busy: boolean
  canManage: boolean
  onFilterOcg: (value: 'All' | Ocg) => void; onFilterStatus: (value: 'All' | CandidateStatus) => void; onSearch: (value: string) => void
  onIntake: () => void; onInterview: (candidate: Candidate) => void; onStatus: (candidate: Candidate, status: CandidateStatus) => void
  onDelete: (candidate: Candidate) => void
}) {
  return <>
    <PageHeading eyebrow="Pipeline // roster" title="Candidate roster" description={canManage ? 'Review intake, track interviews, and manage the cycle.' : 'Choose any roster candidate to start or resume their interview.'} action={canManage ? <button onClick={onIntake} className={primaryClass}><Plus size={16} /> Add candidates</button> : undefined} />
    <Filters {...{ filterOcg, filterStatus, search, onFilterOcg, onFilterStatus, onSearch }} />
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm">
        <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-500"><tr>{['Candidate', 'Target OCG(s)', 'Interviewer', ...(canManage ? ['Points / 15'] : []), 'Status', 'Actions'].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800/70">
          {candidates.map((candidate) => <tr key={candidate.id} className="hover:bg-slate-900/70">
            <td className="px-4 py-4"><div className="font-semibold text-slate-200">{candidate.name}</div></td>
            <td className="px-4 py-4"><div className="flex max-w-[210px] flex-wrap gap-1">{candidate.target_ocgs.map((ocg) => <span key={ocg} className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-[10px] text-slate-300">{ocg}</span>)}</div></td>
            <td className="px-4 py-4 text-slate-400">{candidate.interviewer || 'Not started'}</td>
            {canManage && <td className="px-4 py-4 font-mono text-slate-300">{scoreLabel(candidate)}</td>}
            <td className="px-4 py-4"><StatusBadge status={candidate.status} /></td>
            <td className="px-4 py-4"><div className="flex items-center gap-2">
              {['Pending', 'In Progress'].includes(candidate.status) && <button disabled={busy} onClick={() => onInterview(candidate)} className={buttonClass}>{candidate.status === 'In Progress' ? 'Resume' : 'Start interview'}</button>}
              {canManage && <select aria-label={`Set status for ${candidate.name}`} value={candidate.status} onChange={(event) => void onStatus(candidate, event.target.value as CandidateStatus)} className="max-w-[155px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-300">{STATUSES.map((status) => <option key={status}>{status}</option>)}</select>}
              {canManage && <button type="button" disabled={busy} onClick={() => onDelete(candidate)} aria-label={`Delete ${candidate.name}`} title="Permanently delete candidate and interview records" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/[.07] text-rose-300 transition hover:border-rose-400/50 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 size={15} /></button>}
            </div></td>
          </tr>)}
          {!candidates.length && <tr><td colSpan={canManage ? 6 : 5} className="px-5 py-14 text-center text-sm text-slate-500">No candidates match these filters.</td></tr>}
        </tbody>
      </table></div>
    </div>
    <p className="mt-3 text-xs text-slate-500">Showing {candidates.length} candidate{candidates.length === 1 ? '' : 's'} · Live updates via refresh</p>
  </>
}

function Results({ candidates, allCount, evaluatedCount, filterOcg, filterStatus, search, onFilterOcg, onFilterStatus, onSearch, onExport, onStatus }: {
  candidates: Candidate[]; allCount: number; evaluatedCount: number; filterOcg: 'All' | Ocg; filterStatus: 'All' | CandidateStatus
  search: string
  onFilterOcg: (value: 'All' | Ocg) => void; onFilterStatus: (value: 'All' | CandidateStatus) => void; onSearch: (value: string) => void
  onExport: (canvas: HTMLCanvasElement) => void; onStatus: (candidate: Candidate, status: CandidateStatus) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [imageError, setImageError] = useState('')
  useEffect(() => {
    if (!canvasRef.current) return
    try {
      drawResultCard(canvasRef.current, candidates, today())
      setImageError('')
    } catch (renderError) {
      setImageError(errorText(renderError))
    }
  }, [candidates])

  return <>
    <PageHeading eyebrow="Cycle closeout // results" title="Master results" description="Review scores, individual marks for all 15 questions, and total points. Filter the roster and export a colorful Discord-ready image." action={<button onClick={() => canvasRef.current && onExport(canvasRef.current)} disabled={!!imageError || !candidates.length} className={primaryClass}><Download size={16} /> Download PNG</button>} />
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      {[['Roster', allCount], ['Evaluated', evaluatedCount], ['In this view', candidates.length]].map(([label, count]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-mono text-xl text-white">{count}</div></div>)}
    </div>
    <Filters {...{ filterOcg, filterStatus, search, onFilterOcg, onFilterStatus, onSearch }} />
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-gradient-to-r from-cyan-950 via-indigo-950 to-slate-900 text-[11px] uppercase tracking-[.15em] text-cyan-100"><tr>{['Candidate', 'Target OCG(s)', 'Interviewer', 'Points / 15', 'Set status', 'Final verdict'].map((head) => <th key={head} className="border-b border-cyan-400/20 px-5 py-4 font-extrabold">{head}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800/70">
          {candidates.map((candidate) => <tr key={candidate.id} className="hover:bg-slate-900/70">
            <td className="px-5 py-4 font-bold text-white">{candidate.name}</td>
            <td className="px-5 py-4 text-xs font-medium text-slate-300">{candidate.target_ocgs.join(', ')}</td><td className="px-5 py-4 text-xs text-slate-400">{candidate.interviewer || 'Not started'}</td>
            <td className="px-5 py-4 font-mono text-sm font-bold text-cyan-200">{scoreLabel(candidate)}</td>
            <td className="px-5 py-4"><select aria-label={`Set status for ${candidate.name}`} value={candidate.status} onChange={(event) => void onStatus(candidate, event.target.value as CandidateStatus)} className="max-w-[155px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-semibold text-slate-200">{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></td>
            <td className="px-5 py-4"><StatusBadge status={candidate.status} /></td>
          </tr>)}
          {!candidates.length && <tr><td colSpan={6} className="px-5 py-14 text-center text-sm text-slate-500">No results match these filters.</td></tr>}
        </tbody>
      </table></div>
    </div>
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><div><h2 className="text-sm font-bold text-white">Discord image preview</h2><p className="mt-1 text-xs text-slate-500">Includes Q1–Q15 marks and total points out of 15. Each SKIP counts as zero.</p></div><button onClick={() => canvasRef.current && onExport(canvasRef.current)} disabled={!!imageError || !candidates.length} className={buttonClass}><Download size={14} /> Save image</button></div>
      {imageError && <p role="alert" className="m-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{imageError}</p>}
      <div className="max-h-[640px] overflow-auto bg-slate-950/70 p-3 md:p-5"><canvas ref={canvasRef} aria-label="Discord master results image preview" className="h-auto w-full rounded-lg shadow-xl" /></div>
    </section>
  </>
}

function StaffApplicationRow({ application, saving, onApprove }: {
  application: StaffApplication
  saving: boolean
  onApprove: (application: StaffApplication, role: StaffMember['role']) => void
}) {
  const [role, setRole] = useState<StaffMember['role']>('interviewer')
  return <div className="flex flex-col gap-4 border-b border-slate-800/70 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-semibold text-slate-200">{application.display_name}</span><span className="rounded-full border border-amber-500/20 bg-amber-500/[.06] px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">Pending</span></div><div className="mt-1 break-all font-mono text-[10px] text-slate-600">{application.user_id}</div><div className="mt-1 text-[10px] text-slate-500">Requested {new Date(application.requested_at).toLocaleString()}</div></div>
    <div className="flex shrink-0 items-center gap-2"><select aria-label={`Assign role to ${application.display_name}`} value={role} onChange={(event) => setRole(event.target.value as StaffMember['role'])} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2.5 text-xs text-slate-300">{STAFF_ROLES.map((staffRole) => <option key={staffRole} value={staffRole}>{STAFF_ROLE_LABELS[staffRole]}</option>)}</select><button disabled={saving} onClick={() => onApprove(application, role)} className={primaryClass}><UserPlus size={14} /> Approve</button></div>
  </div>
}

function StaffManagement({ members, applications, currentUserId, loading, applicationsLoading, saving, onApprove, onEdit, onSave }: {
  members: StaffMember[]
  applications: StaffApplication[]
  currentUserId: string
  loading: boolean
  applicationsLoading: boolean
  saving: boolean
  onApprove: (application: StaffApplication, role: StaffMember['role']) => void
  onEdit: (userId: string, updates: Partial<StaffMember>) => void
  onSave: (member: StaffMember) => void
}) {
  return <>
    <PageHeading eyebrow="Access control // senior authority" title="Staff appointments" description="Review Discord access requests and assign staff roles here. No Supabase user lookup is needed; only SC Crime and Dep SC Crime can manage appointments." />
    <section className="mb-6 overflow-hidden rounded-xl border border-cyan-500/15 bg-slate-900/50">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><div><div className="flex items-center gap-2"><UserPlus size={16} className="text-cyan-300" /><h2 className="text-sm font-bold text-white">Access requests</h2></div><p className="mt-1 text-xs text-slate-500">Select the role and approve a verified Discord account.</p></div><span className="rounded-full border border-cyan-500/20 bg-cyan-500/[.06] px-2.5 py-1 font-mono text-xs text-cyan-200">{applications.length} waiting</span></div>
      {applications.map((application) => <StaffApplicationRow key={application.user_id} application={application} saving={saving} onApprove={onApprove} />)}
      {!applications.length && <div className="px-5 py-10 text-center text-sm text-slate-500">{applicationsLoading ? 'Loading access requests…' : 'No pending requests. New Discord signups will appear here automatically.'}</div>}
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4"><div><h2 className="text-sm font-bold text-white">Current staff</h2><p className="mt-1 text-xs text-slate-500">Updates apply immediately; disabled accounts lose portal access.</p></div><span className="font-mono text-xs text-slate-500">{members.length} accounts</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-500"><tr>{['Display name', 'Supabase User UID', 'Role', 'Enabled', ''].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800/70">
          {members.map((member) => <tr key={member.user_id} className="hover:bg-slate-900/70">
            <td className="px-4 py-3"><input aria-label={`Display name for ${member.user_id}`} value={member.display_name} maxLength={100} onChange={(event) => onEdit(member.user_id, { display_name: event.target.value })} className={`${inputClass} min-w-[160px]`} /></td>
            <td className="px-4 py-3 font-mono text-xs text-slate-500">{member.user_id}</td>
            <td className="px-4 py-3"><select aria-label={`Role for ${member.display_name}`} value={member.role} disabled={member.user_id === currentUserId} onChange={(event) => onEdit(member.user_id, { role: event.target.value as StaffMember['role'] })} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-300 disabled:opacity-50">{STAFF_ROLES.map((role) => <option key={role} value={role}>{STAFF_ROLE_LABELS[role]}</option>)}</select></td>
            <td className="px-4 py-3"><label className="inline-flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={member.enabled} disabled={member.user_id === currentUserId} onChange={(event) => onEdit(member.user_id, { enabled: event.target.checked })} className="accent-cyan-400 disabled:opacity-50" />{member.enabled ? 'Active' : 'Disabled'}</label></td>
            <td className="px-4 py-3"><button disabled={saving || !member.display_name.trim()} onClick={() => onSave(member)} className={buttonClass}>Save</button></td>
          </tr>)}
          {!members.length && <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-500">{loading ? 'Loading staff appointments…' : 'No staff appointments found.'}</td></tr>}
        </tbody>
      </table></div>
    </section>
    <p className="mt-3 text-xs leading-5 text-slate-500">For safety, you cannot change your own role or disable your own access here. Keep at least one enabled senior authority appointed.</p>
  </>
}

function AuditDashboard({ events, onlineStaff, loading, onRefresh }: {
  events: AuditEvent[]
  onlineStaff: OnlineStaffMember[]
  loading: boolean
  onRefresh: () => void
}) {
  const [actionFilter, setActionFilter] = useState('all')
  const actions = [...new Set(events.map((event) => event.action))]
  const visibleEvents = actionFilter === 'all' ? events : events.filter((event) => event.action === actionFilter)
  return <>
    <PageHeading eyebrow="Senior authority // oversight" title="Audit & live activity" description="Private senior-only view of current portal presence, page visits, candidate changes, and staff appointments." action={<button disabled={loading} onClick={onRefresh} className={buttonClass}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh audit</button>} />
    <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4"><div><h2 className="text-sm font-bold text-white">Live staff activity</h2><p className="mt-1 text-xs text-slate-500">Senior-only real-time view · active page and current task</p></div><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs text-emerald-300">{onlineStaff.length} active</span></div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {onlineStaff.map((member) => <div key={member.user_id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between gap-2"><div className="truncate text-sm font-semibold text-slate-200">{member.display_name}</div><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /></div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-cyan-300">{STAFF_ROLE_LABELS[member.role]}</div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">Page</span><span className="font-mono text-slate-300">{member.page}</span></div>
          <div className="mt-1 flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">Activity</span><span className="truncate text-right text-slate-300">{member.activity}</span></div>
        </div>)}
        {!onlineStaff.length && <p className="px-2 py-5 text-sm text-slate-500">No recent staff activity. Open staff sessions appear here when their heartbeat is received.</p>}
      </div>
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><div><h2 className="text-sm font-bold text-white">Activity history</h2><p className="mt-1 text-xs text-slate-500">Latest 250 recorded events · page visits and database changes</p></div><select aria-label="Filter audit events" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className={`${inputClass} w-auto min-w-[180px]`}><option value="all">All activity</option>{actions.map((action) => <option key={action} value={action}>{action.replaceAll('_', ' ')}</option>)}</select></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-500"><tr>{['Time', 'Staff', 'Authority', 'Page', 'Activity'].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800/70">
          {visibleEvents.map((event) => <tr key={event.id} className="hover:bg-slate-900/70">
            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{new Date(event.occurred_at).toLocaleString()}</td>
            <td className="px-4 py-3 font-semibold text-slate-200">{event.actor_name}</td>
            <td className="px-4 py-3 text-xs text-cyan-300">{STAFF_ROLE_LABELS[event.actor_role as StaffMember['role']] ?? event.actor_role}</td>
            <td className="px-4 py-3 font-mono text-xs text-slate-400">{event.page}</td>
            <td className="px-4 py-3"><div className="text-xs font-semibold text-slate-300">{event.action.replaceAll('_', ' ')}</div><div className="mt-1 text-xs text-slate-500">{event.summary}</div></td>
          </tr>)}
          {!visibleEvents.length && <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-500">{loading ? 'Loading audit history…' : 'No activity recorded for this filter yet.'}</td></tr>}
        </tbody>
      </table></div>
    </section>
    <p className="mt-3 text-xs leading-5 text-slate-600">Audit entries are append-only for portal users. Candidate answer text and private notes are never copied into the audit log.</p>
  </>
}

function QuestionBatchManager({ batches, questions, loading, saving, onRefresh, onCreate, onToggleActive }: {
  batches: QuestionBatch[]
  questions: Question[]
  loading: boolean
  saving: boolean
  onRefresh: () => void
  onCreate: (name: string, description: string, questions: Array<{ prompt: string; reference_answer: string }>) => Promise<boolean>
  onToggleActive: (batch: QuestionBatch, active: boolean) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [entries, setEntries] = useState(() => Array.from({ length: 15 }, () => ({ prompt: '', reference_answer: '' })))
  const [entryMode, setEntryMode] = useState<'manual' | 'import'>('manual')
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [importNotice, setImportNotice] = useState('')
  const activeQuestionCount = questions.filter((question) => batches.some((batch) => batch.id === question.batch_id && batch.active)).length
  const updateEntry = (index: number, field: 'prompt' | 'reference_answer', value: string) => {
    setEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || entries.some((entry) => !entry.prompt.trim() || !entry.reference_answer.trim())) return
    if (await onCreate(name, description, entries)) {
      setName('')
      setDescription('')
      setEntries(Array.from({ length: 15 }, () => ({ prompt: '', reference_answer: '' })))
      setImportText('')
      setImportNotice('')
    }
  }
  const importQuestions = () => {
    try {
      const imported = parseQuestionImport(importText)
      setEntries(imported)
      setEntryMode('manual')
      setImportError('')
      setImportNotice('Loaded 15 questions. Review or edit them below before creating the batch.')
    } catch (parseError) {
      setImportError(errorText(parseError))
      setImportNotice('')
    }
  }
  const readQuestionFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (file.size > 1_000_000) throw new Error('Question import files must be smaller than 1 MB.')
      setImportText(await file.text())
      setImportError('')
      setImportNotice(`${file.name} loaded. Choose “Load and review” to validate its questions.`)
    } catch (readError) {
      setImportError(`Could not read the selected file: ${errorText(readError)}`)
    } finally {
      event.target.value = ''
    }
  }
  return <>
    <PageHeading eyebrow="Interview engine // question security" title="Question batches" description="SC Crime and Dep SC Crime can create and activate question sets. Every batch contains exactly 15 complete questions; each interview draws 15 distinct questions at random from the combined active pool." />
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      {[['Batches', batches.length], ['Active batches', batches.filter((batch) => batch.active).length], ['Questions in active pool', activeQuestionCount]].map(([label, count]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-mono text-xl text-white">{count}</div></div>)}
    </div>
    <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2"><BookOpen size={17} className="text-cyan-300" /><h2 className="text-sm font-bold text-white">Create a 15-question batch</h2></div>
      <p className="mt-2 text-xs leading-5 text-slate-500">The reference answer is private and is only returned to the interviewer after they request it during an active interview.</p>
      <form onSubmit={submit} className="mt-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-400">Batch name<input required value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className={`${inputClass} mt-1.5`} placeholder="Leadership fundamentals — cycle 01" /></label>
          <label className="text-xs font-semibold text-slate-400">Description (optional)<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} className={`${inputClass} mt-1.5`} placeholder="Scope, difficulty, or intended group" /></label>
        </div>
        <div className="mt-4 flex rounded-lg border border-slate-800 bg-slate-950 p-1">
          <button type="button" onClick={() => { setEntryMode('manual'); setImportError('') }} className={`flex-1 rounded-md py-2 text-xs font-semibold ${entryMode === 'manual' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Enter questions</button>
          <button type="button" onClick={() => { setEntryMode('import'); setImportError('') }} className={`flex-1 rounded-md py-2 text-xs font-semibold ${entryMode === 'import' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Import 15 questions</button>
        </div>
        {entryMode === 'import' && <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <p className="text-xs leading-5 text-slate-400">Paste 15 rows or choose a CSV/TSV file. Each row must contain <code className="text-cyan-300">Question</code> and <code className="text-cyan-300">Reference answer</code>, separated by a comma or tab. A header row is optional. CSV quoted fields and embedded commas are supported.</p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            <Upload size={14} /> Choose CSV / TSV
            <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => void readQuestionFile(event)} className="sr-only" />
          </label>
          <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={7} className={`${inputClass} mt-3 resize-y font-mono text-xs`} placeholder={'Question,Reference answer\n"How do you lead a team?","Set clear priorities and follow up."\n… 14 more rows'} />
          {importError && <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{importError}</p>}
          {importNotice && <p role="status" className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[.06] p-3 text-xs text-cyan-200">{importNotice}</p>}
          <button type="button" disabled={!importText.trim()} onClick={importQuestions} className={`${buttonClass} mt-3`}><Check size={14} /> Load and review</button>
        </div>}
        {entryMode === 'manual' && <div className="mt-4 space-y-3">
          {entries.map((entry, index) => <div key={index} className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-500">Question {index + 1}<textarea required value={entry.prompt} onChange={(event) => updateEntry(index, 'prompt', event.target.value)} rows={2} maxLength={2000} className={`${inputClass} mt-1.5 resize-y`} placeholder="Enter the interview prompt" /></label>
            <label className="text-xs font-semibold text-slate-500">Reference answer<textarea required value={entry.reference_answer} onChange={(event) => updateEntry(index, 'reference_answer', event.target.value)} rows={2} maxLength={5000} className={`${inputClass} mt-1.5 resize-y`} placeholder="Enter the expected answer / grading guidance" /></label>
          </div>)}
        </div>}
        {entryMode === 'manual' && <button disabled={saving || !name.trim() || entries.some((entry) => !entry.prompt.trim() || !entry.reference_answer.trim())} className={`${primaryClass} mt-4 w-full md:w-auto`}>
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={15} />} Create batch
        </button>}
      </form>
    </section>
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-white">Existing batches</h2><button disabled={loading} onClick={onRefresh} className={buttonClass}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button></div>
      {batches.map((batch) => {
        const batchQuestions = questions.filter((question) => question.batch_id === batch.id).sort((a, b) => a.sort_order - b.sort_order)
        return <details key={batch.id} className="rounded-xl border border-slate-800 bg-slate-900/50">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0"><span className="font-semibold text-slate-100">{batch.name}</span><span className="ml-3 text-xs text-slate-500">{batchQuestions.length} questions</span>{batch.description && <p className="mt-1 text-xs text-slate-500">{batch.description}</p>}</div>
            <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${batch.active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{batch.active ? 'Active' : 'Inactive'}</span>
          </summary>
          <div className="flex justify-end border-t border-slate-800 p-3">
            <button type="button" disabled={saving || batchQuestions.length !== 15} onClick={() => onToggleActive(batch, !batch.active)} className={buttonClass}>{batch.active ? 'Deactivate' : 'Activate'}</button>
          </div>
          <div className="space-y-2 border-t border-slate-800 p-4">
            {batchQuestions.map((question) => <div key={question.id} className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3"><div className="text-xs font-semibold text-slate-200">{question.sort_order}. {question.prompt}</div><div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-500">Reference: {question.reference_answer}</div></div>)}
            {batchQuestions.length !== 15 && <p className="text-xs text-rose-300">This batch is incomplete and cannot be activated.</p>}
          </div>
        </details>
      })}
      {!batches.length && <div className="rounded-xl border border-dashed border-slate-800 px-5 py-10 text-center text-sm text-slate-500">{loading ? 'Loading question batches…' : 'No question batches yet. Create your first batch above.'}</div>}
    </section>
  </>
}


function IntakeModal({ batchMode, draft, batchText, busy, onClose, onBatchMode, onDraft, onBatchText, onToggleOcg, onSingleSubmit, onBatchSubmit }: {
  batchMode: boolean; draft: Draft; batchText: string; busy: boolean; onClose: () => void
  onBatchMode: (value: boolean) => void; onDraft: (draft: Draft) => void; onBatchText: (text: string) => void
  onToggleOcg: (ocg: Ocg) => void; onSingleSubmit: (event: FormEvent) => void; onBatchSubmit: (event: FormEvent) => void
}) {
  return <Modal onClose={onClose} labelledBy="intake-title">
    <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-cyan-500">New roster entry</p><h2 id="intake-title" className="mt-1 text-xl font-bold text-white">Candidate intake</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={17} /></button></div>
    <div className="mt-5 flex rounded-lg border border-slate-800 bg-slate-950 p-1">
      <button onClick={() => onBatchMode(false)} className={`flex-1 rounded-md py-2 text-xs font-semibold ${!batchMode ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Single candidate</button>
      <button onClick={() => onBatchMode(true)} className={`flex-1 rounded-md py-2 text-xs font-semibold ${batchMode ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Batch import</button>
    </div>
    {!batchMode ? <form onSubmit={onSingleSubmit} className="mt-5 space-y-4">
      <label className="block text-xs font-semibold text-slate-400">Candidate name<input autoFocus value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} className={`${inputClass} mt-1.5`} placeholder="Full name" maxLength={100} /></label>
      <label className="block text-xs font-semibold text-slate-400">Discord handle or ID<input value={draft.discord} onChange={(event) => onDraft({ ...draft, discord: event.target.value })} className={`${inputClass} mt-1.5`} placeholder="username or Discord user ID" maxLength={100} /></label>
      <div><div className="mb-2 text-xs font-semibold text-slate-400">Target OCG(s)</div><div className="grid grid-cols-2 gap-2">{OCGS.map((ocg) => <label key={ocg} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${draft.target_ocgs.includes(ocg) ? 'border-cyan-500/30 bg-cyan-500/[.08] text-cyan-200' : 'border-slate-800 bg-slate-950/60 text-slate-400'}`}><input type="checkbox" checked={draft.target_ocgs.includes(ocg)} onChange={() => onToggleOcg(ocg)} className="accent-cyan-400" />{ocg}</label>)}</div></div>
      <p className="text-xs leading-5 text-slate-500">The interviewer is selected when a staff member starts the interview; candidates do not need an assignment.</p>
      <button disabled={busy} className={`${primaryClass} mt-1 w-full`}>{busy ? 'Adding…' : <><Plus size={15} /> Add to roster</>}</button>
    </form> : <form onSubmit={onBatchSubmit} className="mt-5">
      <p className="text-xs leading-5 text-slate-400">Paste one candidate per line. Separate multiple OCGs with commas.</p>
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[10px] leading-5 text-slate-500">Name | Discord | OCG(s)<br />Example: Alex Doe | alex#1234 | Tambov, Kurgan</div>
      <textarea autoFocus value={batchText} onChange={(event) => onBatchText(event.target.value)} rows={8} className={`${inputClass} mt-3 resize-y font-mono text-xs`} placeholder={'Alex Doe | alex#1234 | Tambov, Kurgan'} />
      <button disabled={busy} className={`${primaryClass} mt-4 w-full`}>{busy ? 'Importing…' : <><Users size={15} /> Import {batchText.split(/\r?\n/).filter((line) => line.trim()).length || ''} candidates</>}</button>
    </form>}
  </Modal>
}

function InterviewModal({ candidate, question, scores, response, referenceAnswer, referenceVisible, warnings, questionIndex, secondsLeft, busy, onClose, onScore, onResponse, onRevealAnswer, onQuestion, onSave }: {
  candidate: Candidate; question: InterviewQuestion | null; scores: Record<string, ScoreMark>; response: string
  referenceAnswer: string; referenceVisible: boolean; warnings: number; questionIndex: number; secondsLeft: number; busy: boolean
  onClose: () => void; onScore: (mark: ScoreMark) => void; onResponse: (response: string) => void
  onRevealAnswer: () => void; onQuestion: (index: number) => void; onSave: (finish: boolean) => void
}) {
  const marks: ScoreMark[] = [1, 0.5, 0, 'SKIP']
  const currentScore = getScore(scores)
  const totalQuestions = question?.total_questions ?? 15
  const allQuestionsMarked = Object.keys(scores).length >= totalQuestions
  const selected = question ? scores[question.id] : undefined
  return <Modal onClose={onClose} labelledBy="interview-title" wide>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
      <div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-cyan-500">Live interview // {questionIndex} of {totalQuestions}</p><h2 id="interview-title" className="mt-1 text-xl font-bold text-white">{candidate.name}</h2><p className="mt-1 text-xs text-slate-500">{candidate.discord} · {candidate.target_ocgs.join(', ')}</p></div>
      <button onClick={onClose} disabled={busy} aria-label="Save and close interview" className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-50"><X size={17} /></button>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"><Clock3 size={15} className={secondsLeft <= 15 ? 'text-rose-400' : 'text-cyan-400'} /><span className={`font-mono text-sm ${secondsLeft <= 15 ? 'text-rose-300' : 'text-slate-200'}`}>00:{secondsLeft.toString().padStart(2, '0')}</span><span className="text-[10px] text-slate-500">question timer</span></div>
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${warnings >= 3 ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-amber-500/20 bg-amber-500/[.06] text-amber-300'}`}><AlertTriangle size={14} /> Focus warnings: <strong>{warnings}</strong></div>
    </div>
    {warnings > 0 && <p className="mt-2 text-[10px] text-slate-500">This counter records window focus loss while this interview is open. It does not automatically disqualify a candidate.</p>}
    {question ? <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/80 p-5 select-none" onCopy={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} draggable={false}>
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Question {questionIndex}</p>
      <p className="mt-2 text-base font-semibold leading-7 text-slate-100">{question.prompt}</p>
    </div> : <div className="mt-5 animate-pulse rounded-xl border border-slate-800 bg-slate-950/80 p-8 text-center text-sm text-slate-500">Loading secure interview question…</div>}
    <label className="mt-4 block text-xs font-semibold text-slate-400">Candidate response / interviewer notes
      <textarea value={response} onChange={(event) => onResponse(event.target.value)} disabled={busy} rows={4} maxLength={5000} className={`${inputClass} mt-1.5 resize-y`} placeholder="Record the candidate's response and interview notes…" />
    </label>
    <div className="mt-3">
      <button type="button" disabled={!question || busy} onClick={onRevealAnswer} className={buttonClass}>{referenceVisible ? <EyeOff size={14} /> : <Eye size={14} />}{referenceVisible ? 'Hide reference answer' : 'Reveal reference answer'}</button>
      {referenceVisible && <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[.06] p-4 text-sm leading-6 text-amber-100" onCopy={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}>{referenceAnswer}</div>}
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-600"><LockKeyhole size={11} /> The key is fetched only when revealed; browser controls cannot prevent screenshots or manual transcription.</p>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {marks.map((mark) => <button key={String(mark)} type="button" aria-pressed={selected === mark} disabled={busy || !question} onClick={() => onScore(mark)} className={`rounded-lg border px-3 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${selected === mark ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'}`}>
        {mark === 1 ? '1.0 · Full' : mark === 0.5 ? '0.5 · Partial' : mark === 0 ? '0.0 · Incorrect' : 'SKIP · 0.0'}
      </button>)}
    </div>
    <div className="mt-4 flex items-center justify-between gap-3">
      <button disabled={questionIndex <= 1 || busy} onClick={() => onQuestion(questionIndex - 1)} className={buttonClass}><ArrowLeft size={14} /> Previous</button>
      <div className="font-mono text-xs text-slate-500">Current points <span className="text-slate-200">{currentScore === null ? '—' : `${currentScore.toFixed(1)} / 15`}</span></div>
      <button disabled={!question || questionIndex >= totalQuestions || busy} onClick={() => onQuestion(questionIndex + 1)} className={buttonClass}>Next <ArrowRight size={14} /></button>
    </div>
    <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
      <button onClick={() => onSave(false)} disabled={busy} className={buttonClass}>Save progress</button>
      <button onClick={() => onSave(true)} disabled={busy || !question || !allQuestionsMarked} title={!allQuestionsMarked ? 'Mark each question or explicitly select SKIP before finalizing' : ''} className={primaryClass}><Check size={15} /> {busy ? 'Saving…' : 'Finish & grade'}</button>
    </div>
    <p className="mt-3 text-right text-[10px] text-slate-600">Mark all 15 questions or explicitly SKIP them to finalize. SKIP = 0 points. Thresholds: Passed ≥ 11.25/15 · Borderline ≥ 9/15 · Failed &lt; 9/15.</p>
  </Modal>
}

function Modal({ children, onClose, labelledBy, wide = false }: { children: React.ReactNode; onClose: () => void; labelledBy: string; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`my-auto max-h-[92vh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl shadow-black/50 md:p-6`}>{children}</section>
  </div>
}
