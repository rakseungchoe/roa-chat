import { useState, useEffect } from 'react'

export default function ProjectView({ project, t, tl = (k) => k, onBack, onStartChat, sessionsRev = 0, onSessionsChanged }) {
  // 메모도 서버에 있다(projects/{username}.json). project prop에 실려 오지만
  // 목록이 오래됐을 수 있어 화면 진입 시 서버 값으로 한 번 맞춘다.
  const [memo, setMemo] = useState(project.memo || '')
  const [editingMemo, setEditingMemo] = useState(false)
  const [tempMemo, setTempMemo] = useState(project.memo || '')

  // 이 프로젝트에 연결된 채팅. 연결 정보는 세션 파일의 projectId에 있다.
  // 진입 시 MRU 순서를 갱신하고, 메모 최신값을 받아 온다.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ touch: true }),
        })
        const d = await res.json()
        if (!alive || !d.success || !d.project) return
        setMemo(d.project.memo || '')
        setTempMemo(prev => (editingMemo ? prev : (d.project.memo || '')))
      } catch {}
    })()
    return () => { alive = false }
  }, [project.id])

  const [chats, setChats] = useState([])
  const [loadingChats, setLoadingChats] = useState(true)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/sessions')
        const d = await res.json()
        if (!alive) return
        setChats((d.sessions || []).filter(s => s.projectId === project.id))
      } catch { if (alive) setChats([]) }
      if (alive) setLoadingChats(false)
    })()
    return () => { alive = false }
    // sessionsRev: 사이드바에서 연결/해제/삭제가 일어나면 여기도 다시 읽는다
  }, [project.id, sessionsRev])

  const [hoveredChat, setHoveredChat] = useState(null)

  // 프로젝트에서 빼기(연결 해제)만 한다. 채팅 자체는 지워지지 않는다.
  // 예전에는 여기 ✕가 DELETE를 불러 채팅을 영구 삭제했는데, 앱의 다른 ✕들이
  // 전부 "목록에서 제거"를 뜻해 오독이 잦았다. 완전 삭제는 사이드바에서만 한다.
  // 되돌릴 수 있는 동작이라(다시 추가하면 됨) 확인 다이얼로그는 두지 않는다.
  const unlinkChat = async (e, sid) => {
    e.stopPropagation()
    setChats(prev => prev.filter(c => c.id !== sid))   // 낙관적 반영
    try {
      const res = await fetch(`/api/sessions/${sid}/project`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: null }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      onSessionsChanged?.()   // 사이드바도 같은 시점의 목록을 보게 알린다
    } catch {
      // 실패하면 서버 상태로 되돌린다
      try {
        const res = await fetch('/api/sessions')
        const d = await res.json()
        setChats((d.sessions || []).filter(s => s.projectId === project.id))
      } catch {}
    }
  }

  const saveMemo = async () => {
    setMemo(tempMemo)
    setEditingMemo(false)
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo: tempMemo }),
      })
    } catch {}
  }

  const isLight = t.isLight !== false

  const card = {
    background: t.panel,
    border: `1px solid ${t.border}`,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    boxShadow: isLight ? '0 1px 6px rgba(0,0,0,0.06)' : 'none',
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1,
      background: t.bg, padding: '32px 40px',
      scrollbarWidth: 'thin',
      scrollbarColor: `${t.scrollbar} transparent`,
    }}>
      {/* 상단 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: `1px solid ${t.border}`,
          color: t.subtext, cursor: 'pointer',
          borderRadius: 8, padding: '6px 12px', fontSize: 12,
          fontFamily: t.bodyFont,
        }}>← 뒤로</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>{project.icon}</span>
          <span style={{ fontFamily: t.titleFont, fontSize: 22, color: t.text, fontWeight: 700 }}>{project.name}</span>
        </div>
      </div>

      <div style={{ maxWidth: 700 }}>
        {/* 메모 */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontFamily: t.titleFont, fontSize: 11, color: t.accent, letterSpacing: 2 }}>◈ 프로젝트 메모</div>
            {!editingMemo
              ? <button onClick={() => { setTempMemo(memo); setEditingMemo(true) }} style={{
                  background: 'transparent', border: `1px solid ${t.border}`,
                  color: t.subtext, cursor: 'pointer', fontSize: 11,
                  borderRadius: 6, padding: '3px 10px', fontFamily: t.bodyFont,
                }}>편집</button>
              : <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={saveMemo} style={{
                    background: t.accentSoft, border: `1px solid ${t.accent}`,
                    color: t.accent, cursor: 'pointer', fontSize: 11,
                    borderRadius: 6, padding: '3px 12px', fontFamily: t.bodyFont,
                  }}>저장</button>
                  <button onClick={() => setEditingMemo(false)} style={{
                    background: 'transparent', border: `1px solid ${t.border}`,
                    color: t.subtext, cursor: 'pointer', fontSize: 11,
                    borderRadius: 6, padding: '3px 10px', fontFamily: t.bodyFont,
                  }}>취소</button>
                </div>
            }
          </div>
          {editingMemo
            ? <textarea value={tempMemo} onChange={e => setTempMemo(e.target.value)}
                style={{
                  width: '100%', minHeight: 140, resize: 'vertical',
                  background: t.inputBg, border: `1px solid ${t.border}`,
                  color: t.text, borderRadius: 8, padding: 12,
                  fontSize: 13, fontFamily: t.bodyFont, lineHeight: 1.6,
                  outline: 'none', boxSizing: 'border-box',
                }}
                placeholder="프로젝트 목표, 메모, 계획 등을 자유롭게 기록하세요..."
              />
            : <div style={{ fontSize: 13, color: memo ? t.text : t.subtextLight, lineHeight: 1.7, whiteSpace: 'pre-wrap', minHeight: 60 }}>
                {memo || '메모가 없어요. 편집을 눌러 작성하세요.'}
              </div>
          }
        </div>

        {/* 연결된 채팅 */}
        <div style={card}>
          <div style={{ fontFamily: t.titleFont, fontSize: 11, color: t.accent, letterSpacing: 2, marginBottom: 14 }}>
            ◈ {tl('project_chats')}{chats.length > 0 && ` (${chats.length})`}
          </div>
          {loadingChats
            ? <div style={{ fontSize: 13, color: t.subtextLight }}>…</div>
            : chats.length === 0
              ? <div style={{ fontSize: 13, color: t.subtextLight, lineHeight: 1.7 }}>{tl('project_chats_empty')}</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {chats.map(c => (
                    <div key={c.id} onClick={() => onStartChat(c.id)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${t.border}`, background: 'transparent',
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => { setHoveredChat(c.id); e.currentTarget.style.background = t.accentSoft }}
                      onMouseLeave={e => { setHoveredChat(null); e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: t.subtextLight }}>{c.created}</span>
                        {/* "−" = 이 프로젝트에서 빼기(연결 해제). ✕는 삭제로 읽혀서 피한다.
                            상시 옅게 보이고 카드 hover에서 또렷해진다(터치 기기 대응). */}
                        <button onClick={e => unlinkChat(e, c.id)}
                          title={tl('remove_from_project')} aria-label={`${c.title} ${tl('remove_from_project')}`}
                          style={{
                            background: 'transparent', border: `1px solid ${t.border}`, color: t.subtext,
                            fontSize: 13, lineHeight: 1, padding: '2px 7px', borderRadius: 6,
                            cursor: 'pointer', transition: 'opacity 0.2s',
                            opacity: hoveredChat === c.id ? 1 : 0.45,
                          }}>−</button>
                      </span>
                    </div>
                  ))}
                </div>
              )
          }
        </div>

        {/* Roa와 대화 시작 */}
        <div style={card}>
          <div style={{ fontFamily: t.titleFont, fontSize: 11, color: t.accent, letterSpacing: 2, marginBottom: 14 }}>◈ ROA와 대화</div>
          <div style={{ fontSize: 13, color: t.subtext, marginBottom: 16, lineHeight: 1.6 }}>
            이 프로젝트 관련 대화를 시작해요. 채팅 기록이 자동으로 저장돼요.
          </div>
          <button onClick={async () => {
            // project_id를 함께 보내야 서버가 세션 파일에 projectId를 박아 준다.
            // 예전에는 title만 보냈는데 서버가 무시해서, 여기서 시작한 채팅이
            // 프로젝트에 연결되지 않은 채 만들어졌다.
            const res = await fetch('/api/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: `${project.name} - 대화`, project_id: project.id })
            })
            const d = await res.json()
            if (d.success) onStartChat(d.session.id)
          }} style={{
            padding: '10px 24px',
            background: t.accentSoft,
            border: `1px solid ${t.accent}`,
            color: t.accent, cursor: 'pointer',
            borderRadius: 8, fontSize: 13,
            fontFamily: t.bodyFont,
            transition: 'all 0.2s',
          }}>
            + 새 채팅 시작
          </button>
        </div>
      </div>
    </div>
  )
}
