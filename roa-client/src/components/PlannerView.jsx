import { useState, useEffect } from 'react'

export default function PlannerView({ t }) {
  const [tab, setTab] = useState('todo')
  const [todos, setTodos] = useState([])
  const [schedules, setSchedules] = useState([])
  const [memos, setMemos] = useState([])

  // 할일 입력
  const [todoInput, setTodoInput] = useState('')
  // 일정 입력
  const [schedTitle, setSchedTitle] = useState('')
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState('')
  // 메모 입력
  const [memoInput, setMemoInput] = useState('')
  // 메모 편집
  const [editingMemo, setEditingMemo] = useState(null)
  const [editMemoVal, setEditMemoVal] = useState('')
  // 중복 요청 방지
  const [addingTodo, setAddingTodo] = useState(false)

  const isLight = t.isLight !== false

  useEffect(() => { loadPlanner() }, [])

  const loadPlanner = async () => {
    try {
      const res = await fetch('/api/planner')
      const d = await res.json()
      if (d.success) {
        setTodos(d.data.todos || [])
        setSchedules(d.data.schedules || [])
        setMemos(d.data.memos || [])
      }
    } catch {}
  }

  // ── 할일 ──
  const addTodo = async () => {
    const text = todoInput.trim()
    if (!text || addingTodo) return
    setAddingTodo(true)
    try {
      const res = await fetch('/api/planner/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const d = await res.json()
      if (d.success) { setTodos(prev => [d.todo, ...prev]); setTodoInput('') }
    } finally {
      setAddingTodo(false)
    }
  }

  const toggleTodo = async (id, done) => {
    await fetch(`/api/planner/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !done }),
    })
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !done } : t))
  }

  const deleteTodo = async (id) => {
    await fetch(`/api/planner/todos/${id}`, { method: 'DELETE' })
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  // ── 일정 ──
  const addSchedule = async () => {
    if (!schedTitle.trim() || !schedDate) return
    const res = await fetch('/api/planner/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: schedTitle.trim(), date: schedDate, time: schedTime }),
    })
    const d = await res.json()
    if (d.success) {
      setSchedules(prev => [...prev, d.schedule].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)))
      setSchedTitle(''); setSchedDate(''); setSchedTime('')
    }
  }

  const deleteSchedule = async (id) => {
    await fetch(`/api/planner/schedules/${id}`, { method: 'DELETE' })
    setSchedules(prev => prev.filter(s => s.id !== id))
  }

  // ── 메모 ──
  const addMemo = async () => {
    const content = memoInput.trim()
    if (!content) return
    const res = await fetch('/api/planner/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const d = await res.json()
    if (d.success) { setMemos(prev => [d.memo, ...prev]); setMemoInput('') }
  }

  const saveMemo = async (id) => {
    const content = editMemoVal.trim()
    if (!content) return
    await fetch(`/api/planner/memos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    setMemos(prev => prev.map(m => m.id === id ? { ...m, content } : m))
    setEditingMemo(null)
  }

  const deleteMemo = async (id) => {
    await fetch(`/api/planner/memos/${id}`, { method: 'DELETE' })
    setMemos(prev => prev.filter(m => m.id !== id))
  }

  const today = new Date().toISOString().slice(0, 10)

  const inputStyle = {
    flex: 1, padding: '9px 12px', borderRadius: 8,
    background: t.inputBg, border: `1px solid ${t.border}`,
    color: t.text, fontSize: 13, outline: 'none', fontFamily: t.bodyFont,
  }

  const btnPrimary = {
    padding: '9px 18px', borderRadius: 8,
    background: t.accentSoft, border: `1px solid ${t.accent}`,
    color: t.accent, cursor: 'pointer', fontSize: 13,
    fontFamily: t.bodyFont, whiteSpace: 'nowrap',
  }

  const tabStyle = (active) => ({
    padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    fontFamily: t.bodyFont, border: 'none',
    background: active ? t.accent : 'transparent',
    color: active ? (isLight ? '#fff' : t.bg) : t.subtext,
    fontWeight: active ? 700 : 400,
    transition: 'all 0.15s',
  })

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: t.bg, overflow: 'hidden',
      gridColumn: '2 / 3', gridRow: '2 / 3',
    }}>
      {/* 헤더 */}
      <div style={{
        padding: '20px 32px 0',
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0,
      }}>
        <div style={{ fontFamily: t.titleFont, fontSize: 20, color: t.accent, letterSpacing: 2, marginBottom: 16 }}>
          PLANNER
        </div>
        {/* 탭 */}
        <div style={{ display: 'flex', gap: 4, marginBottom: -1 }}>
          {[['todo', '할일'], ['schedule', '일정'], ['memo', '메모']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={tabStyle(tab === key)}>{label}</button>
          ))}
        </div>
      </div>

      {/* 컨텐츠 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', scrollbarWidth: 'thin', scrollbarColor: `${t.scrollbar} transparent` }}>

        {/* ── 할일 탭 ── */}
        {tab === 'todo' && (
          <div style={{ maxWidth: 640 }}>
            {/* 입력 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input
                value={todoInput}
                onChange={e => setTodoInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTodo()}
                placeholder="할일을 입력하세요..."
                style={inputStyle}
              />
              <button onClick={addTodo} style={btnPrimary}>추가</button>
            </div>

            {/* 미완료 */}
            {todos.filter(t => !t.done).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: t.subtext, letterSpacing: 1, marginBottom: 8, fontFamily: t.titleFont }}>할일 ({todos.filter(t => !t.done).length})</div>
                {todos.filter(t => !t.done).map(todo => (
                  <TodoItem key={todo.id} todo={todo} t={t} isLight={isLight} onToggle={toggleTodo} onDelete={deleteTodo} />
                ))}
              </div>
            )}

            {/* 완료 */}
            {todos.filter(t => t.done).length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: t.subtextLight, letterSpacing: 1, marginBottom: 8, fontFamily: t.titleFont }}>완료됨 ({todos.filter(t => t.done).length})</div>
                {todos.filter(t => t.done).map(todo => (
                  <TodoItem key={todo.id} todo={todo} t={t} isLight={isLight} onToggle={toggleTodo} onDelete={deleteTodo} />
                ))}
              </div>
            )}

            {todos.length === 0 && (
              <div style={{ textAlign: 'center', color: t.subtextLight, fontSize: 13, paddingTop: 40 }}>할일이 없어요</div>
            )}
          </div>
        )}

        {/* ── 일정 탭 ── */}
        {tab === 'schedule' && (
          <div style={{ maxWidth: 640 }}>
            {/* 입력 */}
            <div style={{
              background: t.panel, border: `1px solid ${t.border}`,
              borderRadius: 12, padding: '16px', marginBottom: 24,
            }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  value={schedTitle}
                  onChange={e => setSchedTitle(e.target.value)}
                  placeholder="일정 제목"
                  style={{ ...inputStyle, flex: 2 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="date"
                  value={schedDate}
                  onChange={e => setSchedDate(e.target.value)}
                  style={{ ...inputStyle, flex: 1, colorScheme: isLight ? 'light' : 'dark' }}
                />
                <input
                  type="time"
                  value={schedTime}
                  onChange={e => setSchedTime(e.target.value)}
                  style={{ ...inputStyle, flex: 1, colorScheme: isLight ? 'light' : 'dark' }}
                />
                <button onClick={addSchedule} style={btnPrimary}>추가</button>
              </div>
            </div>

            {/* 목록 */}
            {schedules.length === 0 && (
              <div style={{ textAlign: 'center', color: t.subtextLight, fontSize: 13, paddingTop: 20 }}>일정이 없어요</div>
            )}
            {schedules.map(s => {
              const isPast = s.date < today
              return (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 16px', borderRadius: 10, marginBottom: 8,
                  background: t.panel, border: `1px solid ${s.date === today ? t.accent : t.border}`,
                  opacity: isPast ? 0.55 : 1,
                }}>
                  <div style={{
                    width: 44, textAlign: 'center', flexShrink: 0,
                    fontFamily: t.titleFont, fontSize: 18, color: s.date === today ? t.accent : t.subtext,
                    lineHeight: 1,
                  }}>
                    <div style={{ fontSize: 10 }}>{s.date?.slice(5, 7)}월</div>
                    <div style={{ fontWeight: 700 }}>{s.date?.slice(8, 10)}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: t.text, fontWeight: 500 }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: t.subtext, marginTop: 2 }}>
                      {s.date}{s.time ? ` · ${s.time}` : ''}
                      {s.date === today && <span style={{ color: t.accent, marginLeft: 8, fontWeight: 600 }}>오늘</span>}
                    </div>
                  </div>
                  <button onClick={() => deleteSchedule(s.id)} style={{
                    background: 'transparent', border: 'none',
                    color: t.subtextLight, cursor: 'pointer', fontSize: 16, padding: 4,
                  }}>×</button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── 메모 탭 ── */}
        {tab === 'memo' && (
          <div style={{ maxWidth: 640 }}>
            {/* 입력 */}
            <div style={{ marginBottom: 20 }}>
              <textarea
                value={memoInput}
                onChange={e => setMemoInput(e.target.value)}
                placeholder="메모를 입력하세요..."
                rows={4}
                style={{
                  ...inputStyle, width: '100%', resize: 'vertical',
                  boxSizing: 'border-box', lineHeight: 1.6,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={addMemo} style={btnPrimary}>저장</button>
              </div>
            </div>

            {memos.length === 0 && (
              <div style={{ textAlign: 'center', color: t.subtextLight, fontSize: 13, paddingTop: 20 }}>메모가 없어요</div>
            )}
            {memos.map(m => (
              <div key={m.id} style={{
                background: t.panel, border: `1px solid ${t.border}`,
                borderRadius: 12, padding: '14px 16px', marginBottom: 12,
              }}>
                {editingMemo === m.id ? (
                  <>
                    <textarea
                      autoFocus
                      value={editMemoVal}
                      onChange={e => setEditMemoVal(e.target.value)}
                      rows={4}
                      style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setEditingMemo(null)} style={{
                        ...btnPrimary, background: 'transparent', border: `1px solid ${t.border}`, color: t.subtext,
                      }}>취소</button>
                      <button onClick={() => saveMemo(m.id)} style={btnPrimary}>저장</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: t.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{m.content}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: t.subtextLight }}>{m.created}</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { setEditingMemo(m.id); setEditMemoVal(m.content) }} style={{
                          background: 'transparent', border: 'none', color: t.subtext,
                          cursor: 'pointer', fontSize: 12, padding: '2px 6px',
                        }}>수정</button>
                        <button onClick={() => deleteMemo(m.id)} style={{
                          background: 'transparent', border: 'none', color: t.dangerText,
                          cursor: 'pointer', fontSize: 12, padding: '2px 6px',
                        }}>삭제</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TodoItem({ todo, t, isLight, onToggle, onDelete }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderRadius: 10, marginBottom: 6,
      background: t.panel, border: `1px solid ${t.border}`,
      opacity: todo.done ? 0.6 : 1, transition: 'opacity 0.2s',
    }}>
      <button onClick={() => onToggle(todo.id, todo.done)} style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
        border: `2px solid ${todo.done ? t.accent : t.border}`,
        background: todo.done ? t.accentSoft : 'transparent',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: t.accent, fontSize: 12, transition: 'all 0.15s',
      }}>
        {todo.done ? '✓' : ''}
      </button>
      <span style={{
        flex: 1, fontSize: 13, color: t.text,
        textDecoration: todo.done ? 'line-through' : 'none',
        fontFamily: t.bodyFont,
      }}>{todo.text}</span>
      <span style={{ fontSize: 10, color: t.subtextLight }}>{todo.created?.slice(5)}</span>
      <button onClick={() => onDelete(todo.id)} style={{
        background: 'transparent', border: 'none',
        color: t.subtextLight, cursor: 'pointer', fontSize: 16, padding: 4, lineHeight: 1,
      }}>×</button>
    </div>
  )
}
