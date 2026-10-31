import { useState, useEffect } from 'react'

// 녹음 상세 — 요약과 전사 원문을 나눠서 보여준다.
export default function RecordingView({ recordingId, t, tl = (k) => k, onBack, onStartChat }) {
  const [rec, setRec] = useState(null)
  const [error, setError] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 삭제 후에는 볼 대상이 없으므로 목록으로 되돌아간다.
  const removeThis = async () => {
    if (deleting) return
    if (!window.confirm(tl('recording_delete_confirm'))) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, { method: 'DELETE' })
      const d = await res.json()
      if (d.success) { onBack(); return }
      setError(d.error || tl('unknown_error'))
    } catch {
      setError(tl('network_error'))
    }
    setDeleting(false)
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/recordings/${recordingId}`)
        const d = await res.json()
        if (!alive) return
        if (d.success) setRec(d.recording)
        else setError(d.error || tl('error_occurred'))
      } catch { if (alive) setError(tl('error_occurred')) }
    })()
    return () => { alive = false }
  }, [recordingId])

  const startChat = async () => {
    if (chatBusy) return
    setChatBusy(true)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/chat`, { method: 'POST' })
      const d = await res.json()
      if (d.success) onStartChat(d.session_id)
      else setError(d.error || tl('error_occurred'))
    } catch { setError(tl('error_occurred')) }
    setChatBusy(false)
  }

  const isLight = t.isLight !== false
  const card = {
    background: t.panel, border: `1px solid ${t.border}`,
    borderRadius: 12, padding: 20, marginBottom: 16,
    boxShadow: isLight ? '0 1px 6px rgba(0,0,0,0.06)' : 'none',
  }
  const label = { fontFamily: t.titleFont, fontSize: 11, color: t.accent, letterSpacing: 2, marginBottom: 14 }
  const mmss = (sec) => {
    const s = Math.max(0, Math.round(sec || 0))
    const m = Math.floor(s / 60)
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : (m > 0 ? `${m}분 ${s % 60}초` : `${s}초`)
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1,
      background: t.bg, padding: '32px 40px',
      scrollbarWidth: 'thin', scrollbarColor: `${t.scrollbar} transparent`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: `1px solid ${t.border}`,
          color: t.subtext, cursor: 'pointer',
          borderRadius: 8, padding: '6px 12px', fontSize: 12, fontFamily: t.bodyFont,
        }}>{tl('back')}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>🎙️</span>
          <span style={{ fontFamily: t.titleFont, fontSize: 20, color: t.text, fontWeight: 700 }}>
            {rec?.title || ''}
          </span>
          {rec?.duration > 0 && (
            <span style={{ fontSize: 12, color: t.subtextLight }}>{mmss(rec.duration)}</span>
          )}
        </div>
        {/* 상세 화면에서도 지울 수 있게 한다. 예전에는 목록으로 되돌아가야 했다. */}
        {rec && (
          <button onClick={removeThis} disabled={deleting}
            title={tl('delete')} aria-label={tl('delete')}
            style={{
              marginLeft: 'auto', background: 'transparent',
              border: `1px solid ${t.border}`, color: t.dangerText,
              cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.5 : 1,
              borderRadius: 8, padding: '6px 12px', fontSize: 12, fontFamily: t.bodyFont,
            }}>{tl('delete')}</button>
        )}
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {rec && (
        <div style={{ maxWidth: 760 }}>
          {/* 요약 */}
          <div style={card}>
            <div style={label}>◈ {tl('recording_summary')}</div>
            <div style={{ fontSize: 13.5, color: t.text, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {rec.summary || '—'}
            </div>
          </div>

          {/* 전사 원문 — 길어서 기본은 접어둔다 */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTranscript ? 14 : 0 }}>
              <div style={{ ...label, marginBottom: 0 }}>◈ {tl('recording_transcript')}</div>
              <button onClick={() => setShowTranscript(p => !p)} style={{
                background: 'transparent', border: `1px solid ${t.border}`,
                color: t.subtext, cursor: 'pointer', fontSize: 11,
                borderRadius: 6, padding: '3px 10px', fontFamily: t.bodyFont,
              }}>{showTranscript ? tl('collapse') : tl('expand')}</button>
            </div>
            {showTranscript && (
              <div style={{
                fontSize: 13, color: t.subtext, lineHeight: 1.8,
                whiteSpace: 'pre-wrap', maxHeight: 420, overflowY: 'auto',
              }}>{rec.transcript || '—'}</div>
            )}
          </div>

          {/* 채팅으로 이어가기 */}
          <div style={card}>
            <div style={label}>◈ {tl('recording_chat_title')}</div>
            <div style={{ fontSize: 13, color: t.subtext, marginBottom: 16, lineHeight: 1.6 }}>
              {tl('recording_chat_desc')}
            </div>
            <button onClick={startChat} disabled={chatBusy} style={{
              padding: '10px 24px', background: t.accentSoft,
              border: `1px solid ${t.accent}`, color: t.accent,
              cursor: chatBusy ? 'not-allowed' : 'pointer',
              borderRadius: 8, fontSize: 13, fontFamily: t.bodyFont,
              opacity: chatBusy ? 0.6 : 1,
            }}>{chatBusy ? tl('processing') : tl('recording_chat_btn')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
