import React, { useState, useEffect, useRef } from 'react';
import KeyTerms from '../components/KeyTerms';
import { QuizLayout } from '../components/QuizLayout';
import { useTimer } from '../hooks/useTimer';
import { useAutoAdvance, getSpeedRunLimit, NumPad, ResultsTable, renderFeedback } from '../App';

/**
 * MultiplyApp Component — three-level progressive multiplication trainer.
 *
 * Level 1 (Guided Random Practice):
 *   - 10 questions sampled across all tables 2–19, ordered low → high.
 *   - Adaptive extension: if all answered correctly AND avg time/question is
 *     fast, add 5 more questions. Repeats while both signals stay strong.
 *   - Caps total session at 10 + 20 extra = 30 questions max.
 *
 * Level 2 (Personalised Weak-Area Focus):
 *   - Reads per-table stats stored from prior sessions.
 *   - Suggests the user's weak tables and lets them pick a range to focus on.
 *   - Same 10-question base + adaptive 5-extension as Level 1.
 *   - Locked until the user has completed at least one Level 1 session.
 *
 * Level 3 (Rapid Fire Challenge):
 *   - Random tables, full mix.
 *   - 10-second countdown per question; timeout counts as incorrect and
 *     advances immediately.
 *   - Tracks longest streak and fastest correct answer.
 *
 * Persistent state lives in localStorage[MULT_STATS_KEY]:
 *   { tableStats: { 2: { correct, total, totalTime }, ... },
 *     hasCompletedLevel1: bool }
 *
 * @param {Object} props
 * @param {Function} props.onBack - Callback to return to home menu
 */

// Configuration knobs for the 3-level system. Centralised here so the
// development team can tune them based on user testing without hunting
// through the component body.
const MULT_TABLES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
const MULT_BASE_QUESTIONS = 10        // initial questions in Level 1 / 2
const MULT_EXTENSION_STEP = 5         // questions added per extension round
const MULT_EXTENSION_MAX = 20         // total extra questions allowed across all extensions
const MULT_FAST_AVG_SECONDS = 4       // avg time per question must be under this to extend
const MULT_LEVEL3_TIMEOUT_SECONDS = 5 // per-question timeout in rapid fire (Module 36 spec)
const MULT_STATS_KEY = 'tenali-mult-stats-v1'

/** Load persisted multiplication stats; returns a safe default on first run. */
function loadMultStats() {
  try {
    const raw = localStorage.getItem(MULT_STATS_KEY)
    if (!raw) return { tableStats: {}, hasCompletedLevel1: false }
    const parsed = JSON.parse(raw)
    return {
      tableStats: parsed.tableStats || {},
      hasCompletedLevel1: !!parsed.hasCompletedLevel1,
    }
  } catch {
    return { tableStats: {}, hasCompletedLevel1: false }
  }
}

/** Persist updated multiplication stats. Silent on failure. */
function saveMultStats(stats) {
  try { localStorage.setItem(MULT_STATS_KEY, JSON.stringify(stats)) } catch { /* ignore */ }
}

/**
 * mergeTableStat: fold a single answer into the rolling per-table stat.
 * Returns a new tableStats object (immutable update).
 */
function mergeTableStat(tableStats, table, correct, timeSec) {
  const cur = tableStats[table] || { correct: 0, total: 0, totalTime: 0 }
  return {
    ...tableStats,
    [table]: {
      correct: cur.correct + (correct ? 1 : 0),
      total: cur.total + 1,
      totalTime: cur.totalTime + timeSec,
    },
  }
}

/**
 * weakTablesFromStats: rank tables by a weakness score that combines accuracy
 * (lower = weaker) and average response time (higher = weaker). Returns the
 * tables sorted weakest-first; tables that haven't been seen yet bubble up
 * because we treat unseen as "we don't know yet — practise it".
 */
