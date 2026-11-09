export const OCGS = ['Tambov', 'Kurgan', 'Orekhov', 'Caucasian'] as const
export type Ocg = (typeof OCGS)[number]

export const STATUSES = [
  'Pending',
  'In Progress',
  'Passed',
  'Borderline',
  'Failed',
  'Disqualified',
  'Did Not Attend (DNA)',
] as const
export type CandidateStatus = (typeof STATUSES)[number]
export type ScoreMark = 0 | 0.5 | 1 | 'SKIP'
export const STAFF_ROLES = ['sc_crime', 'dep_sc_crime', 'interviewer'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  sc_crime: 'SC Crime',
  dep_sc_crime: 'Dep SC Crime',
  interviewer: 'Interviewer',
}

export const isSeniorRole = (role: StaffRole) => role === 'sc_crime' || role === 'dep_sc_crime'
export const canManageCandidates = (role: StaffRole) => role !== 'interviewer'

export interface Candidate {
  id: string
  name: string
  discord: string
  target_ocgs: Ocg[]
  interviewer: string
  status: CandidateStatus
  scores: Record<string, ScoreMark>
  question_marks: Array<ScoreMark | null>
  focus_warnings: number
  cycle_date: string
  created_at: string
  updated_at: string
  created_by: string
}

export interface StaffMember {
  user_id: string
  display_name: string
  role: StaffRole
  enabled: boolean
}

export interface StaffApplication {
  user_id: string
  display_name: string
  requested_at: string
}

export interface AuditEvent {
  id: number
  actor_user_id: string
  actor_name: string
  actor_role: StaffRole
  page: string
  action: string
  summary: string
  candidate_id: string | null
  target_user_id: string | null
  occurred_at: string
}

export interface OnlineStaffMember {
  user_id: string
  display_name: string
  role: StaffRole
  page: string
  activity: string
  online_at: string
}

export interface Question {
  id: string
  batch_id: string
  prompt: string
  reference_answer: string
  sort_order: number
}

export interface QuestionBatch {
  id: string
  name: string
  description: string
  active: boolean
  created_at: string
  created_by: string
}

export interface InterviewQuestion extends Omit<Question, 'reference_answer'> {
  question_number: number
  total_questions: number
  response: string
  score: ScoreMark | null
  focus_warnings: number
}
