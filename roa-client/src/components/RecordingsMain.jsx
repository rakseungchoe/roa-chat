import { useState, useEffect } from 'react'

// 녹음 목록 (프로젝트 카드 그리드와 같은 패턴).
// 제목은 녹음 시각이고, 그 아래 요약 미리보기로 "무슨 내용"을 한눈에 보여준다.
export default function RecordingsMain({ t, tl = (k) => k, onOpen, onNew }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const res = await fetch('/api/recordings')
      const d = await res.json()
      if (d.success) setItems(d.recordings || [])
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const remove = async (e, id) => {
    e.stopPropagation()
    if (!window.confirm(tl('recording_delete_confirm'))) return
    try {
      await fetch(`/api/recordings/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(x => x.id !== id))
    } catch {}
  }

  const [hoveredId, setHoveredId] = useState(null)

  const isLight = t.isLight !== false
  const mmss = (sec) => {
    const s = Math.max(0, Math.round(sec || 0))
    const m = Math.floor(s / 60)
    return m >= 60
      ? `${Math.floor(m / 60)}시간 ${m % 60}분`
      : (m > 0 ? `${m}분 ${s % 60}초` : `${s}초`)
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', zIndex: 1, position: 'relative',
      background: t.bg, padding: '40px 48px',
      scrollbarWidth: 'thin', scrollbarColor: `${t.scrollbar} transparent`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h2 style={{ fontFamily: t.titleFont, fontSize: 22, color: t.text, fontWeight: 700, margin: 0, letterSpacing: 1 }}>
          {tl('nav_record')}
        </h2>
        <button onClick={onNew} style={{
          padding: '9px 20px', background: t.accent, border: 'none',
          color: t.bg === '#f5f6fa' ? '#fff' : '#000',
          fontFamily: t.bodyFont, fontSize: 13, fontWeight: 600,
          borderRadius: 8, cursor: 'pointer', transition: 'opacity 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >{tl('recording_new')}</button>
      </div>

      {loading ? (
        <div style={{ color: t.subtext, fontSize: 13 }}>…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: 80, color: t.subtext }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎙️</div>
          <div style={{ fontSize: 16, marginBottom: 8, color: t.text }}>{tl('recording_empty')}</div>
          <div style={{ fontSize: 13 }}>{tl('recording_empty_desc')}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {items.map(r => (
            <div key={r.id} onClick={() => onOpen(r.id)}
              style={{
                background: t.panel, border: `1px solid ${t.border}`,
                borderRadius: 12, padding: 20, cursor: 'pointer',
                transition: 'all 0.2s', position: 'relative',
                boxShadow: isLight ? '0 1px 6px rgba(0,0,0,0.06)' : 'none',
              }}
              onMouseEnter={e => {
                setHoveredId(r.id)
                e.currentTarget.style.border = `1px solid ${t.accent}`
                e.currentTarget.style.boxShadow = isLight ? '0 4px 16px rgba(0,0,0,0.1)' : `0 0 12px ${t.accentSoft}`
              }}
              onMouseLeave={e => {
                setHoveredId(null)
                e.currentTarget.style.border = `1px solid ${t.border}`
                e.currentTarget.style.boxShadow = isLight ? '0 1px 6px rgba(0,0,0,0.06)' : 'none'
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 10 }}>🎙️</div>
              {/* 제목 = 녹음 시각 */}
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}>
                {r.title || r.created}
              </div>
              {/* 요약 미리보기 — "무슨 내용"을 한눈에 */}
              {r.preview && (
                <div style={{
                  fontSize: 12, color: t.subtext, lineHeight: 1.5, marginBottom: 8,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>{r.preview}</div>
              )}
              {r.duration > 0 && (
                <div style={{ fontSize: 11, color: t.subtextLight }}>{mmss(r.duration)}</div>
              )}
              {/* 예전에는 opacity:0 에 버튼 자신의 hover로만 나타나서 사실상 찾을 수 없었고,
                  hover가 없는 터치 기기에서는 아예 삭제가 불가능했다.
                  항상 옅게 보여주고 카드에 마우스를 올리면 또렷해지게 바꾼다. */}
              <button onClick={e => remove(e, r.id)}
                title={tl('delete')} aria-label={tl('delete')}
                style={{
                  position: 'absolute', top: 12, right: 12,
                  background: 'transparent', border: 'none',
                  color: t.dangerText, fontSize: 14, lineHeight: 1, padding: 4,
                  cursor: 'pointer', transition: 'opacity 0.2s',
                  opacity: hoveredId === r.id ? 1 : 0.35,
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