function weakTablesFromStats(tableStats) {
  return MULT_TABLES.map(t => {
    const s = tableStats[t]
    if (!s || s.total === 0) return { table: t, weakness: 1, accuracy: 0, avgTime: 0, seen: false }
    const accuracy = s.correct / s.total
    const avgTime = s.totalTime / s.total
    // Weakness ∈ [0, ~1.5]: 0 = perfect & fast, 1+ = bad accuracy and/or slow.
    // (1 - accuracy) dominates; avgTime contributes a smaller "slow" penalty.
    const weakness = (1 - accuracy) + Math.max(0, (avgTime - MULT_FAST_AVG_SECONDS) / 10)
    return { table: t, weakness, accuracy, avgTime, seen: true }
  }).sort((a, b) => b.weakness - a.weakness)
}

/**
 * buildLevel1Plan: 10 questions sampled across all tables, ordered low → high.
 *   - Picks 10 random {table, multiplier} entries with no duplicates.
 *   - Sorts by table number ascending so low tables come first.
 */
function buildLevel1Plan() {
  const pool = []
  for (const t of MULT_TABLES) {
    for (let m = 2; m <= 10; m++) pool.push({ table: t, multiplier: m })
  }
  // Fisher-Yates partial shuffle to grab the first 10 distinct entries.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const picked = pool.slice(0, MULT_BASE_QUESTIONS)
  picked.sort((a, b) => a.table - b.table || a.multiplier - b.multiplier)
  return picked
}

/**
 * buildExtensionBatch: random questions from the same source tables as the
 * existing plan. Used for the +5 rounds.
 */
function buildExtensionBatch(sourceTables, count) {
  const pool = []
  for (const t of sourceTables) for (let m = 2; m <= 10; m++) pool.push({ table: t, multiplier: m })
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}


