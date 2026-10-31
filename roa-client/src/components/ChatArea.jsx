import { useState, useRef, useEffect, useLayoutEffect } from 'react'

const EXT_MAP = {
  python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts',
  html:'html', css:'css', json:'json', bash:'sh', sh:'sh', sql:'sql',
  java:'java', cpp:'cpp', c:'c', go:'go', rust:'rs', yaml:'yaml', md:'md',
}

function parseContent(text) {
  if (!text) return []
  const parts = []
  const codeRegex = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0, match
  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    parts.push({ type: 'code', lang: match[1] || 'text', content: match[2].trimEnd() })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) })
  return parts
}

function renderMarkdown(text, t) {
  const isLight = t.isLight !== false
  const lines = text.split('\n')
  const elements = []
  let i = 0

  const inlineRender = (str) => {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/~~(.*?)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, `<code style="background:${isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.1)'};padding:1px 6px;border-radius:4px;font-family:monospace;font-size:0.88em">$1</code>`)
  }

  while (i < lines.length) {
    const line = lines[i]

    // 헤더
    const h3 = line.match(/^### (.+)/)
    const h2 = line.match(/^## (.+)/)
    const h1 = line.match(/^# (.+)/)
    if (h1) { elements.push(<div key={i} style={{ fontSize: '1.25em', fontWeight: 700, color: t.text, margin: '14px 0 6px' }} dangerouslySetInnerHTML={{ __html: inlineRender(h1[1]) }} />); i++; continue }
    if (h2) { elements.push(<div key={i} style={{ fontSize: '1.1em', fontWeight: 700, color: t.text, margin: '12px 0 5px' }} dangerouslySetInnerHTML={{ __html: inlineRender(h2[1]) }} />); i++; continue }
    if (h3) { elements.push(<div key={i} style={{ fontSize: '1em', fontWeight: 700, color: t.text, margin: '10px 0 4px' }} dangerouslySetInnerHTML={{ __html: inlineRender(h3[1]) }} />); i++; continue }

    // 수평선
    if (line.match(/^---+$/) || line.match(/^\*\*\*+$/)) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: `1px solid ${t.border}`, margin: '10px 0' }} />)
      i++; continue
    }

    // 표 (|로 시작하는 줄)
    if (line.startsWith('|')) {
      const tableLines = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const rows = tableLines.filter(l => !l.match(/^\|[\s\-|]+\|$/))
      elements.push(
        <div key={i} style={{ overflowX: 'auto', margin: '8px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri === 0 ? (isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)') : 'transparent' }}>
                  {row.split('|').filter((_, ci) => ci > 0 && ci < row.split('|').length - 1).map((cell, ci) => (
                    <td key={ci} style={{
                      padding: '6px 12px',
                      border: `1px solid ${t.border}`,
                      fontWeight: ri === 0 ? 600 : 400,
                      color: t.text, whiteSpace: 'nowrap',
                    }} dangerouslySetInnerHTML={{ __html: inlineRender(cell.trim()) }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // 순서 없는 리스트
    if (line.match(/^[-*+] /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^[-*+] /)) {
        items.push(lines[i].replace(/^[-*+] /, ''))
        i++
      }
      elements.push(
        <ul key={i} style={{ margin: '4px 0', paddingLeft: 20, color: t.text }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ margin: '3px 0', fontSize: 14, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: inlineRender(item) }} />
          ))}
        </ul>
      )
      continue
    }

    // 순서 있는 리스트
    if (line.match(/^\d+\. /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(lines[i].replace(/^\d+\. /, ''))
        i++
      }
      elements.push(
        <ol key={i} style={{ margin: '4px 0', paddingLeft: 20, color: t.text }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ margin: '3px 0', fontSize: 14, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: inlineRender(item) }} />
          ))}
        </ol>
      )
      continue
    }

    // 인용문
    if (line.startsWith('> ')) {
      elements.push(
        <div key={i} style={{
          borderLeft: `3px solid ${t.accent}`, paddingLeft: 12,
          margin: '6px 0', color: t.subtext, fontStyle: 'italic',
        }} dangerouslySetInnerHTML={{ __html: inlineRender(line.slice(2)) }} />
      )
      i++; continue
    }

    // 빈 줄
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 6 }} />)
      i++; continue
    }

    // 일반 텍스트
    elements.push(
      <div key={i} style={{ fontSize: 14, lineHeight: 1.7, color: t.text, overflowWrap: 'break-word', wordBreak: 'break-word' }}
        dangerouslySetInnerHTML={{ __html: inlineRender(line) }} />
    )
    i++
  }

  return elements
}

// 입력창 아이콘 — Sidebar의 NavIcons와 같은 규격(24 viewBox, strokeWidth 1.8)으로 맞춤
const MicIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </svg>
)

const StopIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
)

const ClipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78" />
  </svg>
)

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

// 유튜브 링크 자동 감지. watch?v=, youtu.be, shorts, live, embed를 모두 받는다.
// v가 첫 파라미터가 아닌 경우(?list=...&v=...)도 있어 \bv= 로 찾는다.
const YOUTUBE_URL_RE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[\w=&%.-]*\bv=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{11}\S*/i

// 첨부 상한.
// 이미지는 1장당 대략 1,500토큰이라 5장이면 한 번에 7,500토큰 — Free 하루 한도(70,000)의
// 10%가 한 메시지에 나간다. 그래서 개수를 넉넉히 두지 않는다.
const MAX_ATTACH_FILES = 5
const MAX_VIDEO_BYTES = 50 * 1024 * 1024      // 서버 영상 한도와 동일
const MAX_TOTAL_ATTACH_BYTES = 100 * 1024 * 1024

// 재생성 대상 메시지에서 유튜브 질문만 뽑는다.
// 방금 보낸 메시지는 사용자가 입력한 원문이고, 새로고침 후 세션에서 복원된 것은
// "유튜브 분석: {url}\n질문: {q}" 형태라 두 경우를 모두 처리해야 한다.
const youtubeQuestionFrom = (content, url) =>
  content.replace(url, ' ')
    .replace(/유튜브 분석\s*:/g, ' ')
    .replace(/질문\s*:/g, ' ')
    .trim()

const readDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = e => resolve(e.target.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

// + 메뉴·드래그앤드롭·붙여넣기가 모두 같은 첨부 경로를 쓰므로 accept도 하나로 둔다.
const ATTACH_ACCEPT = [
  'image/*', 'image/heic', 'image/heif',
  '.pdf', 'application/pdf',
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
  'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/wav',
].join(',')

// 전사 대기 중 표시 (점 3개)
const VoiceDots = ({ color }) => (
  <span style={{ display: 'inline-flex', gap: 3 }}>
    {[0, 1, 2].map(i => (
      <span key={i} style={{
        width: 4, height: 4, borderRadius: '50%', background: color,
        animation: 'pulse 1.2s infinite', animationDelay: `${i * 0.2}s`,
      }} />
    ))}
  </span>
)

// 채팅 안에 파일 카드
function FileCard({ lang, content, filename, t, onClick }) {
  const isLight = t.isLight !== false
  const iconColor = isLight ? '#6366f1' : '#00c8ff'
  return (
    <div onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: '10px 16px', marginTop: 8,
      background: isLight ? '#f8f9ff' : 'rgba(0,200,255,0.06)',
      border: `1px solid ${isLight ? '#c7d0f8' : 'rgba(0,200,255,0.25)'}`,
      borderRadius: 10, cursor: 'pointer',
      transition: 'all 0.15s', maxWidth: 280,
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.background = t.accentSoft }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = isLight ? '#c7d0f8' : 'rgba(0,200,255,0.25)'; e.currentTarget.style.background = isLight ? '#f8f9ff' : 'rgba(0,200,255,0.06)' }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: isLight ? '#eef0fc' : 'rgba(0,200,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, letterSpacing: 1, color: t.accent, flexShrink: 0,
      }}>CODE</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{filename}</div>
        <div style={{ fontSize: 11, color: t.subtext, marginTop: 1, letterSpacing: 1 }}>{lang.toUpperCase()}</div>
      </div>
    </div>
  )
}

function MessageContent({ content, t, onFileClick }) {
  const parts = parseContent(content)
  return (
    <div>
      {parts.map((p, i) =>
        p.type === 'code' ? (
          <FileCard
            key={i}
            lang={p.lang}
            content={p.content}
            filename={`code.${EXT_MAP[p.lang?.toLowerCase()] || 'txt'}`}
            t={t}
            onClick={() => onFileClick({ lang: p.lang, content: p.content, filename: `code.${EXT_MAP[p.lang?.toLowerCase()] || 'txt'}` })}
          />
        ) : (
          <div key={i}>{renderMarkdown(p.content, t)}</div>
        )
      )}
    </div>
  )
}

