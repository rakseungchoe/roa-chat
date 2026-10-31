import { useState, useEffect } from 'react'

// 프로젝트는 서버(projects/{username}.json)에 저장된다.
// projectsRev가 바뀌면 다시 불러온다 — 이관 직후 최신 목록을 반영하기 위해서다.
export default function ProjectsMain({ t, onOpenProject, projectsRev = 0 }) {
  const [projects, setProjects] = useState([])
  const [creating, setCreating] = useState(false)
  const [hoveredId, setHoveredId] = useState(null)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const load = async () => {
    try {
      const res = await fetch('/api/projects', { credentials: 'include' })
      const d = await res.json()
      if (d.success) setProjects(d.projects || [])
    } catch {}
  }
  useEffect(() => { load() }, [projectsRev])

  const createProject = async () => {
    if (!newName.trim()) return
    const name = newName.trim(), desc = newDesc.trim()
    setNewName(''); setNewDesc(''); setCreating(false)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, desc, icon: '📁' }),
      })
      const d = await res.json()
      if (d.success && d.project) setProjects(prev => [d.project, ...prev])
    } catch {}
  }

  const deleteProject = async (e, id) => {
    e.stopPropagation()
    if (!window.confirm('프로젝트를 삭제할까요?\n연결된 채팅은 지워지지 않고 연결만 해제돼요.')) return
    setProjects(prev => prev.filter(p => p.id !== id))   // 낙관적 반영
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE', credentials: 'include' })
    } catch { load() }
  }

  const isLight = t.isLight !== false

  return (
    <div style={{
      flex: 1, overflowY: 'auto', zIndex: 1, position: 'relative',
      background: t.bg, padding: '40px 48px',
      scrollbarWidth: 'thin', scrollbarColor: `${t.scrollbar} transparent`,
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h2 style={{ fontFamily: t.titleFont, fontSize: 22, color: t.text, fontWeight: 700, margin: 0, letterSpacing: 1 }}>
          프로젝트
        </h2>
        <button onClick={() => setCreating(true)} style={{
          padding: '9px 20px',
          background: t.accent, border: 'none',
          color: t.bg === '#f5f6fa' ? '#fff' : '#000',
          fontFamily: t.bodyFont, fontSize: 13, fontWeight: 600,
          borderRadius: 8, cursor: 'pointer',
          transition: 'opacity 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >+ 새 프로젝트</button>
      </div>

      {/* 새 프로젝트 생성 카드 */}
      {creating && (
        <div style={{
          background: t.panel, border: `1px solid ${t.accent}`,
          borderRadius: 12, padding: 24, marginBottom: 24,
          boxShadow: isLight ? '0 2px 12px rgba(0,0,0,0.08)' : 'none',
        }}>
          <div style={{ fontSize: 14, color: t.text, fontWeight: 600, marginBottom: 16 }}>새 프로젝트 만들기</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="프로젝트 이름 *"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && createProject()}
              style={{
                padding: '10px 14px', background: t.inputBg,
                border: `1px solid ${t.border}`, borderRadius: 8,
                color: t.text, fontSize: 13, fontFamily: t.bodyFont, outline: 'none',
              }}
            />
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="목표, 주제, 설명 (선택)"
              rows={3}
              style={{
                padding: '10px 14px', background: t.inputBg,
                border: `1px solid ${t.border}`, borderRadius: 8,
                color: t.text, fontSize: 13, fontFamily: t.bodyFont, outline: 'none',
                resize: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCreating(false)} style={{
                padding: '8px 18px', background: 'transparent',
                border: `1px solid ${t.border}`, color: t.subtext,
                borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: t.bodyFont,
              }}>취소</button>
              <button onClick={createProject} style={{
                padding: '8px 20px', background: t.accent, border: 'none',
                color: t.bg === '#f5f6fa' ? '#fff' : '#000',
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: t.bodyFont,
              }}>만들기</button>
            </div>
          </div>
        </div>
      )}

      {/* 프로젝트 그리드 */}
      {projects.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: 80, color: t.subtext }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📁</div>
          <div style={{ fontSize: 16, marginBottom: 8, color: t.text }}>프로젝트가 없어요</div>
          <div style={{ fontSize: 13 }}>새 프로젝트를 만들어 대화를 정리해보세요.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {projects.map(p => (
            <div key={p.id} onClick={() => onOpenProject(p)}
              style={{
                background: t.panel, border: `1px solid ${t.border}`,
                borderRadius: 12, padding: 20, cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: isLight ? '0 1px 6px rgba(0,0,0,0.06)' : 'none',
                position: 'relative',
              }}
              onMouseEnter={e => {
                setHoveredId(p.id)
                e.currentTarget.style.border = `1px solid ${t.accent}`
                e.currentTarget.style.boxShadow = isLight ? '0 4px 16px rgba(0,0,0,0.1)' : `0 0 12px ${t.accentSoft}`
              }}
              onMouseLeave={e => {
                setHoveredId(null)
                e.currentTarget.style.border = `1px solid ${t.border}`
                e.currentTarget.style.boxShadow = isLight ? '0 1px 6px rgba(0,0,0,0.06)' : 'none'
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>{p.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}>{p.name}</div>
              {p.desc && <div style={{ fontSize: 12, color: t.subtext, lineHeight: 1.5 }}>{p.desc}</div>}
              {/* RecordingsMain과 같은 결함이 복사돼 있었다: opacity:0 + 버튼 자신 hover라
                  마우스로도 찾기 어렵고 터치 기기에서는 삭제가 불가능했다. */}
              <button onClick={e => deleteProject(e, p.id)}
                title="삭제" aria-label="삭제"
                style={{
                  position: 'absolute', top: 12, right: 12,
                  background: 'transparent', border: 'none',
                  color: t.dangerText, fontSize: 14, lineHeight: 1, padding: 4,
                  cursor: 'pointer', transition: 'opacity 0.2s',
                  opacity: hoveredId === p.id ? 1 : 0.35,
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