function MultiplyApp({ onBack, markTopicCompleted, isGoalMode = false }) {
  // --- Persistent state ---
  const [stats, setStats] = useState(() => loadMultStats())
  // --- Phase: 'picker' (level chooser) | 'level2-setup' (weak-table picker) |
  //          'quiz' (any level playing) | 'finished'
  const [phase, setPhase] = useState('picker')
  const [level, setLevel] = useState(1)
  // --- Level 2 setup state ---
  const [level2RangeMin, setLevel2RangeMin] = useState(2)
  const [level2RangeMax, setLevel2RangeMax] = useState(9)
  // --- Per-session state ---
  const [plan, setPlan] = useState([])           // queued questions for level 1/2
  const [qIndex, setQIndex] = useState(0)
  const [question, setQuestion] = useState(null)
  const [answer, setAnswer] = useState('')
  const [score, setScore] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [isCorrect, setIsCorrect] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState([])
  // --- Adaptive extension tracking (Levels 1 & 2) ---
  const [extensionCount, setExtensionCount] = useState(0)  // total extra Qs added so far
  const [allCorrectInRound, setAllCorrectInRound] = useState(true)
  const [roundTotalTime, setRoundTotalTime] = useState(0)  // sum of times in current 5- or 10-batch
  const [roundQuestionsCount, setRoundQuestionsCount] = useState(0)
  // --- Source tables for the current quiz (used for extension batches) ---
  const [sourceTables, setSourceTables] = useState([])
  // --- Level 3 state ---
  const [streak, setStreak] = useState(0)
  const [longestStreak, setLongestStreak] = useState(0)
  const [fastestTime, setFastestTime] = useState(null)
  const [l3TimeRemaining, setL3TimeRemaining] = useState(MULT_LEVEL3_TIMEOUT_SECONDS)
  const [sessionGoal, setSessionGoal] = useState(isGoalMode ? 'speed' : 'standard')
  const [prevIsGoalMode, setPrevIsGoalMode] = useState(isGoalMode)
  if (prevIsGoalMode !== isGoalMode) {
    setPrevIsGoalMode(isGoalMode)
    if (!isGoalMode) {
      setSessionGoal('standard')
    }
  }
  const l3TimerRef = useRef(null)
  const l3DeadlineRef = useRef(0)
  const timer = useTimer()

  useEffect(() => {
    if (phase === 'finished') {
      const pass = results.length > 0 && (score / results.length >= 0.8)
      if (pass && markTopicCompleted) {
        if (level === 1) {
          markTopicCompleted('multiply', 'easy')
        } else if (level === 2) {
          markTopicCompleted('multiply', 'medium')
        } else if (level === 3) {
          markTopicCompleted('multiply', 'hard')
        }
      }
    }
  }, [phase, score, results.length, level, markTopicCompleted])

  // ─── Helpers ──────────────────────────────────────────────────────────
  const handleTimeout = () => {
    if (level === 3) {
      handleLevel3Timeout()
    } else {
      setIsCorrect(false)
      setRevealed(true)
      setFeedback("⏰ Time's up!")
    }
  }

  const nextQuestion = (planArr, index) => {
    const q = planArr[index]
    setQuestion({ table: q.table, multiplier: q.multiplier, prompt: `${q.table} × ${q.multiplier}` })
    setAnswer('')
    setFeedback('')
    setRevealed(false)
    setIsCorrect(null)
    timer.start(sessionGoal, handleTimeout, getSpeedRunLimit(level === 3 ? 'hard' : level === 2 ? 'medium' : 'easy', false))
    if (level === 3) startLevel3Countdown()
  }

  const startLevel3Countdown = () => {
    if (l3TimerRef.current) clearInterval(l3TimerRef.current)
    // eslint-disable-next-line react-hooks/purity
    l3DeadlineRef.current = Date.now() + MULT_LEVEL3_TIMEOUT_SECONDS * 1000
    setL3TimeRemaining(MULT_LEVEL3_TIMEOUT_SECONDS)
    l3TimerRef.current = setInterval(() => {
      const remain = Math.max(0, Math.ceil((l3DeadlineRef.current - Date.now()) / 1000))
      setL3TimeRemaining(remain)
      if (remain <= 0) {
        clearInterval(l3TimerRef.current)
        l3TimerRef.current = null
        // Timeout = wrong answer; record and advance immediately.
        handleLevel3Timeout()
      }
    }, 200)
  }

  const stopLevel3Countdown = () => {
    if (l3TimerRef.current) { clearInterval(l3TimerRef.current); l3TimerRef.current = null }
  }

  // Cleanup the Level 3 timer on unmount/phase change.
  useEffect(() => () => stopLevel3Countdown(), [])
  useEffect(() => { if (phase !== 'quiz' || level !== 3) stopLevel3Countdown() }, [phase, level])

  // ─── Level launchers ─────────────────────────────────────────────────
  const startLevel1 = () => {
    const p = buildLevel1Plan()
    setLevel(1); setPlan(p); setQIndex(0); setScore(0); setResults([])
    setExtensionCount(0); setAllCorrectInRound(true)
    setRoundTotalTime(0); setRoundQuestionsCount(0)
    setSourceTables(MULT_TABLES.slice())
    setPhase('quiz')
    nextQuestion(p, 0)
  }

  const beginLevel2Setup = () => {
    setLevel(2)
    // Default range: span the user's weakest 5–8 tables, clamped to 2..19.
    const ranked = weakTablesFromStats(stats.tableStats).map(r => r.table)
    const top = ranked.slice(0, 8).sort((a, b) => a - b)
    setLevel2RangeMin(top[0] ?? 2)
    setLevel2RangeMax(top[top.length - 1] ?? 9)
    setPhase('level2-setup')
  }

  const startLevel2Quiz = () => {
    const lo = Math.min(level2RangeMin, level2RangeMax)
    const hi = Math.max(level2RangeMin, level2RangeMax)
    const tables = MULT_TABLES.filter(t => t >= lo && t <= hi)
    if (tables.length === 0) return
    const initial = buildExtensionBatch(tables, MULT_BASE_QUESTIONS)
    initial.sort((a, b) => a.table - b.table || a.multiplier - b.multiplier)
    setPlan(initial); setQIndex(0); setScore(0); setResults([])
    setExtensionCount(0); setAllCorrectInRound(true)
    setRoundTotalTime(0); setRoundQuestionsCount(0)
    setSourceTables(tables)
    setPhase('quiz')
    nextQuestion(initial, 0)
  }

  const startLevel3 = () => {
    // For Level 3 we don't pre-build a plan — we keep generating until the
    // user exits or runs out of time on a question.
    setLevel(3); setPlan([]); setQIndex(0); setScore(0); setResults([])
    setStreak(0); setLongestStreak(0); setFastestTime(null)
    setSourceTables(MULT_TABLES.slice())
    setPhase('quiz')
    const first = buildExtensionBatch(MULT_TABLES, 1)[0]
    setPlan([first])
    nextQuestion([first], 0)
  }

  // ─── Submission paths ─────────────────────────────────────────────────
  const recordAnswer = (correct, timeTaken, q, userDisplay) => {
    setStats(prev => {
      const next = {
        ...prev,
        tableStats: mergeTableStat(prev.tableStats, q.table, correct, timeTaken),
      }
      saveMultStats(next)
      return next
    })
    setResults(prev => [...prev, {
      question: `${q.table} × ${q.multiplier}`,
      userAnswer: userDisplay,
      correctAnswer: q.table * q.multiplier,
      correct,
      time: timeTaken,
    }])
  }

  // Levels 1 & 2: standard submit/next flow with adaptive extension on round end.
  const handleSubmit = () => {
    if (!question || revealed || answer === '') return
    const timeTaken = timer.stop()
    const correctAnswer = question.table * question.multiplier
    const correct = Number(answer) === correctAnswer
    if (correct) setScore(s => s + 1)
    else setAllCorrectInRound(false)
    setRoundTotalTime(t => t + timeTaken)
    setRoundQuestionsCount(c => c + 1)
    setIsCorrect(correct); setRevealed(true)
    setFeedback(correct ? `Correct! ${question.table} × ${question.multiplier} = ${correctAnswer}`
      : `Incorrect. ${question.table} × ${question.multiplier} = ${correctAnswer}`)
    recordAnswer(correct, timeTaken, question, answer)
  }

  const handleSolve = () => {
    if (!question || revealed) return
    const timeTaken = timer.stop()
    const correctAnswer = question.table * question.multiplier
    setIsCorrect(false); setRevealed(true)
    setAllCorrectInRound(false)
    setFeedback(`Solution: ${question.table} × ${question.multiplier} = ${correctAnswer}`)
    recordAnswer(false, timeTaken, question, '—')
  }

  const advanceLevel12 = () => {
    if (qIndex + 1 < plan.length) {
      setQIndex(qIndex + 1)
      nextQuestion(plan, qIndex + 1)
      return
    }
    // End of current batch — decide whether to extend.
    const avgTime = roundQuestionsCount > 0 ? roundTotalTime / roundQuestionsCount : Infinity
    const canExtend = allCorrectInRound
      && avgTime <= MULT_FAST_AVG_SECONDS
      && extensionCount < MULT_EXTENSION_MAX
    if (canExtend) {
      const remainingBudget = MULT_EXTENSION_MAX - extensionCount
      const batchSize = Math.min(MULT_EXTENSION_STEP, remainingBudget)
      const batch = buildExtensionBatch(sourceTables, batchSize)
      const newPlan = [...plan, ...batch]
      setPlan(newPlan)
      setExtensionCount(extensionCount + batchSize)
      setAllCorrectInRound(true)
      setRoundTotalTime(0); setRoundQuestionsCount(0)
      setQIndex(qIndex + 1)
      nextQuestion(newPlan, qIndex + 1)
      return
    }
    // No extension — Mark Level 1 done if relevant, then finish.
    if (level === 1) {
      setStats(prev => {
        const next = { ...prev, hasCompletedLevel1: true }
        saveMultStats(next)
        return next
      })
    }
    setPhase('finished')
  }

  // Level 3 submission — different flow: time-limited, streak-based.
  const submitLevel3 = (rawValue) => {
    if (!question || revealed) return
    stopLevel3Countdown()
    const timeTaken = timer.stop()
    const correctAnswer = question.table * question.multiplier
    const correct = Number(rawValue) === correctAnswer
    if (correct) {
      setScore(s => s + 1)
      setStreak(s => { const n = s + 1; setLongestStreak(ls => Math.max(ls, n)); return n })
      setFastestTime(prev => prev === null ? timeTaken : Math.min(prev, timeTaken))
    } else {
      setStreak(0)
    }
    setIsCorrect(correct); setRevealed(true)
    setFeedback(correct ? `Correct! ${question.table} × ${question.multiplier} = ${correctAnswer}`
      : `Wrong. ${question.table} × ${question.multiplier} = ${correctAnswer}`)
    recordAnswer(correct, timeTaken, question, rawValue || '—')
    // Auto-advance after 700ms in Level 3 to keep the rapid-fire feel.
    setTimeout(() => advanceLevel3(), 700)
  }

  const handleLevel3Timeout = () => {
    if (!question || revealed) return
    const correctAnswer = question.table * question.multiplier
    setStreak(0)
    setIsCorrect(false); setRevealed(true)
    setFeedback(`Time! ${question.table} × ${question.multiplier} = ${correctAnswer}`)
    recordAnswer(false, MULT_LEVEL3_TIMEOUT_SECONDS, question, '(timed out)')
    setTimeout(() => advanceLevel3(), 700)
  }

  const advanceLevel3 = () => {
    const next = buildExtensionBatch(MULT_TABLES, 1)[0]
    const nextPlan = [...plan, next]
    setPlan(nextPlan)
    setQIndex(qIndex + 1)
    nextQuestion(nextPlan, qIndex + 1)
  }

  const exitLevel3 = () => {
    stopLevel3Countdown()
    setPhase('finished')
  }

  // ─── Keyboard handling ────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'quiz') return
    const onKey = (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (level === 3) {
        if (!revealed) submitLevel3(answer)
      } else {
        if (!revealed) handleSubmit()
        else advanceLevel12()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, level, revealed, answer, question, plan, qIndex, allCorrectInRound, roundTotalTime, roundQuestionsCount, extensionCount, sourceTables])

  // Auto-advance after correct answer in Levels 1 & 2 (uses standard hook).
  const advanceRef = useRef(() => { })
  // eslint-disable-next-line react-hooks/refs
  advanceRef.current = () => { if (level !== 3) advanceLevel12() }
  useAutoAdvance(revealed, advanceRef, isCorrect)

  // ─── Rendering helpers ───────────────────────────────────────────────
  const ranked = weakTablesFromStats(stats.tableStats)
  const totalQuestionsThisSession = plan.length
  const renderResetStats = () => (
    <button onClick={() => {
      const fresh = { tableStats: {}, hasCompletedLevel1: false }
      saveMultStats(fresh); setStats(fresh)
    }} style={{ background: 'transparent', border: '1px solid var(--clr-text-soft)', color: 'var(--clr-text-soft)', fontSize: '0.78rem', padding: '4px 10px' }}>
      Reset stats
    </button>
  )

  return (
    <QuizLayout title="Multiplication" subtitle="Three-level progressive trainer" onBack={onBack}>
      <div className="top-mini-row">
        {phase === 'quiz' && level !== 3 && !revealed && <div className="timer-pill">{timer.elapsed}s</div>}
        {phase === 'quiz' && level === 3 && <div className="timer-pill" style={l3TimeRemaining <= 3 ? { background: 'var(--clr-wrong)', color: '#fff' } : {}}>⏱ {l3TimeRemaining}s</div>}
        <div className="score-pill">Score: {score}{level === 3 ? ` · Streak: ${streak}` : ''}</div>
      </div>

      {/* ── Picker phase: choose a level ── */}
      {phase === 'picker' && (
        <div className="welcome-box">
          <p className="welcome-text">Choose your level</p>
          <KeyTerms topicKey="multiplication" />

        {isGoalMode && (
        <>
          <p className="welcome-text" style={{ marginTop: '14px', fontSize: '0.92rem', fontWeight: 700, marginBottom: '6px' }}>Practice Goal:</p>
                  <div className="checkbox-group" style={{ marginBottom: '12px' }}>
                    {[
                                            { key: 'speed', label: '⚡ Speed Run' },
                      { key: 'perfect', label: '🎯 Perfect Solve' },
                      { key: 'revision', label: '🔄 Revision' }
                    ].map(g => (
                      <label key={g.key} className={`checkbox-pill${sessionGoal === g.key ? ' active' : ''}`}
                        style={sessionGoal === g.key ? (
                          g.key === 'speed' ? { background: 'rgba(255,179,0,0.18)', borderColor: '#ffb300', color: '#ffb300' } :
                          g.key === 'perfect' ? { background: 'rgba(244,67,54,0.18)', borderColor: '#f44336', color: '#f44336' } :
                          g.key === 'revision' ? { background: 'rgba(33,150,243,0.18)', borderColor: '#2196f3', color: '#2196f3' } : {}
                        ) : {}}>
                        <input type="radio" name="multiplyapp-goal" checked={sessionGoal === g.key} onChange={() => {
                          setSessionGoal(g.key)
                          
                        }} />
                        {g.label}
                      </label>
                    ))}
                  </div>
        </>
      )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '12px 0' }}>
            <button onClick={startLevel1}>
              Level 1 — Guided Random Practice
              <div style={{ fontSize: '0.78rem', opacity: 0.85, marginTop: 4 }}>10 questions across all tables, low → high. Adaptive extension if you stay accurate & fast.</div>
            </button>
            <button onClick={beginLevel2Setup} disabled={!stats.hasCompletedLevel1} style={!stats.hasCompletedLevel1 ? { opacity: 0.55, cursor: 'not-allowed' } : {}}>
              Level 2 — Personalised Weak-Area Focus
              <div style={{ fontSize: '0.78rem', opacity: 0.85, marginTop: 4 }}>{stats.hasCompletedLevel1 ? 'Targets the tables you struggled with in earlier sessions.' : 'Complete Level 1 first to unlock.'}</div>
            </button>
            <button onClick={startLevel3} style={{ background: 'linear-gradient(135deg, #f44336, #ff9800)', color: '#fff', border: 'none' }}>
              Level 3 — Rapid Fire Challenge
              <div style={{ fontSize: '0.78rem', opacity: 0.95, marginTop: 4 }}>{MULT_LEVEL3_TIMEOUT_SECONDS}-second countdown per question. Build a streak.</div>
            </button>
          </div>
          {Object.keys(stats.tableStats).length > 0 && <div style={{ marginTop: '10px', textAlign: 'center' }}>{renderResetStats()}</div>}
        </div>
      )}

      {/* ── Level 2 setup: choose tables to focus on ── */}
      {phase === 'level2-setup' && (
        <div className="welcome-box">
          <p className="welcome-text">Your weakest tables</p>
          <div style={{ fontSize: '0.88rem', color: 'var(--clr-text-soft)', marginBottom: '12px' }}>
            We've ordered them weakest-first. Pick a range to practise.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 16 }}>
            {ranked.slice(0, 8).map(r => (
              <span key={r.table} className="progress-pill" style={{ background: r.seen ? `hsl(${Math.max(0, 120 - r.weakness * 100)}, 60%, 50%)` : 'var(--clr-text-soft)', color: '#fff' }}>
                {r.table}× {r.seen ? `(${Math.round(r.accuracy * 100)}% / ${r.avgTime.toFixed(1)}s)` : '— new —'}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <label>From table
              <input className="answer-input" style={{ width: 60, marginLeft: 6 }} type="number" min={2} max={19}
                value={level2RangeMin} onChange={e => { const v = Math.max(2, Math.min(19, Number(e.target.value) || 2)); setLevel2RangeMin(v) }} />
            </label>
            <label>To table
              <input className="answer-input" style={{ width: 60, marginLeft: 6 }} type="number" min={2} max={19}
                value={level2RangeMax} onChange={e => { const v = Math.max(2, Math.min(19, Number(e.target.value) || 2)); setLevel2RangeMax(v) }} />
            </label>
          </div>
          <div className="button-row">
            <button onClick={startLevel2Quiz}>Practise these</button>
            <button onClick={() => setPhase('picker')} style={{ background: 'transparent', border: '1px solid var(--clr-text-soft)', color: 'var(--clr-text-soft)' }}>Back</button>
          </div>
        </div>
      )}

      {/* ── Quiz phase (all levels) ── */}
      {phase === 'quiz' && question && <>
        <div className="progress-pill center">
          {level === 3 ? `Rapid Fire · Q${qIndex + 1}` : `Question ${qIndex + 1}/${totalQuestionsThisSession}`}
          {level !== 3 && extensionCount > 0 && ` · +${extensionCount} extension`}
        </div>
        <div className="question-box">{`${question.prompt} = ?`}</div>
        <input className="answer-input" type="text" value={answer}
          onChange={(e) => { if (!revealed) { const v = e.target.value; if (v === '' || v === '-' || /^-?\d+$/.test(v)) setAnswer(v) } }}
          disabled={revealed} placeholder="Type your answer" autoFocus />
        <NumPad value={answer} onChange={(v) => !revealed && setAnswer(v)} disabled={revealed} />
        {renderFeedback(feedback, isCorrect)}
        <div className="button-row">
          {!revealed ? <>
            <button onClick={() => level === 3 ? submitLevel3(answer) : handleSubmit()} disabled={answer === ''}>Submit</button>
            {level !== 3 && <button onClick={handleSolve} style={{ background: 'transparent', border: '1px solid var(--clr-accent)', color: 'var(--clr-accent)' }}>Solve</button>}
            {level === 3 && <button onClick={exitLevel3} style={{ background: 'transparent', border: '1px solid var(--clr-text-soft)', color: 'var(--clr-text-soft)' }}>End</button>}
          </> : (level !== 3 && <button onClick={advanceLevel12}>{qIndex + 1 >= plan.length ? 'Finish round' : 'Next Question'}</button>)}
        </div>
        {level !== 3 && <div style={{ fontSize: '0.78rem', color: 'var(--clr-text-soft)', textAlign: 'center', margin: '6px 0' }}>
          Round avg time: {roundQuestionsCount ? (roundTotalTime / roundQuestionsCount).toFixed(1) : '—'}s
          · Stay under {MULT_FAST_AVG_SECONDS}s for an extension round.
        </div>}
        {results.length > 0 && <ResultsTable results={results} />}
      </>}

      {/* ── Finished ── */}
      {phase === 'finished' && (
        <div className="welcome-box">
          <p className="welcome-text">Session complete</p>
          <p className="final-score">Final score: {score}/{results.length}</p>
          {level === 3 && (
            <div style={{ fontSize: '0.92rem', margin: '8px 0' }}>
              Longest streak: <strong>{longestStreak}</strong>
              {fastestTime !== null && <> · Fastest answer: <strong>{fastestTime.toFixed(1)}s</strong></>}
            </div>
          )}
          {level !== 3 && extensionCount > 0 && <p style={{ fontSize: '0.9rem', color: 'var(--clr-accent)' }}>You extended {extensionCount} extra questions — strong work.</p>}
          {/* Tables still needing work */}
          {(() => {
            const stillWeak = ranked.filter(r => r.seen && r.weakness >= 0.2).slice(0, 5)
            if (stillWeak.length === 0) return null
            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--clr-text-soft)', marginBottom: 6 }}>Tables that still need work:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {stillWeak.map(r => (
                    <span key={r.table} className="progress-pill" style={{ background: 'var(--clr-wrong)', color: '#fff' }}>
                      {r.table}× ({Math.round(r.accuracy * 100)}%)
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
          <ResultsTable results={results} />
          <div className="button-row" style={{ marginTop: 12 }}>
            <button onClick={() => setPhase('picker')}>Back to levels</button>
          </div>
        </div>
      )}
    </QuizLayout>
  )
}


export { MultiplyApp };
export default MultiplyApp;
