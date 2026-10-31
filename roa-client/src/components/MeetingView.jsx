import { useState, useRef, useEffect } from 'react'

// "새 녹음" 화면. 녹음/업로드 → 분석 → 저장까지만 담당하고,
// 결과 조회는 목록(RecordingsMain)과 상세(RecordingView)가 맡는다.
export default function MeetingView({ t, tl = (k) => k, onDone, onBack }) {
  const [recording, setRecording] = useState(false)
  const [file, setFile] = useState(null)
  const [question, setQuestion] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)

  // 화면을 벗어날 때 녹음/타이머가 남지 않게 정리
  useEffect(() => () => {
    try { mediaRef.current?.state !== 'inactive' && mediaRef.current?.stop() } catch {}
    streamRef.current?.getTracks().forEach(tr => tr.stop())
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const toggleRecord = async () => {
    if (recording) {
      mediaRef.current?.stop()
      setRecording(false)
      clearInterval(timerRef.current)
      return
    }
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = e => chunksRef.current.push(e.data)
      recorder.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setFile(new File([blob], 'meeting.webm', { type: 'audio/webm' }))
      }
      recorder.start()
      mediaRef.current = recorder
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds(p => p + 1), 1000)
    } catch { setError(tl('mic_permission')) }
  }

  const analyze = async () => {
    if (!file || busy) return
    setBusy(true); setError('')
    const form = new FormData()
    form.append('file', file)
    form.append('question', question || tl('default_meeting_q'))
    try {
      const res = await fetch('/api/meeting', { method: 'POST', body: form })
      const d = await res.json()
      if (d.success) {
        setFile(null); setQuestion('')
        onDone?.(d.recording?.id)   // 저장된 녹음의 상세 화면으로 이동
      } else {
        // 한도 초과는 오류가 아니라 안내다
        setError((d.token_limit_exceeded ? '⏳ ' : '⚠️ ') + (d.error || tl('error_occurred')))
      }
    } catch { setError(tl('error_occurred')) }
    setBusy(false)
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  const iStyle = {
    padding: '9px 12px', border: `1px solid ${t.border}`, background: t.inputBg || 'transparent',
    color: t.text, borderRadius: 8, fontFamily: t.bodyFont, fontSize: 14, outline: 'none',
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: t.bg }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 28px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
          {onBack && (
            <button onClick={onBack} style={{
              background: 'transparent', border: `1px solid ${t.border}`,
              color: t.subtext, cursor: 'pointer',
              borderRadius: 8, padding: '6px 12px', fontSize: 12, fontFamily: t.bodyFont,
            }}>{tl('back')}</button>
          )}
          <h2 style={{ fontFamily: t.titleFont, fontSize: 20, color: t.text, margin: 0 }}>
            {tl('recording_new')}
          </h2>
        </div>
        <p style={{ fontSize: 13, color: t.subtext, margin: '0 0 4px', lineHeight: 1.6 }}>
          {tl('meeting_view_desc')}
        </p>
        <p style={{ fontSize: 12, color: t.subtext, margin: '0 0 4px', opacity: 0.8 }}>
          {tl('meeting_record_only')}
        </p>
        <p style={{ fontSize: 12, color: t.subtext, margin: '0 0 24px', opacity: 0.7 }}>
          {tl('meeting_size_hint')}
        </p>

        <div style={{
          padding: 20, border: `1px solid ${t.border}`, background: t.panel, borderRadius: 12,
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={toggleRecord} disabled={busy} style={{
              padding: '10px 20px', borderRadius: 8, fontFamily: t.bodyFont, fontSize: 14,
              cursor: busy ? 'not-allowed' : 'pointer',
              border: `1px solid ${recording ? '#ef4444' : t.accent}`,
              background: recording ? 'rgba(239,68,68,0.1)' : t.accentSoft,
              color: recording ? '#ef4444' : t.accent,
              animation: recording ? 'pulse 1.6s infinite' : 'none',
            }}>
              {recording ? tl('record_in_progress')(mmss.split(':')[0], mmss.split(':')[1]) : tl('start_record')}
            </button>

            <label style={{
              padding: '10px 20px', border: `1px solid ${t.border}`, background: 'transparent',
              color: t.subtext, borderRadius: 8, cursor: 'pointer', fontSize: 14, fontFamily: t.bodyFont,
            }}>
              {tl('file_upload')}
              <input type="file" accept="audio/*,video/*,audio/mp4,audio/m4a,audio/mpeg"
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files[0]) { setFile(e.target.files[0]); setError('') } }} />
            </label>
          </div>

          {file && !recording && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, color: t.accent, marginBottom: 10, wordBreak: 'break-all' }}>
                🎙️ {file.name}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={question} onChange={e => setQuestion(e.target.value)}
                  placeholder={tl('meeting_q_ph')}
                  style={{ ...iStyle, flex: 1, minWidth: 200 }} />
                <button onClick={analyze} disabled={busy} style={{
                  padding: '9px 22px', border: `1px solid ${t.accent}`, background: t.accentSoft,
                  color: t.accent, borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: t.bodyFont, fontSize: 14, whiteSpace: 'nowrap',
                  opacity: busy ? 0.6 : 1,
                }}>{busy ? tl('processing') : tl('analyze')}</button>
              </div>
            </div>
          )}

          {busy && (
            <div style={{ marginTop: 14, fontSize: 12, color: t.subtext }}>
              {tl('meeting_analyzing')}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 14, fontSize: 13, color: '#ef4444', lineHeight: 1.5 }}>
              {error}
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,60%,100%{opacity:1} 30%{opacity:0.55} }`}</style>
    </div>
  )
}
