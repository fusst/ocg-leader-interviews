import type { Candidate, CandidateStatus, ScoreMark } from '../types'

export const getScore = (scores: Record<string, ScoreMark>) => {
  const marks = Object.values(scores)
  if (marks.length === 0) return null
  return marks.reduce<number>((sum, mark) => sum + (mark === 'SKIP' ? 0 : mark), 0)
}

export const gradeScore = (points: number | null): CandidateStatus => {
  if (points === null) return 'Pending'
  if (points >= 11.25) return 'Passed'
  if (points >= 9) return 'Borderline'
  return 'Failed'
}

export const resultLabel = (candidate: Candidate) => {
  if (candidate.status === 'Did Not Attend (DNA)') return 'DID NOT ATTEND'
  return candidate.status.toUpperCase()
}

export const scoreLabel = (candidate: Candidate) => {
  const points = getScore(candidate.scores ?? {})
  return points === null ? '—' : `${points.toFixed(1)} / 15 pts`
}