export default function ChatArea({ messages, setMessages, sessionId, t, setArtifact, ttsEnabled, lang = 'ko', tl = (k) => k, generating = false, onGenerationBusy, onTurnStart, onTurnEnd }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState([]) // [{ file, type: 'pdf'|'video'|'audio'|'image' }]
  const [dragOver, setDragOver] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [sendProgress, setSendProgress] = useState(null)  // { done, total, name }
  // 음성 입력
  const [voiceRecording, setVoiceRecording] = useState(false)
  const [voiceLoading, setVoiceLoading] = useState(false)
  const voiceMediaRef = useRef(null)
  const voiceChunksRef = useRef([])
  const voiceStreamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const silenceIntervalRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const hasSpeechRef = useRef(false)
  // 회의록
  const bottomRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const composingRef = useRef(false)
  const ttsAudioRef = useRef(null)
  const [ttsBlocked, setTtsBlocked] = useState(false)   // 자동재생 차단 안내
  const loadingRef = useRef(false)
  const fileInputRef = useRef(null)      // + 메뉴 "파일 추가"용 통합 파일 선택
  const attachMenuRef = useRef(null)
  const inputRef = useRef(null)

  // 입력창 auto-grow (maxHeight 초과 시 내부 스크롤)
  const INPUT_MAX_H = 160
  const INPUT_MIN_H = 24
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(Math.min(el.scrollHeight, INPUT_MAX_H), INPUT_MIN_H) + 'px'
  }, [input])

  // 채팅방 전환 시 로딩 상태 초기화
  useEffect(() => {
    loadingRef.current = false
    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    if (!showScrollBtn) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const handleScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(distFromBottom > 120)
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // 재생성 가능 여부는 서버가 세션에 저장하지만(regenerable), 방금 만든 답변은
  // 아직 서버 배열로 교체되기 전이라 클라이언트에서도 같은 값을 붙여 둔다.
  // 그래야 답변 직후와 재진입 후의 버튼 상태가 일치한다.
  const addMsg = (role, content, extra = {}) => {
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    const base = role === 'assistant' ? { regenerable: true } : {}
    setMessages(prev => [...prev, { role, content, time, ...base, ...extra }])
  }

  // 사용량 한도 초과는 오류가 아니라 안내다. 음성(Whisper)도 토큰으로 환산해
  // 같은 한도에 합산되므로 플래그는 token_limit_exceeded 하나로 통일돼 있다.
  const limitNotice = (d) =>
    d?.token_limit_exceeded ? `⏳ ${d.error}` : null

  // 언마운트(탭 이동 등) 시 SSE 구독을 끊는다. 서버의 생성 작업은 계속 진행되고
  // 돌아오면 상태 폴링이 이어받으므로, 죽은 컴포넌트가 messages를 건드리지 않게
  // 확실히 정리하는 편이 안전하다.
  const chatAbortRef = useRef(null)
  const onTurnEndRef = useRef(onTurnEnd)
  onTurnEndRef.current = onTurnEnd
  useEffect(() => () => {
    try { chatAbortRef.current?.abort() } catch {}
    onTurnEndRef.current?.()   // 소유권을 쥔 채 사라지면 폴링이 영영 멈춘다
    // 음성 입력 정리 — 안 하면 화면을 떠나도 마이크가 계속 켜져 있고
    // 무음 감지 인터벌/타이머가 영영 돈다.
    if (silenceIntervalRef.current) { clearInterval(silenceIntervalRef.current); silenceIntervalRef.current = null }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    try {
      if (voiceMediaRef.current && voiceMediaRef.current.state !== 'inactive') {
        voiceMediaRef.current.onstop = null   // 언마운트 후 업로드/setState 방지
        voiceMediaRef.current.stop()
      }
    } catch {}
    voiceStreamRef.current?.getTracks().forEach(tr => tr.stop())
    voiceStreamRef.current = null
    try { audioCtxRef.current?.close() } catch {}
    audioCtxRef.current = null
  }, [])

  // ── TTS ──────────────────────────────────────────────
  const speakText = async (text) => {
    if (!ttsEnabled || !text?.trim()) return
    // 이전 재생 중지
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null }
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const d = await res.json()
      if (!d.success || !d.audio) return
      // base64 → Blob → Audio
      const binary = atob(d.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
      const audio = new Audio(url)
      ttsAudioRef.current = audio
      audio.onended = () => { URL.revokeObjectURL(url); ttsAudioRef.current = null }
      // 브라우저 자동재생 정책에 막히면 조용히 실패한다. 잡아서 사용자에게 알린다.
      audio.play().catch(err => {
        console.warn('[TTS] 재생 차단:', err?.name, err?.message)
        URL.revokeObjectURL(url)
        ttsAudioRef.current = null
        setTtsBlocked(true)
        setTimeout(() => setTtsBlocked(false), 6000)
      })
    } catch (e) { console.warn('[TTS] 실패:', e) }
  }
  // ─────────────────────────────────────────────────────

  const send = async (overrideMsg) => {
    if (loadingRef.current || generating) return
    const rawMsg = overrideMsg ?? input.trim()

    // ── 파일 첨부 전송 ──────────────────────────────────
    // 이미지는 한 요청으로 묶고(교차 추론), PDF·영상은 파일당 한 요청씩 순차로 보낸다.
    if (attachedFiles.length) {
      const question = rawMsg || tl('default_file_q')
      if (!overrideMsg) setInput('')
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
      const filesToSend = attachedFiles
      setAttachedFiles([])
      setMessages(prev => [...prev, {
        role: 'user', content: question, time,
        fileAttachments: filesToSend.map(a => ({ name: a.file.name, type: a.type })),
      }])
      loadingRef.current = true
      setLoading(true)
      setShowScrollBtn(false)
      // 이미지는 한 번의 요청으로 함께 보낸다. 장별로 나눠 보내면 모델이 서로를
      // 보지 못해 "이 두 사진 비교해줘" 같은 질문에 답할 수 없다.
      const imageItems = filesToSend.filter(a => a.type === 'image')
      const docItems = filesToSend.filter(a => a.type !== 'image')

      // 이미지 묶음 1건 + 문서 각 1건 = 전체 단계 수
      const totalSteps = (imageItems.length ? 1 : 0) + docItems.length
      const failures = []
      let done = 0

      if (imageItems.length) {
        const label = tl('progress_images')(imageItems.length)
        setSendProgress({ done, total: totalSteps, name: label })
        try {
          const images = await Promise.all(imageItems.map(async a => ({
            data: (await readDataUrl(a.file)).split(',')[1],
            media_type: a.file.type || 'image/jpeg',
          })))
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: question, session_id: sessionId, images, lang,
              // 새로고침 후에도 첨부 칩이 남도록 이름·종류를 함께 저장한다
              attachments: imageItems.map(a => ({ name: a.file.name, type: a.type })),
            })
          })
          const d = await res.json()
          if (d.answer) { addMsg('assistant', d.answer, { regenerable: false }); speakText(d.answer) }
          else {
            failures.push(label)
            addMsg('assistant', limitNotice(d) || `⚠️ ${tl('error_prefix')}${d.error}`, { regenerable: false })
          }
        } catch {
          failures.push(label)
          addMsg('assistant', tl('error_occurred'), { regenerable: false })
        }
        done++
      }

      // PDF·영상은 처리 비용이 크고 서버가 파일 1개만 받으므로 순차로 보낸다.
      // 하나가 실패해도 중단하지 않고 나머지를 계속 처리한다.
      for (const item of docItems) {
        setSendProgress({ done, total: totalSteps, name: item.file.name })
        try {
          const form = new FormData()
          form.append('file', item.file)
          form.append('question', question)
          form.append('session_id', sessionId || '')
          const endpoint = item.type === 'pdf' ? '/api/pdf' : '/api/video'
          const res = await fetch(endpoint, { method: 'POST', body: form })
          const d = await res.json()
          if (d.success) { addMsg('assistant', d.response, { regenerable: false }); speakText(d.response) }
          else {
            failures.push(item.file.name)
            addMsg('assistant', `⚠️ ${item.file.name} — ${limitNotice(d) || `${tl('error_prefix')}${d.error}`}`, { regenerable: false })
          }
        } catch {
          failures.push(item.file.name)
          addMsg('assistant', `⚠️ ${item.file.name} — ${tl('error_occurred')}`, { regenerable: false })
        }
        done++
      }

      setSendProgress(null)
      // 여러 건을 보냈고 일부만 실패했을 때만 요약한다.
      // 1건짜리는 위에서 이미 개별 오류를 띄웠으므로 중복이 된다.
      if (failures.length && totalSteps > 1) {
        addMsg('assistant', tl('attach_partial')(totalSteps - failures.length, totalSteps, failures.join(', ')), { regenerable: false })
      }
      loadingRef.current = false
      setLoading(false)
      return
    }
    // ─────────────────────────────────────────────────────

    // ── 유튜브 링크 자동 감지 ────────────────────────────
    // 링크를 그냥 붙여넣어도 분석되도록 별도 패널 없이 send()에서 가로챈다.
    // 링크를 뺀 나머지 텍스트가 질문이 되고, 비어 있으면 기본 질문을 쓴다.
    const ytMatch = rawMsg.match(YOUTUBE_URL_RE)
    if (ytMatch) {
      const url = ytMatch[0]
      const question = rawMsg.replace(url, ' ').trim() || tl('default_yt_q')
      if (!overrideMsg) setInput('')
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
      setMessages(prev => [...prev, { role: 'user', content: rawMsg, time }])
      loadingRef.current = true
      setLoading(true)
      setShowScrollBtn(false)
      try {
        const res = await fetch('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, question, session_id: sessionId, lang })
        })
        const d = await res.json()
        if (d.success) { addMsg('assistant', d.answer); speakText(d.answer) }
        else addMsg('assistant', limitNotice(d) || `⚠️ ${tl('error_prefix')}${d.error}`)
      } catch {
        addMsg('assistant', tl('error_occurred'))
      }
      loadingRef.current = false
      setLoading(false)
      return
    }
    // ─────────────────────────────────────────────────────

    const msg = rawMsg
    if (!msg) return
    if (!overrideMsg) setInput('')

    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    setMessages(prev => [...prev, { role: 'user', content: msg, time }])
    loadingRef.current = true
    setLoading(true)
    setShowScrollBtn(false)
    onTurnStart?.()   // 이 턴 동안은 폴링이 messages를 건드리지 않는다
    try {
      const ctrl = new AbortController()
      chatAbortRef.current = ctrl
      const res = await fetch('/api/chat?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        body: JSON.stringify({ message: msg, session_id: sessionId, lang }),
        signal: ctrl.signal,
      })

      // 409: 이 세션에 이미 생성 중인 작업이 있다 (서버는 이번 요청을 저장하지 않음).
      // 입력값을 되돌려주고, 진행 중인 응답을 폴링으로 이어받아 보여준다.
      if (res.status === 409) {
        if (!overrideMsg) setInput(msg)
        onTurnEnd?.()          // 폴링이 이어받아야 하므로 소유권부터 반납
        onGenerationBusy?.()
        loadingRef.current = false
        setLoading(false)
        return
      }

      const ct = res.headers.get('content-type') || ''
      const isStream = res.ok && ct.includes('text/event-stream') && res.body && typeof res.body.getReader === 'function'

      if (!isStream) {
        // Image gen / vision / fallback / error → JSON path (기존 동작 그대로).
        const d = await res.json()
        if (d.generated_image) {
          const t2 = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
          const content = d.answer || tl('image_generated')
          setMessages(prev => [...prev, { role: 'assistant', content, generatedImage: d.generated_image, time: t2, regenerable: true }])
          speakText(content)
        } else if (d.answer) { addMsg('assistant', d.answer); speakText(d.answer) }
        else if (d.error) addMsg('assistant', limitNotice(d) || `⚠️ ${tl('error_prefix')}${d.error}`)
      } else {
        // SSE: 빈 assistant 메시지를 먼저 넣고 delta 마다 그 항목만 갱신한다.
        const t2 = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
        let placeholderIndex = -1
        setMessages(prev => { placeholderIndex = prev.length; return [...prev, { role: 'assistant', content: '', time: t2, regenerable: true }] })
        const updateAt = (idx, content, generatedImage) => setMessages(prev => {
          if (idx < 0 || idx >= prev.length) return prev
          const next = prev.slice()
          next[idx] = { ...next[idx], content }
          if (generatedImage) next[idx].generatedImage = generatedImage
          return next
        })

        const reader = res.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buf = ''
        let acc = ''
        let finalAnswer = null
        let streamErr = null

        const handleFrame = raw => {
          const dataLines = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart())
          if (!dataLines.length) return
          let evt
          try { evt = JSON.parse(dataLines.join('\n')) } catch { return }
          if (evt.type === 'delta') { acc += evt.text; updateAt(placeholderIndex, acc) }
          // Claude가 generate_image 도구를 호출한 턴은 done에 이미지가 실려온다.
          else if (evt.type === 'done') { finalAnswer = evt.answer; updateAt(placeholderIndex, evt.answer, evt.generated_image) }
          else if (evt.type === 'error') { streamErr = evt.error }
        }

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            handleFrame(buf.slice(0, idx))
            buf = buf.slice(idx + 2)
          }
        }
        if (buf.trim()) handleFrame(buf)

        if (streamErr) {
          updateAt(placeholderIndex, `⚠️ ${tl('error_prefix')}${streamErr}`)
        } else {
          const spoken = finalAnswer != null ? finalAnswer : acc
          if (spoken) speakText(spoken)
        }
      }
    } catch (e) {
      // 언마운트로 인한 중단은 오류가 아니다 — 서버 작업은 계속 진행된다.
      if (e?.name !== 'AbortError') addMsg('assistant', `⚠️ ${tl('error_prefix')}${e.message}`)
    }
    onTurnEnd?.()
    loadingRef.current = false
    setLoading(false)
  }


  // ============ 음성 입력 ============
  // ============ 음성 입력 (무음 감지) ============
  const SPEECH_RMS = 10
  const SILENCE_DELAY = 3000
  const CHECK_INTERVAL = 100

  const stopVoiceRecording = () => {
    if (silenceIntervalRef.current) { clearInterval(silenceIntervalRef.current); silenceIntervalRef.current = null }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    if (voiceMediaRef.current?.state !== 'inactive') voiceMediaRef.current?.stop()
    setVoiceRecording(false)
  }

  const toggleVoiceRecord = async () => {
    if (voiceRecording) {
      console.log('[MIC] 수동 중지')
      stopVoiceRecording()
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('[MIC] 마이크 권한 획득')
    } catch (e) {
      alert(tl('mic_permission'))
      console.error('[MIC] 마이크 권한 오류:', e)
      return
    }

    voiceStreamRef.current = stream
    voiceChunksRef.current = []
    hasSpeechRef.current = false

    // MediaRecorder
    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = e => { if (e.data.size > 0) voiceChunksRef.current.push(e.data) }
    recorder.onstop = async () => {
      console.log('[MIC] MediaRecorder 종료, chunks:', voiceChunksRef.current.length)
      // 리소스 정리
      voiceStreamRef.current?.getTracks().forEach(t => t.stop())
      voiceStreamRef.current = null
      audioCtxRef.current?.close()
      audioCtxRef.current = null
      analyserRef.current = null

      if (voiceChunksRef.current.length === 0) { console.warn('[MIC] 오디오 데이터 없음'); return }
      const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' })
      const form = new FormData()
      form.append('file', blob, 'voice.webm')
      setVoiceLoading(true)
      try {
        const res = await fetch('/api/voice', { method: 'POST', body: form })
        const d = await res.json()
        if (d.success && d.text?.trim()) {
          console.log('[MIC] 인식 결과:', d.text)
          await send(d.text)   // 무음 감지 후 항상 자동 전송
        } else {
          console.warn('[MIC] 음성 인식 실패:', d)
          // 한도 초과·서버 오류는 사용자에게 알린다.
          // (인식 결과만 비어있는 경우는 조용히 넘어감 — 기존 동작 유지)
          const notice = limitNotice(d)
          if (notice) addMsg('assistant', notice)
          else if (d.error) addMsg('assistant', `⚠️ ${tl('error_prefix')}${d.error}`)
        }
      } catch (e) { console.error('[MIC] 전송 오류:', e) }
      setVoiceLoading(false)
    }
    recorder.start(100)
    voiceMediaRef.current = recorder
    console.log('[MIC] MediaRecorder 시작')

    // AudioContext - 생성 후 반드시 resume() (브라우저 정책: suspended 상태로 시작)
    const ctx = new AudioContext()
    console.log('[MIC] AudioContext 상태:', ctx.state)
    if (ctx.state === 'suspended') {
      await ctx.resume()
      console.log('[MIC] AudioContext resume() 후 상태:', ctx.state)
    }
    audioCtxRef.current = ctx

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(analyser)
    analyserRef.current = analyser
    console.log('[MIC] AnalyserNode 연결 완료')

    // 100ms마다 RMS 체크
    let logCount = 0
    silenceIntervalRef.current = setInterval(() => {
      if (!analyserRef.current) return

      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      const rms = Math.sqrt(data.reduce((sum, v) => sum + (v - 128) ** 2, 0) / data.length)

      logCount++
      if (logCount % 10 === 0) {
        console.log(`[MIC] RMS=${rms.toFixed(2)} | hasSpeech=${hasSpeechRef.current} | silenceTimer=${silenceTimerRef.current !== null} | threshold=${SPEECH_RMS}`)
      }

      if (rms >= SPEECH_RMS) {
        if (!hasSpeechRef.current) console.log('[MIC] 음성 감지! RMS:', rms.toFixed(2))
        hasSpeechRef.current = true
        if (silenceTimerRef.current) {
          console.log('[MIC] 무음 타이머 리셋 (음성 재감지)')
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = null
        }
      } else if (hasSpeechRef.current) {
        if (!silenceTimerRef.current) {
          console.log(`[MIC] 무음 시작 (RMS=${rms.toFixed(2)}), ${SILENCE_DELAY}ms 후 자동 전송`)
          silenceTimerRef.current = setTimeout(() => {
            console.log('[MIC] 무음 타이머 만료 → 자동 중지')
            stopVoiceRecording()
          }, SILENCE_DELAY)
        }
      }
    }, CHECK_INTERVAL)

    setVoiceRecording(true)
    console.log('[MIC] 무음 감지 시작')
  }

  // 답변 재생성
  const regenerate = async () => {
    // 서버는 마지막 assistant 답변을 걷어내고 새 답변으로 갈아끼운다.
    // 그러니 다시 물어볼 질문도 "그 답변 직전의 user 메시지"여야 한다.
    // 전체 마지막 user를 쓰면 뒤에 답 없는 질문이 붙어 있을 때 어긋난다.
    const lastAsstIdx = messages.map(m => m.role).lastIndexOf('assistant')
    const lastUser = lastAsstIdx >= 0
      ? [...messages.slice(0, lastAsstIdx)].reverse().find(m => m.role === 'user')
      : null
    if (!lastUser || loadingRef.current || generating) return
    // 마지막 어시스턴트 메시지 백업 (오류 시 복원용)
    let removedMsg = null
    setMessages(prev => {
      const idx = [...prev].map(m => m.role).lastIndexOf('assistant')
      if (idx >= 0) {
        removedMsg = prev[idx]
        return prev.slice(0, idx)
      }
      return prev
    })
    loadingRef.current = true; setLoading(true); setShowScrollBtn(false)
    onTurnStart?.()   // 재생성도 messages를 직접 갱신하므로 소유권을 잡는다
    try {
      // 유튜브 링크가 있던 질문을 /api/chat으로 보내면 분석이 아예 일어나지 않는다
      // (감지 로직이 send()에만 있어서, 모델이 "URL을 못 연다"고 답해버린다).
      // 재생성도 첫 전송과 같은 경로를 타게 한다.
      const ytMatch = lastUser.content.match(YOUTUBE_URL_RE)
      let res
      if (ytMatch) {
        const url = ytMatch[0]
        res = await fetch('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url, question: youtubeQuestionFrom(lastUser.content, url) || tl('default_yt_q'),
            session_id: sessionId, lang, is_regenerate: true,
          })
        })
      } else {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: lastUser.content, session_id: sessionId, lang, is_regenerate: true })
        })
      }

      // 409: 이미 생성 중 → 폴링으로 진행 상황을 이어받는다 (구 답변은 서버에 그대로 있음)
      if (res.status === 409) {
        onTurnEnd?.()
        onGenerationBusy?.()
        loadingRef.current = false
        setLoading(false)
        return
      }

      const d = await res.json()
      if (d.answer) { addMsg('assistant', d.answer); speakText(d.answer) }
      // 재생성 실패 시 서버는 구 답변을 그대로 두므로, 화면도 구 답변을 되살린 뒤
      // 에러 안내를 덧붙여 저장 상태와 어긋나지 않게 한다.
      else if (d.error) {
        if (removedMsg) setMessages(prev => [...prev, removedMsg])
        addMsg('assistant', limitNotice(d) || `⚠️ 오류: ${d.error}`)
      }
      else if (removedMsg) setMessages(prev => [...prev, removedMsg])
    } catch {
      if (removedMsg) setMessages(prev => [...prev, removedMsg])
      else addMsg('assistant', tl('error_occurred'))
    }
    onTurnEnd?.()
    loadingRef.current = false; setLoading(false)
  }

  // + 메뉴는 바깥 클릭이나 Esc로 닫는다. 열려 있을 때만 리스너를 건다.
  useEffect(() => {
    if (!showAttachMenu) return
    const onDown = e => { if (!attachMenuRef.current?.contains(e.target)) setShowAttachMenu(false) }
    const onKey = e => { if (e.key === 'Escape') setShowAttachMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showAttachMenu])

  const fileType = (file) => {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('audio/')) return 'audio'
    return null
  }

  // 첨부 단일 진입점. + 메뉴·드래그앤드롭·붙여넣기가 모두 여기로 모인다.
  // 종류 판별·용량 검사·개수 제한을 한 곳에서만 하려고 뺐다.
  // 거부된 파일은 하나씩 alert를 띄우지 않고 마지막에 사유를 모아 한 번만 알린다.
  const attachFiles = (list) => {
    const incoming = Array.from(list || [])
    if (!incoming.length) return
    // 판정은 setState 밖에서 한 번만 한다. updater 안에서 하면 StrictMode의
    // 이중 호출 때문에 거부 목록이 두 번 쌓여 같은 경고가 겹쳐 보인다.
    const next = [...attachedFiles]
    let total = next.reduce((sum, a) => sum + a.file.size, 0)
    const rejected = []
    for (const file of incoming) {
      // 같은 파일을 두 번 떨어뜨리는 실수를 걸러낸다
      if (next.some(a => a.file.name === file.name && a.file.size === file.size)) continue
      const type = fileType(file)
      if (!type) { rejected.push([file.name, tl('reason_unsupported')]); continue }
      if (type === 'video' && file.size > MAX_VIDEO_BYTES) {
        rejected.push([file.name, tl('reason_video_too_large')]); continue
      }
      if (next.length >= MAX_ATTACH_FILES) {
        rejected.push([file.name, tl('reason_too_many')(MAX_ATTACH_FILES)]); continue
      }
      if (total + file.size > MAX_TOTAL_ATTACH_BYTES) {
        rejected.push([file.name, tl('reason_total_too_large')(MAX_TOTAL_ATTACH_BYTES / 1024 / 1024)]); continue
      }
      next.push({ file, type })
      total += file.size
    }
    setAttachedFiles(next)
    if (rejected.length) {
      alert(tl('attach_rejected_title') + '\n' +
        rejected.map(([name, why]) => `· ${name} — ${why}`).join('\n'))
    }
  }

  const removeAttached = (idx) => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))

  // 드래그앤드롭
  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    attachFiles(e.dataTransfer.files)
  }

  // 클립보드 붙여넣기 (스크린샷·복사한 파일)
  const handlePaste = (e) => {
    const cd = e.clipboardData
    if (!cd) return
    // 워드·엑셀·웹페이지에서 복사하면 텍스트와 이미지 표현이 함께 실려온다.
    // 그때 파일을 먼저 잡으면 평범한 텍스트 붙여넣기가 깨지므로,
    // 텍스트가 들어있으면 무조건 기본 동작에 맡긴다.
    // 스크린샷과 파일 복사에는 text/plain이 없어서 이 규칙으로 갈린다.
    if (cd.getData('text/plain')?.trim()) return
    const files = Array.from(cd.files || [])
    if (!files.length) {
      const fromItems = Array.from(cd.items || [])
        .filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean)
      files.push(...fromItems)
    }
    if (!files.length) return
    e.preventDefault()      // 첨부로 처리했으니 입력창에는 아무것도 넣지 않는다
    attachFiles(files)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) { e.preventDefault(); send() }
  }

  // 재생성 버튼은 "마지막 어시스턴트 답변"에 붙인다.
  // 예전에는 messages의 마지막 원소일 때만 붙였는데(i === messages.length - 1),
  // 뒤에 divider나 아직 답을 못 받은 user 메시지가 하나라도 남아 있으면
  // 모든 대화에서 버튼이 통째로 사라졌다. 배열 끝이 아니라 역할로 찾는다.
  const lastAssistantIdx = messages.map(m => m.role).lastIndexOf('assistant')

  // 재생성 가능 여부는 프론트에서 추론하지 않는다. 저장 시점에 서버가 확정해
  // 답변 메시지에 regenerable로 박아두고, 여기서는 그 값만 읽는다.
  // (첨부가 있던 질문의 답변은 파일을 다시 올릴 수 없어 재생성 불가)
  //
  // 명시적으로 true일 때만 허용한다. 이 필드가 없는 과거 세션은 판정 근거가
  // 없으므로 재생성 불가로 본다 — 버튼만 안 보일 뿐 나머지 기능은 그대로다.
  const canRegenerate = messages[lastAssistantIdx]?.regenerable === true

  const isLight = t.isLight !== false

  // 입력창 아이콘 버튼: 테두리 없이 아이콘만 두고, hover에서만 배경이 살짝 뜬다.
  // 활성 상태(메뉴 열림·녹음 중)는 각 버튼이 따로 배경을 칠하므로
  // hover 핸들러는 그 상태가 아닐 때만 배경을 건드린다.
  const hoverBg = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'
  const iconBtn = {
    width: 34, height: 34, flexShrink: 0, padding: 0, cursor: 'pointer',
    borderRadius: 8, border: 'none', background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s',
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', overflowX: 'hidden', maxWidth: '100%', position: 'relative', zIndex: 1, background: t.bg,
        border: dragOver ? `2px dashed ${t.accent}` : '2px solid transparent', transition: 'border 0.2s', boxSizing: 'border-box' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: t.accentSoft, pointerEvents: 'none' }}>
          <div style={{ fontSize: 18, color: t.accent, fontFamily: t.titleFont, letterSpacing: 2 }}>{tl('drop_file')}</div>
        </div>
      )}

      <div ref={scrollContainerRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        scrollbarWidth: 'thin', scrollbarColor: `${t.scrollbar} ${t.scrollbarTrack}`,
        position: 'relative',
      }}>
        <div style={{
          maxWidth: 760, margin: '0 auto', width: '100%',
          padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 24,
          boxSizing: 'border-box', minHeight: '100%',
        }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: '15vh' }}>
            <div style={{ fontFamily: t.titleFont, fontSize: 44, color: t.accent, opacity: 0.15, letterSpacing: 16, fontWeight: 700 }}>ROA</div>
            <div style={{ fontSize: 13, color: t.subtextLight, letterSpacing: 2, opacity: 0.7 }}>{tl('personal_ai_online')}</div>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'divider') return (
            <div key={i} style={{ textAlign: 'center', fontSize: 11, color: t.subtextLight, letterSpacing: 1, padding: '8px 0', borderTop: `1px solid ${t.border}` }}>{m.content}</div>
          )
          if (!m.content) return null
          const isUser = m.role === 'user'
          return (
            <div key={i} style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start', minWidth: 0, gap: 0 }}>
              <div style={{ maxWidth: isUser ? '72%' : '88%', minWidth: 0, overflow: 'hidden' }}>
                <div style={{
                  padding: isUser ? '11px 16px' : '4px 0',
                  background: isUser
                    ? (isLight ? '#f0f0f0' : 'rgba(255,255,255,0.08)')
                    : 'transparent',
                  borderRadius: isUser ? '18px 18px 4px 18px' : 0,
                  fontSize: 15, lineHeight: 1.75,
                  color: m.isLoading ? t.accent : t.text,
                  animation: m.isLoading ? 'pulse 1.4s ease-in-out infinite' : 'none',
                  wordBreak: 'break-word', overflowWrap: 'break-word',
                }}>
                  {/* fileAttachment(단수)는 이전 형식. 진행 중인 대화에 남아 있을 수 있어 함께 받는다. */}
                  {(m.fileAttachments || (m.fileAttachment ? [m.fileAttachment] : [])).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                      {(m.fileAttachments || [m.fileAttachment]).map((f, fi) => (
                        <div key={fi} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: 'rgba(128,128,128,0.12)', fontSize: 12, color: t.subtext }}>
                          <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.imageUrl && (
                    <img src={m.imageUrl} alt={tl('uploaded_img_alt')}
                      style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 10, marginBottom: 8, display: 'block', objectFit: 'contain' }} />
                  )}
                  {m.generatedImage && (
                    <div style={{ marginBottom: 8 }}>
                      <img src={m.generatedImage} alt={tl('generated_img_alt')}
                        style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 12, display: 'block', objectFit: 'contain', border: `1px solid ${t.border}` }} />
                      <a href={m.generatedImage} download="generated_image.png" style={{
                        display: 'inline-block', marginTop: 6, fontSize: 11, color: t.accent,
                        textDecoration: 'none', opacity: 0.8
                      }}>{tl('download')}</a>
                    </div>
                  )}
                  <MessageContent content={m.content} t={t} onFileClick={(a) => setArtifact && setArtifact(a)} />
                </div>
                {/* 복사 + 재생성 버튼 */}
                <div style={{ display: 'flex', gap: 4, marginTop: 4, justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'center', visibility: m.isLoading ? 'hidden' : 'visible', opacity: 0.6 }}>
                  <span style={{ fontSize: 11, color: t.subtextLight }}>{m.time}</span>
                  <button onClick={() => {
                    navigator.clipboard.writeText(m.content)
                    setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 2000)
                  }} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: copiedIdx === i ? t.accent : t.subtextLight, fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  }}>
                    {copiedIdx === i ? tl('copied') : tl('copy_btn')}
                  </button>
                  {i === lastAssistantIdx && !loading && !generating && canRegenerate && (
                    <button onClick={regenerate} style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: t.subtextLight, fontSize: 11, padding: '2px 6px', borderRadius: 4,
                    }}>{tl('regenerate')}</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {(loading || generating) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 2 }}>
            {[0,1,2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: t.accent, animation: 'pulse 1.2s infinite', animationDelay: `${i*0.2}s`, opacity: 0.7 }} />)}
            {generating && !loading && (
              <span style={{ fontSize: 12, color: t.subtext, marginLeft: 4 }}>{tl('generating')}</span>
            )}
          </div>
        )}
        {ttsBlocked && (
          <div onClick={() => setTtsBlocked(false)} style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
            padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
            background: t.accentSoft, border: `1px solid ${t.border}`,
            fontSize: 12, color: t.subtext,
          }}>
            <span>🔇</span><span>{tl('tts_blocked')}</span>
          </div>
        )}
        <div ref={bottomRef} />
        </div>
        {showScrollBtn && (
          <button
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollBtn(false) }}
            style={{
              position: 'sticky', bottom: 16, left: '100%', transform: 'translateX(-52px)',
              width: 36, height: 36, borderRadius: '50%',
              background: t.accent, color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)', zIndex: 10,
              opacity: 0.9,
            }}
          >↓</button>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${t.border}`, background: t.inputBg }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '14px 28px 20px', boxSizing: 'border-box' }}>
        <input ref={fileInputRef} type="file" accept={ATTACH_ACCEPT} multiple
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, overflow: 'hidden' }}
          onChange={e => { attachFiles(e.target.files); e.target.value = '' }} />
        {sendProgress && sendProgress.total > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '7px 12px', borderRadius: 8, background: t.accentSoft, color: t.accent, fontSize: 12, fontFamily: t.bodyFont }}>
            <VoiceDots color={t.accent} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tl('attach_progress')(sendProgress.done + 1, sendProgress.total, sendProgress.name)}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', border: `1.5px solid ${attachedFiles.length ? t.accent : t.border}`, background: t.panel, padding: '16px 18px 12px', borderRadius: 20, boxShadow: isLight ? '0 2px 12px rgba(0,0,0,0.07)' : '0 2px 12px rgba(0,0,0,0.25)', transition: 'border-color 0.2s' }}>
          {attachedFiles.length > 0 && (
            <div style={{ alignSelf: 'stretch', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {attachedFiles.map((a, i) => (
                <div key={`${a.file.name}-${a.file.size}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, border: `1px solid ${t.accent}`, background: t.accentSoft, color: t.accent, maxWidth: '100%' }}>
                  <span style={{ fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: t.bodyFont }}>{a.file.name}</span>
                  <button onClick={() => removeAttached(i)}
                    title={tl('remove_file')} aria-label={`${a.file.name} ${tl('remove_file')}`}
                    style={{ background: 'none', border: 'none', color: t.accent, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0, marginLeft: 2 }}>✕</button>
                </div>
              ))}
              {attachedFiles.length > 1 && (
                <span style={{ alignSelf: 'center', fontSize: 11, color: t.subtext, fontFamily: t.bodyFont }}>
                  {tl('attach_count')(attachedFiles.length, MAX_ATTACH_FILES)}
                </span>
              )}
            </div>
          )}
          {/* 위쪽 줄: 입력창이 폭을 전부 쓴다 */}
          <textarea
            ref={inputRef}
            value={input} onChange={e => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachedFiles.length ? tl('file_q_ph') : tl('msg_ph')} rows={1}
            /* 세로 padding은 두지 않는다 — auto-grow가 scrollHeight로 높이를 재는데
               위아래 여백이 거기 섞여 한 줄 높이가 그만큼 커진다. 여백은 바깥 컨테이너가 준다. */
            style={{ width: '100%', padding: '0 2px', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', color: t.text, fontFamily: t.bodyFont, fontSize: 15, resize: 'none', minHeight: INPUT_MIN_H, maxHeight: INPUT_MAX_H, overflowY: 'auto', lineHeight: 1.6 }}
          />
          {/* 아래쪽 줄: 왼쪽에 +, 오른쪽에 마이크·전송 */}
          <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            {/* + 메뉴 (지금은 "파일 추가" 하나. 항목이 늘어나면 여기에 추가한다) */}
            <div ref={attachMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button onClick={() => setShowAttachMenu(v => !v)}
                onMouseEnter={e => { if (!showAttachMenu) e.currentTarget.style.background = hoverBg }}
                onMouseLeave={e => { if (!showAttachMenu) e.currentTarget.style.background = 'transparent' }}
                style={{
                  ...iconBtn,
                  background: showAttachMenu ? t.accentSoft : 'transparent',
                  color: showAttachMenu ? t.accent : t.subtext,
                }} title={tl('attach_file')} aria-label={tl('attach_file')}
                aria-haspopup="menu" aria-expanded={showAttachMenu}>
                <PlusIcon />
              </button>
              {showAttachMenu && (
                <div role="menu" style={{
                  position: 'absolute', bottom: 42, left: 0, minWidth: 176, zIndex: 30,
                  background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 4,
                  boxShadow: isLight ? '0 6px 20px rgba(0,0,0,0.12)' : '0 6px 20px rgba(0,0,0,0.45)',
                }}>
                  <button role="menuitem"
                    onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click() }}
                    onMouseEnter={e => { e.currentTarget.style.background = t.accentSoft }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', background: 'transparent', border: 'none',
                      color: t.text, cursor: 'pointer', borderRadius: 6, textAlign: 'left',
                      fontFamily: t.bodyFont, fontSize: 13, whiteSpace: 'nowrap',
                    }}>
                    <ClipIcon />
                    {tl('add_file')}
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* 음성 입력 버튼 */}
              <button onClick={toggleVoiceRecord}
                onMouseEnter={e => { if (!voiceRecording) e.currentTarget.style.background = hoverBg }}
                onMouseLeave={e => { if (!voiceRecording) e.currentTarget.style.background = 'transparent' }}
                style={{
                  ...iconBtn,
                  background: voiceRecording ? 'rgba(239,68,68,0.15)' : 'transparent',
                  color: voiceRecording ? '#ef4444' : t.subtext,
                  animation: voiceRecording ? 'pulse 1.2s infinite' : 'none',
                }} title={voiceRecording ? tl('stop_recording') : tl('voice_input')}
                aria-label={voiceRecording ? tl('stop_recording') : tl('voice_input')}>
                {voiceLoading ? <VoiceDots color={t.subtext} /> : voiceRecording ? <StopIcon /> : <MicIcon />}
              </button>
              {/* 전송은 주 동작이라 채운 배경을 남긴다 (테두리는 제거) */}
              <button
                onClick={() => send()}
                disabled={loading || generating}
                style={{
                  ...iconBtn,
                  cursor: (loading || generating) ? 'not-allowed' : 'pointer',
                  background: t.accentSoft,
                  color: t.accent,
                  fontSize: 14,
                  opacity: (loading || generating) ? 0.5 : 1,
                }}
                title={tl('send')}
              >▶</button>
            </div>
          </div>
        </div>
      </div>
      </div>
      <style>{`@keyframes pulse { 0%,60%,100%{opacity:0.2;transform:scale(0.8)} 30%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  )
}
