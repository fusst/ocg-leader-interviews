import type { CandidateStatus } from '../types'

const styles: Record<CandidateStatus, string> = {
  Pending: 'border-slate-700 bg-slate-800/70 text-slate-300',
  'In Progress': 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  Passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  Borderline: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  Failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  Disqualified: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  'Did Not Attend (DNA)': 'border-slate-500/30 bg-slate-500/10 text-slate-400',
}

export default function StatusBadge({ status }: { status: CandidateStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${styles[status]}`}>
      {status === 'Did Not Attend (DNA)' ? 'DNA' : status}
    </span>
  )
}
