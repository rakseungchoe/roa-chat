import { useState, useEffect, useRef } from 'react'

// 프로젝트 선택 드롭다운에 한 번에 보여줄 개수. 넘치면 "더보기"로 펼친다.
const PICKER_LIMIT = 10

export default function Sidebar({ currentSession, onSessionChange, onShowProjects, showProjects, onShowPlanner, showPlanner, onShowMeeting, showMeeting, collapsed, setCollapsed, t, tl: tlProp, messagesCount, isMobile, onClose, onLogout, onSettings, projectsRev = 0, sessionsRev = 0, onSessionsChanged, onProjectsChanged }) {
  const tl = tlProp || ((k) => k)
  const [sessions, setSessions] = useState([])
  const [chatsOpen, setChatsOpen] = useState(true)
  const [starredOpen, setStarredOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [projectPicker, setProjectPicker] = useState(null)
  const [pickerExpanded, setPickerExpanded] = useState(false)
  const [projects, setProjects] = useState([])
  const menuRef = useRef(null)
  const pickerRef = useRef(null)

  useEffect(() => { loadSessions() }, [currentSession, messagesCount, sessionsRev])

  // 프로젝트 목록은 서버에서 받는다(예전에는 localStorage).
  // projectsRev가 오르면(이관 직후 등) 다시 불러온다.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/projects', { credentials: 'include' })
        const d = await res.json()
        if (alive && d.success) setProjects(d.projects || [])
      } catch {}
    })()
    return () => { alive = false }
  }, [projectsRev])

  // 예전 연결 정보는 localStorage에만 쌓여 아무 데도 표시되지 않았다.
  // 최초 1회 서버로 옮기고 키를 지운다(없는 세션은 서버가 404로 흘려보낸다).
  useEffect(() => {
    const raw = localStorage.getItem('roa_session_projects')
    if (!raw) return
    ;(async () => {
      let map = {}
      try { map = JSON.parse(raw) || {} } catch { localStorage.removeItem('roa_session_projects'); return }
      for (const [sid, pid] of Object.entries(map)) {
        if (!pid) continue
        try {
          await fetch(`/api/sessions/${sid}/project`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: pid }),
          })
        } catch {}
      }
      localStorage.removeItem('roa_session_projects')
      loadSessions()
    })()
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null)
      // 프로젝트 선택 드롭다운도 바깥 클릭으로 닫는다
      // (예전에는 취소를 정확히 눌러야만 닫혔다)
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setProjectPicker(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadSessions = async () => {
    try {
      const res = await fetch('/api/sessions')
      const d = await res.json()
      if (d.success) setSessions(d.sessions)
    } catch {}
  }

  const newChat = async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' })
      const d = await res.json()
      if (d.success) {
        onSessionChange(d.session.id)
      }
    } catch {}
  }

  const deleteSession = async (sid) => {
    await fetch(`/api/sessions/${sid}`, { method: 'DELETE' })
    setSessions(prev => prev.filter(s => s.id !== sid))
    if (currentSession === sid) onSessionChange(null)
    setDeleteConfirm(null)
    setMenuOpen(null)
    onSessionsChanged?.()
  }

  const renameSession = async (sid) => {
    if (!renameVal.trim()) return
    await fetch(`/api/sessions/${sid}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: renameVal.trim() })
    })
    setSessions(prev => prev.map(s => s.id === sid ? { ...s, title: renameVal.trim() } : s))
    setRenaming(null)
    setRenameVal('')
  }

  const toggleStar = (sid) => {
    setSessions(prev => prev.map(s => s.id === sid ? { ...s, starred: !s.starred } : s))
    setMenuOpen(null)
  }

  // 연결 정보는 세션 파일에 저장한다. 예전에는 localStorage에만 써서 아무도
  // 읽지 않았고(= 추가해도 프로젝트 화면에 안 나타났고), 기기가 바뀌면 사라졌다.
  // projectId가 null이면 연결 해제.
  const addToProject = async (sid, projectId) => {
    setProjectPicker(null)
    setMenuOpen(null)
    setSessions(prev => prev.map(s => s.id === sid ? { ...s, projectId } : s))   // 낙관적 반영
    try {
      const res = await fetch(`/api/sessions/${sid}/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      onSessionsChanged?.()   // 프로젝트 화면 등 다른 사본도 재조회하게 알린다
    } catch {
      loadSessions()   // 실패하면 서버 상태로 되돌린다
    }
  }

  // 드롭다운에서 바로 새 프로젝트를 만들고 이 채팅을 연결한다.
  // 이름은 간단히 prompt로 받는다(생성 UI를 통째로 띄우기엔 과함).
  const createAndLink = async (sid) => {
    const name = window.prompt(tl('new_project_prompt'))?.trim()
    if (!name) { setProjectPicker(null); return }
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon: '📁' }),
      })
      const d = await res.json()
      if (!d.success || !d.project) { setProjectPicker(null); return }
      setProjects(prev => [d.project, ...prev])
      onProjectsChanged?.()                    // 프로젝트 화면 목록도 재조회
      await addToProject(sid, d.project.id)    // 닫기 + 연결 + sessionsRev 알림까지 처리
    } catch { setProjectPicker(null) }
  }

  const exportSession = async (sid, title) => {
    setMenuOpen(null)
    try {
      const res = await fetch(`/api/sessions/${sid}`)
      const d = await res.json()
      if (!d.success || !d.session?.messages) return
      const lines = d.session.messages.map(m => {
        const role = m.role === 'user' ? '나' : 'ROA'
        const time = m.time ? ` [${m.time}]` : ''
        return `[${role}]${time}\n${m.content}\n`
      })
      const text = `# ${title}\n생성: ${d.session.created || ''}\n\n` + lines.join('\n---\n\n')
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.txt`
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
  }

  // (제거됨) migrateMemory: /api/sessions/migrate 라우트가 서버에 존재하지 않아
  // 항상 404가 나던 죽은 기능이었다 (서버의 대응 함수도 함께 제거됨).

  const isLight = t.isLight !== false

  const NavIcons = {
    projects: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    ),
    planner: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
    // 채팅 입력창의 마이크 버튼과 헷갈리지 않도록 파형(waveform) 모양을 쓴다.
    // (마이크 = 지금 말하기, 파형 = 저장된 녹음 기록)
    record: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="10" x2="4" y2="14"/>
        <line x1="8" y1="6" x2="8" y2="18"/>
        <line x1="12" y1="3" x2="12" y2="21"/>
        <line x1="16" y1="7" x2="16" y2="17"/>
        <line x1="20" y1="11" x2="20" y2="13"/>
      </svg>
    ),
    settings: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  }

  const navItem = (iconKey, label, onClick, active) => (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 8,
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: '100%',
        minHeight: 36,
        height: 36,
        padding: collapsed ? '0' : '0 12px',
        borderRadius: 8,
        border: 'none',
        cursor: 'pointer',
        background: active ? t.accentSoft : 'transparent',
        color: active ? t.accent : t.subtext,
        fontSize: 13,
        marginBottom: 2,
        transition: 'background 0.15s, color 0.15s',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
        flexShrink: 0,
        outline: 'none',
        pointerEvents: 'auto',
        fontWeight: active ? 500 : 400,
      }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; e.currentTarget.style.color = t.text } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.subtext } }}
    >
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, opacity: active ? 1 : 0.7 }}>
        {NavIcons[iconKey]}
      </span>
      {!collapsed && <span style={{ fontFamily: t.bodyFont, fontSize: 13 }}>{label}</span>}
    </button>
  )

  const starred = sessions.filter(s => s.starred)
  const normal = sessions.filter(s => !s.starred)

  const renderSession = (s) => (
    <div key={s.id} style={{ position: 'relative', marginBottom: 0 }}
      onMouseEnter={e => {
        const btn = e.currentTarget.querySelector('.menu-btn')
        if (btn) btn.style.opacity = '1'
      }}
      onMouseLeave={e => {
        const btn = e.currentTarget.querySelector('.menu-btn')
        if (btn && menuOpen !== s.id) btn.style.opacity = '0'
      }}
    >
      {renaming === s.id ? (
        <div style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
          <input autoFocus value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') renameSession(s.id)
              if (e.key === 'Escape') setRenaming(null)
            }}
            style={{
              flex: 1, fontSize: 12, padding: '5px 8px',
              background: t.inputBg, border: `1px solid ${t.accent}`,
              color: t.text, borderRadius: 6, outline: 'none', fontFamily: t.bodyFont,
            }}
          />
          <button onClick={() => renameSession(s.id)} style={{
            background: t.accentSoft, border: `1px solid ${t.accent}`,
            color: t.accent, borderRadius: 5, padding: '0 8px', cursor: 'pointer', fontSize: 12,
          }}>✓</button>
        </div>
      ) : (
        <div onClick={() => onSessionChange(s.id)} style={{
          padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: currentSession === s.id ? t.accentSoft : 'transparent',
          transition: 'background 0.15s',
        }}
          onMouseEnter={e => { if (currentSession !== s.id) e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)' }}
          onMouseLeave={e => { if (currentSession !== s.id) e.currentTarget.style.background = 'transparent' }}
        >
          <div style={{ flex: 1, overflow: 'hidden', marginRight: 4 }}>
            <div style={{
              fontSize: 13, color: currentSession === s.id ? t.accent : t.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              display: 'flex', alignItems: 'center', gap: 4,
              fontWeight: currentSession === s.id ? 500 : 400,
            }}>
              {s.starred && <span style={{ fontSize: 9, color: '#f59e0b' }}>★</span>}
              {s.title}
            </div>
            <div style={{ fontSize: 11, color: t.subtextLight, marginTop: 1 }}>{s.created?.slice(5)}</div>
          </div>
          <button className="menu-btn"
            onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === s.id ? null : s.id) }}
            style={{
              background: 'transparent', border: 'none',
              color: t.subtext, fontSize: 14, padding: '2px 4px',
              cursor: 'pointer', flexShrink: 0, opacity: 0,
              transition: 'opacity 0.15s', borderRadius: 4, lineHeight: 1,
            }}
          >···</button>
        </div>
      )}

      {menuOpen === s.id && (
        <div ref={menuRef} style={{
          position: 'absolute', right: 0, top: '100%',
          background: t.panel, border: `1px solid ${t.border}`,
          borderRadius: 10, padding: '4px 0', zIndex: 100, minWidth: 170,
          boxShadow: isLight ? '0 4px 16px rgba(0,0,0,0.12)' : '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          {[
            {
              icon: s.starred ? '★' : '☆',
              label: s.starred ? tl('star_remove') : tl('star_add'),
              action: () => toggleStar(s.id)
            },
            {
              // 연결 여부에 따라 라벨만 달라진다. 동작은 같다(선택 드롭다운 열기).
              label: s.projectId ? tl('change_project') : tl('add_to_project'),
              action: () => { setPickerExpanded(false); setProjectPicker(s.id); setMenuOpen(null) }
            },
            // "제거"는 드롭다운 안에 숨기지 않고 메뉴 최상위에 둔다.
            // (예전에는 빼려면 "추가"를 눌러야 하는 동선이었다)
            ...(s.projectId ? [{
              label: tl('remove_from_project'),
              action: () => addToProject(s.id, null)
            }] : []),
            {
              label: tl('rename'),
              action: () => { setRenameVal(s.title); setRenaming(s.id); setMenuOpen(null) }
            },
            {
              label: tl('export_txt'),
              action: () => exportSession(s.id, s.title)
            },
          ].map(item => (
            <div key={item.label} onClick={item.action} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px', cursor: 'pointer',
              fontSize: 13, color: t.text, transition: 'background 0.1s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = t.accentSoft}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span>{item.label}</span>
            </div>
          ))}
          <div style={{ height: 1, background: t.border, margin: '4px 0' }} />
          <div onClick={() => { setDeleteConfirm(s.id); setMenuOpen(null) }} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 14px', cursor: 'pointer',
            fontSize: 13, color: t.dangerText, transition: 'background 0.1s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = isLight ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span>{tl('delete')}</span>
          </div>
        </div>
      )}

      {projectPicker === s.id && (
        <div ref={pickerRef} style={{
          position: 'absolute', right: 0, top: '100%',
          background: t.panel, border: `1px solid ${t.border}`,
          borderRadius: 10, padding: '4px 0', zIndex: 100, minWidth: 170,
          boxShadow: isLight ? '0 4px 16px rgba(0,0,0,0.12)' : '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          <div style={{ padding: '6px 14px 4px', fontSize: 11, color: t.subtextLight, letterSpacing: 0.5 }}>{tl('select_project')}</div>
          {projects.length === 0
            ? <div style={{ padding: '8px 14px', fontSize: 12, color: t.subtextLight }}>{tl('no_projects')}</div>
            : (pickerExpanded ? projects : projects.slice(0, PICKER_LIMIT)).map(p => (
              <div key={p.id} onClick={() => addToProject(s.id, p.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: t.text,
              }}
                onMouseEnter={e => e.currentTarget.style.background = t.accentSoft}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span>{p.icon}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                {/* 현재 연결된 프로젝트 표시 — 없으면 바꾼 뒤에도 화면이 똑같아 보인다 */}
                {s.projectId === p.id && <span style={{ color: t.accent, flexShrink: 0 }}>✓</span>}
              </div>
            ))
          }
          {!pickerExpanded && projects.length > PICKER_LIMIT && (
            <div onClick={e => { e.stopPropagation(); setPickerExpanded(true) }} style={{
              padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: t.subtext,
            }}
              onMouseEnter={e => e.currentTarget.style.background = t.accentSoft}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{tl('show_more')(projects.length - PICKER_LIMIT)}</div>
          )}
          <div style={{ height: 1, background: t.border, margin: '4px 0' }} />
          <div onClick={() => createAndLink(s.id)} style={{
            padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: t.accent,
          }}
            onMouseEnter={e => e.currentTarget.style.background = t.accentSoft}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >{tl('create_project_menu')}</div>
          <div style={{ height: 1, background: t.border, margin: '4px 0' }} />
          <div onClick={() => setProjectPicker(null)} style={{
            padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: t.subtext,
          }}
            onMouseEnter={e => e.currentTarget.style.background = t.accentSoft}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >{tl('cancel')}</div>
        </div>
      )}

      {deleteConfirm === s.id && (
        <div onClick={e => e.stopPropagation()} style={{
          margin: '2px 4px 4px', padding: '10px 12px',
          background: isLight ? '#fff5f5' : 'rgba(239,68,68,0.07)',
          border: `1px solid rgba(239,68,68,0.3)`,
          borderRadius: 8, fontSize: 12,
        }}>
          <div style={{ color: t.text, marginBottom: 8, fontFamily: t.bodyFont }}>{tl('delete_confirm')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => deleteSession(s.id)} style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: `1px solid ${t.dangerText}`,
              background: 'rgba(239,68,68,0.1)',
              color: t.dangerText, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>{tl('yes')}</button>
            <button onClick={() => setDeleteConfirm(null)} style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: `1px solid ${t.border}`,
              background: 'transparent',
              color: t.text, cursor: 'pointer', fontSize: 12,
            }}>{tl('no')}</button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div style={{
      background: t.sidebar, borderRight: `1px solid ${t.sidebarBorder}`,
      display: 'flex', flexDirection: 'column',
      overflowX: 'hidden', overflowY: 'hidden',
      position: 'relative', zIndex: 30,
      pointerEvents: 'auto',
      width: isMobile ? 280 : (collapsed ? 52 : 240),
      transition: isMobile ? 'none' : 'width 0.25s ease',
      height: '100%',
      paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0,
    }}>
      {/* 헤더 */}
      {isMobile ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: `1px solid ${t.sidebarBorder}`, flexShrink: 0,
        }}>
          <span style={{ fontFamily: t.titleFont, fontSize: 16, color: t.accent, letterSpacing: 3, fontWeight: 700 }}>ROA</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onLogout && (
              <button onClick={onLogout} style={{
                background: 'transparent', border: `1px solid ${t.dangerBorder}`,
                color: t.dangerText, cursor: 'pointer', borderRadius: 6,
                padding: '0 12px', height: 32,
                fontSize: 10, fontFamily: t.titleFont, letterSpacing: 1,
                WebkitTapHighlightColor: 'transparent',
              }}>⊘ LOGOUT</button>
            )}
            <button onClick={onClose} style={{
              background: 'transparent', border: `1px solid ${t.sidebarBorder}`,
              color: t.subtext, cursor: 'pointer', borderRadius: 6,
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
              WebkitTapHighlightColor: 'transparent',
            }}>✕</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCollapsed(p => !p)}
          style={{
            display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: collapsed ? '0' : '0 14px',
            width: '100%',
            minHeight: 52,
            background: 'transparent', border: 'none',
            borderBottom: `1px solid ${t.sidebarBorder}`,
            flexShrink: 0, cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {!collapsed && (
            <span style={{ fontFamily: t.titleFont, fontSize: 16, color: t.accent, letterSpacing: 3, fontWeight: 700 }}>ROA</span>
          )}
          <span style={{
            color: t.subtext, fontSize: 16, lineHeight: 1,
            opacity: collapsed ? 0.7 : 0.4,
          }}>
            {collapsed ? '›' : '‹'}
          </span>
        </button>
      )}

      {/* 새 채팅 버튼 */}
      <div style={{
        padding: collapsed ? '8px 0' : '10px 10px 6px',
        flexShrink: 0, width: '100%', pointerEvents: 'auto',
      }}>
        <button onClick={newChat} style={{
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 8,
          padding: collapsed ? '0' : '0 12px',
          width: '100%',
          minHeight: 36,
          height: 36,
          background: t.accentSoft,
          border: 'none',
          color: t.accent, cursor: 'pointer',
          borderRadius: 8,
          fontSize: 13, fontFamily: t.bodyFont,
          transition: 'opacity 0.15s, background 0.15s',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          outline: 'none',
          pointerEvents: 'auto',
          fontWeight: 500,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = isLight ? 'rgba(99,102,241,0.14)' : 'rgba(0,245,255,0.15)' }}
          onMouseLeave={e => { e.currentTarget.style.background = t.accentSoft }}
        >
          <span style={{ fontSize: collapsed ? 18 : 16, lineHeight: 1, fontWeight: 300 }}>+</span>
          {!collapsed && <span>{tl('new_chat')}</span>}
        </button>
      </div>

      {/* 네비게이션 메뉴 */}
      <div style={{ padding: collapsed ? '0' : '0 10px 4px', flexShrink: 0, width: '100%', pointerEvents: 'auto' }}>
        {navItem('projects', tl('nav_projects'), () => { onShowProjects(); isMobile && onClose?.() }, showProjects)}
        {navItem('planner', tl('nav_planner'), () => { onShowPlanner(); isMobile && onClose?.() }, showPlanner)}
        {onShowMeeting && navItem('record', tl('nav_record'), () => { onShowMeeting(); isMobile && onClose?.() }, showMeeting)}
        {onSettings && navItem('settings', tl('settings'), () => { onSettings(); isMobile && onClose?.() }, false)}
      </div>

      {/* 구분선 */}
      <div style={{ height: 1, background: t.sidebarBorder, margin: collapsed ? '4px 0' : '4px 10px', flexShrink: 0 }} />

      {/* 모바일: 섹션 레이블 */}
      {isMobile && (
        <div style={{ padding: '6px 14px 2px', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: t.subtextLight }}>
            {tl('recent_history')}
          </span>
        </div>
      )}

      {/* 채팅 목록 */}
      {!collapsed && (
        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${t.scrollbar} transparent` }}>

          {/* 즐겨찾기 섹션 */}
          {starred.length > 0 && (
            <>
              <div onClick={() => setStarredOpen(p => !p)} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px 4px', fontSize: 10, color: t.subtextLight,
                cursor: 'pointer', userSelect: 'none',
                textTransform: 'uppercase', letterSpacing: 0.8,
              }}>
                <span>★ {tl('starred_label')}</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>{starredOpen ? '▾' : '▸'}</span>
              </div>
              {starredOpen && <div style={{ padding: '0 6px 4px' }}>{starred.map(renderSession)}</div>}
              <div style={{ height: 1, background: t.sidebarBorder, margin: '4px 10px' }} />
            </>
          )}

          {/* 최근 항목 */}
          <div onClick={() => setChatsOpen(p => !p)} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px 4px', fontSize: 10, color: t.subtextLight,
            cursor: 'pointer', userSelect: 'none',
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>
            <span>{tl('recent_label')}</span>
            <span style={{ fontSize: 9, opacity: 0.6 }}>{chatsOpen ? '▾' : '▸'}</span>
          </div>

          {chatsOpen && (
            <div style={{ padding: '0 6px 8px' }}>
              {normal.length === 0 && <div style={{ fontSize: 11, color: t.subtextLight, padding: '6px 10px' }}>{tl('no_chats')}</div>}
              {normal.map(renderSession)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
