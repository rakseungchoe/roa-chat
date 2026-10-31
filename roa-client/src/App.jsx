import { useState, useEffect, useRef, useCallback } from 'react'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import RightPanel from './components/RightPanel'
import ProjectView from './components/ProjectView'
import ProjectsMain from './components/ProjectsMain'
import PlannerView from './components/PlannerView'
import MeetingView from './components/MeetingView'
import RecordingsMain from './components/RecordingsMain'
import RecordingView from './components/RecordingView'
import Login from './components/Login'
import Privacy from './components/Privacy'
import Terms from './components/Terms'
import Settings from './components/Settings'
import { themes } from './themes'
import { useSWUpdate } from './hooks/useSWUpdate'
import { useLang, LANG_CACHE_KEY } from './hooks/useLang'

function getLayout() {
  const w = window.innerWidth
  if (w < 768) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

// 모바일/태블릿 공통: 헤더 행 높이 (safe area 포함)
const HEADER_ROW = 'calc(56px + env(safe-area-inset-top))'

// 언어와 마찬가지로 TTS 설정의 진실의 원천은 서버(계정)다.
// 이 키는 첫 렌더에서 깜빡임을 막기 위한 로컬 캐시일 뿐이다.
const TTS_CACHE_KEY = 'roa_tts'

const nowTime = () =>
  new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 재생성 중 화면에서 구 답변을 감추기 위해 마지막 assistant 하나를 제거한 사본 반환
const dropLastAssistant = (msgs) => {
  const arr = [...(msgs || [])]
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].role === 'assistant') { arr.splice(i, 1); break }
  }
  return arr
}

export default function App() {
  const { showUpdate, applyUpdate, dismissUpdate } = useSWUpdate()
  const { lang, toggleLang, applyLang, tl } = useLang()
  const [loggedIn, setLoggedIn] = useState(null) // null = 세션 확인 중
  const [messages, setMessages] = useState([])
  const [generating, setGenerating] = useState(false)  // 서버에서 응답 생성 중
  const [currentSession, setCurrentSession] = useState(null)
  const [currentProject, setCurrentProject] = useState(null)
  const [projectsRev, setProjectsRev] = useState(0)   // 이관 완료 시 목록 재조회 트리거
  // 세션 목록의 버전. 연결/해제/삭제가 일어나면 올라가고,
  // 사이드바와 프로젝트 화면이 함께 재조회한다 — 두 화면이 같은 데이터를
  // 각자 fetch해 들고 있어서, 이 신호가 없으면 한쪽만 갱신되고
  // 다른 쪽은 새로고침 전까지 낡은 목록을 보여준다.
  const [sessionsRev, setSessionsRev] = useState(0)
  const bumpSessions = () => setSessionsRev(v => v + 1)
  const [showProjects, setShowProjects] = useState(false)
  const [showPlanner, setShowPlanner] = useState(false)
  const [showMeeting, setShowMeeting] = useState(false)   // 녹음 섹션 진입 여부
  const [currentRecording, setCurrentRecording] = useState(null)  // 상세 볼 녹음 id
  const [newRecording, setNewRecording] = useState(false)         // '새 녹음' 화면
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)   // 모바일 오버레이 사이드바
  const [panelOpen, setPanelOpen] = useState(false)
  const [layout, setLayout] = useState(getLayout)
  const [artifact, setArtifact] = useState(null)
  // 서버(계정 설정)가 진실의 원천. 여기 값은 첫 렌더용 캐시일 뿐이고
  // /api/me 응답이 오면 덮어쓴다.
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem(TTS_CACHE_KEY) === 'true')
  const [tokenInfo, setTokenInfo] = useState({ daily_tokens: 0, daily_token_limit: null, plan: 'free' })
  const [username, setUsername] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsDeleteOpen, setSettingsDeleteOpen] = useState(false)
  const [settingsDeletePw, setSettingsDeletePw] = useState('')
  const [settingsDeleteBusy, setSettingsDeleteBusy] = useState(false)
  const [settingsDeleteError, setSettingsDeleteError] = useState('')

  const toggleTts = () => setTtsEnabled(prev => {
    const next = !prev
    localStorage.setItem(TTS_CACHE_KEY, String(next))
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tts_enabled: next }),
    }).catch(() => {})
    return next
  })

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' })
    } catch (_) {}
    setLoggedIn(false)
  }

  const t = themes.light
  const isMobile = layout === 'mobile'
  const isTablet = layout === 'tablet'

  useEffect(() => {
    const handleResize = () => setLayout(getLayout())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 뷰 전환 시 모바일 사이드바 닫기
  useEffect(() => {
    setSidebarOpen(false)
  }, [currentSession, showProjects, showPlanner, currentProject])

  // artifact 생성 시 모바일/태블릿 패널 자동 열기
  useEffect(() => {
    if (artifact && (isMobile || isTablet)) setPanelOpen(true)
  }, [artifact])

  // /api/me가 돌려준 계정 설정을 적용한다.
  // 서버에 값이 없으면(=아직 설정한 적 없음) 남아있는 localStorage 값을
  // 한 번만 올려보낸다. 이미 올라가 있으면 서버 값이 그대로 이기므로
  // 여러 번 실행돼도 결과가 같다(멱등). 실패는 조용히 넘어간다.
  const applyServerSettings = (settings) => {
    if (!settings) return
    const migrate = {}
    if (settings.language) applyLang(settings.language)
    else {
      const cached = localStorage.getItem(LANG_CACHE_KEY)
      if (cached === 'ko' || cached === 'en') migrate.language = cached
    }
    if (settings.tts_enabled !== null && settings.tts_enabled !== undefined) {
      setTtsEnabled(settings.tts_enabled)
      localStorage.setItem(TTS_CACHE_KEY, String(settings.tts_enabled))
    } else if (localStorage.getItem(TTS_CACHE_KEY) !== null) {
      migrate.tts_enabled = localStorage.getItem(TTS_CACHE_KEY) === 'true'
    }
    if (Object.keys(migrate).length) {
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(migrate),
      }).catch(() => {})
    }
  }

  // 프로젝트를 서버로 옮기기 전에는 localStorage에만 있었다.
  // 남아있는 값을 최초 1회 올려보내고 키를 지운다.
  // id를 그대로 넘기는 게 핵심 — 세션 파일의 projectId가 이 id를 가리키고 있어서
  // 서버가 새 id를 부여하면 연결이 전부 끊어진다. 같은 id는 서버가 무시하므로
  // 여러 기기에서 각자 실행돼도 안전하다(멱등).
  const migrateLocalProjects = async () => {
    const raw = localStorage.getItem('roa_projects')
    if (!raw) return
    let list = []
    try { list = JSON.parse(raw) || [] } catch { localStorage.removeItem('roa_projects'); return }
    for (const p of list) {
      if (!p?.id || !p?.name) continue
      let memo = ''
      try { memo = JSON.parse(localStorage.getItem(`roa_project_${p.id}`))?.memo || '' } catch {}
      try {
        await fetch('/api/projects', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id, name: p.name, icon: p.icon, desc: p.desc, memo }),
        })
      } catch { return }   // 네트워크 실패면 키를 남겨두고 다음 기회에 다시 시도
      localStorage.removeItem(`roa_project_${p.id}`)
    }
    localStorage.removeItem('roa_projects')
    setProjectsRev(v => v + 1)
  }

  const refreshTokenInfo = () => {
    fetch('/api/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.success) {
          setTokenInfo({
            daily_tokens: d.daily_tokens ?? 0,
            daily_token_limit: d.daily_token_limit ?? null,
            plan: d.plan ?? 'free',
          })
          if (d.username) setUsername(d.username)
          applyServerSettings(d.settings)
        }
      })
      .catch(() => {})
  }

  const deleteAccount = async () => {
    setSettingsDeleteError('')
    if (!settingsDeletePw) {
      setSettingsDeleteError(lang === 'en' ? 'Enter your password.' : '비밀번호를 입력해주세요.')
      return
    }
    setSettingsDeleteBusy(true)
    try {
      const r = await fetch('/api/account/delete', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: settingsDeletePw }),
      })
      const d = await r.json()
      if (!d.success) {
        setSettingsDeleteError(d.error || (lang === 'en' ? 'Delete failed.' : '탈퇴 처리에 실패했습니다.'))
        return
      }
      window.location.href = '/'
    } catch {
      setSettingsDeleteError(lang === 'en' ? 'Network error.' : '네트워크 오류가 발생했습니다.')
    } finally {
      setSettingsDeleteBusy(false)
    }
  }

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(r => {
        if (!r.ok) {
          setLoggedIn(false)
          return null
        }
        return r.json()
      })
      .then(d => {
        if (d === null) return
        if (d && d.success) {
          setLoggedIn(true)
          setTokenInfo({
            daily_tokens: d.daily_tokens ?? 0,
            daily_token_limit: d.daily_token_limit ?? null,
            plan: d.plan ?? 'free',
          })
          if (d.username) setUsername(d.username)
          applyServerSettings(d.settings)
          migrateLocalProjects()
          restoreOrCreateSession()
        } else {
          setLoggedIn(false)
        }
      })
      .catch(() => setLoggedIn(false))
  }, [])

  // ── 응답 생성 상태 폴링 ───────────────────────────────────
  // 서버는 사용자 연결과 무관하게 응답을 끝까지 생성한다. 세션에 들어오거나
  // 돌아왔을 때 진행 중인 생성이 있으면 이어받아 보여준다.
  const pollRef = useRef(null)
  const pollSidRef = useRef(null)     // 현재 폴링 중인 세션 (중복 시작·교차 오염 방지)
  const pollInFlightRef = useRef(false)
  // 누적 텍스트가 곧 오프셋이다. 별도 offset 상태를 두면 둘이 어긋나 같은 구간을
  // 두 번 이어붙이는 사고가 난다(= 같은 문구 반복 출력).
  const pollTextRef = useRef('')

  // ChatArea가 자기 요청(SSE/재생성)으로 messages를 직접 갱신하는 동안은
  // 폴링이 끼어들어 배열 전체를 덮어쓰지 못하게 한다. 둘 다 messages를 쓰는
  // 상황에서 늦게 도착한 응답이 최신 상태를 지우는 것이 이미지 유실의 한 경로였다.
  const clientTurnRef = useRef(false)

  const stopStatusPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    pollSidRef.current = null
  }, [])

  const beginClientTurn = useCallback(() => {
    clientTurnRef.current = true
    stopStatusPolling()   // 이미 무장된 인터벌이 있으면 해제
  }, [stopStatusPolling])

  const endClientTurn = useCallback(() => { clientTurnRef.current = false }, [])

  const checkStatus = useCallback(async (sid) => {
    if (!sid || clientTurnRef.current) return
    // 이미 조회가 떠 있으면 새로 보내지 않는다. 응답 전에 또 보내면 두 요청이
    // 같은 after로 출발해 같은 구간을 두 번 받아 이어붙이게 된다.
    if (pollInFlightRef.current) return
    pollInFlightRef.current = true
    const sentAfter = pollTextRef.current.length   // 이 요청이 기준으로 삼은 지점
    try {
      const res = await fetch(`/api/sessions/${sid}/status?after=${sentAfter}`)
      const d = await res.json()
      // 응답을 기다리는 사이 세션이 바뀌었거나 ChatArea가 턴을 잡았으면 낡은 응답이다.
      if (pollSidRef.current !== sid || clientTurnRef.current) return
      if (!d.success) return

      if (d.status === 'generating') {
        setGenerating(true)
        // 우리가 보낸 지점에서 계산된 응답일 때만 이어붙인다.
        // 그 사이 누적 길이가 달라졌다면 이미 반영된 구간이므로 버린다.
        if (d.partial_text && sentAfter === pollTextRef.current.length) {
          pollTextRef.current += d.partial_text
        }
        // 재생성 중이면 세션에 남아있는 구 답변은 곧 교체되므로 화면에서 뺀다.
        const base = d.kind === 'regenerate' ? dropLastAssistant(d.messages) : (d.messages || [])
        setMessages(pollTextRef.current
          ? [...base, { role: 'assistant', content: pollTextRef.current, time: nowTime() }]
          : base)
        return
      }

      // 생성 종료 — 세션 파일이 최종 상태다.
      stopStatusPolling()
      setGenerating(false)
      pollTextRef.current = ''
      const finalMsgs = [...(d.messages || [])]
      if (d.generated_image && finalMsgs.length) {
        const last = finalMsgs.length - 1
        if (finalMsgs[last].role === 'assistant') {
          finalMsgs[last] = { ...finalMsgs[last], generatedImage: d.generated_image }
        }
      }
      setMessages(finalMsgs)
    } catch {} finally {
      pollInFlightRef.current = false
    }
  }, [stopStatusPolling])

  const startStatusPolling = useCallback((sid) => {
    if (!sid) return
    // 같은 세션을 이미 폴링 중이면 다시 시작하지 않는다.
    // (409가 연달아 나면 여기서 즉시 조회가 여러 번 겹쳐 발사되던 문제)
    if (pollRef.current && pollSidRef.current === sid) return
    stopStatusPolling()
    pollSidRef.current = sid
    checkStatus(sid)   // 즉시 1회 — 생성 중이 아니면 아래 인터벌은 곧 정리된다
    pollRef.current = setInterval(() => checkStatus(sid), 1500)
  }, [checkStatus, stopStatusPolling])

  // 세션 진입/재진입 시 메시지 로드 + 진행 상태 확인을 한 번에 처리한다.
  // (status 엔드포인트가 messages도 함께 돌려주므로 별도 로드가 필요 없다)
  useEffect(() => {
    stopStatusPolling()
    pollTextRef.current = ''
    pollInFlightRef.current = false
    clientTurnRef.current = false   // 세션이 바뀌면 이전 턴의 소유권은 무효
    setGenerating(false)
    if (!currentSession) return
    startStatusPolling(currentSession)
    return () => stopStatusPolling()
  }, [currentSession, startStatusPolling, stopStatusPolling])

  const restoreOrCreateSession = async () => {
    try {
      const res = await fetch('/api/sessions')
      const d = await res.json()
      if (d.success && d.sessions && d.sessions.length > 0) {
        // 메시지는 위 useEffect(상태 확인)가 status 응답으로 채운다.
        setCurrentSession(d.sessions[0].id)
      } else {
        createNewSession()
      }
    } catch {
      createNewSession()
    }
  }

  // 세션만 새로 만들고 id를 돌려준다. 어느 화면을 보여줄지는 호출부가 정한다.
  const startNewSession = async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' })
      const d = await res.json()
      if (d.success) {
        setCurrentSession(d.session.id)
        setMessages([])
        return d.session.id
      }
    } catch {}
    return null
  }

  const createNewSession = async () => {
    const id = await startNewSession()
    if (id) {
      setCurrentProject(null)
      setShowProjects(false)
      setShowPlanner(false)
    }
  }

  const handleSessionChange = (sid) => {
    setCurrentProject(null)
    setShowProjects(false)
    setShowPlanner(false)
    setShowMeeting(false)
    setCurrentRecording(null)
    setNewRecording(false)
    setMessages([])
    // sid 없이(현재 세션 삭제 등) 채팅 화면에 남으면 이후 전송이 session_id 없이
    // 나가고, 서버는 이를 사용자 구분이 없는 레거시 memory.json 경로로 처리한다
    // (다른 사용자의 대화가 맥락으로 섞이는 경로). 항상 새 세션을 만들어 준다.
    if (!sid) {
      createNewSession()
      return
    }
    // 메시지 로드와 생성 상태 확인은 currentSession useEffect가 함께 처리한다.
    setCurrentSession(sid)
  }

  const handleShowProjects = () => {
    setCurrentSession(null)
    setCurrentProject(null)
    setShowProjects(true)
    setShowPlanner(false)
    setShowMeeting(false)
    setCurrentRecording(null)
    setNewRecording(false)
    setMessages([])
  }

  const handleShowPlanner = () => {
    setCurrentSession(null)
    setCurrentProject(null)
    setShowProjects(false)
    setShowPlanner(true)
    setShowMeeting(false)
    setCurrentRecording(null)
    setNewRecording(false)
    setMessages([])
  }

  // 녹음은 recordings/ 에 독립 저장되므로 채팅 세션이 필요 없다.
  const handleShowMeeting = () => {
    setCurrentProject(null)
    setShowProjects(false)
    setShowPlanner(false)
    setCurrentRecording(null)
    setNewRecording(false)
    setShowMeeting(true)
  }

  const handleProjectOpen = (project) => {
    setShowProjects(false)
    setCurrentProject(project)
  }


  // 설정 모달.
  // 주의: App 안에서 정의된 함수라 <SettingsModal /> 처럼 "컴포넌트"로 렌더하면
  // App이 리렌더될 때마다 새로운 컴포넌트 타입으로 인식되어 서브트리 전체가
  // unmount/mount 된다 — 탈퇴 비밀번호 입력이 한 글자마다 포커스를 잃던 원인.
  // 그래서 아래에서는 SettingsModal() 처럼 일반 함수 호출로 렌더한다.
  const SettingsModal = () => {
    const { daily_tokens, daily_token_limit, plan } = tokenInfo
    const pct = daily_token_limit ? Math.min(100, Math.round((daily_tokens / daily_token_limit) * 100)) : 0
    const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : t.accent
    const planLabel = { free: 'FREE', pro: 'PRO', admin: 'ADMIN' }[plan] ?? 'FREE'
    const planColor = plan === 'admin' ? '#a855f7' : plan === 'pro' ? '#f59e0b' : t.subtext

    return (
      <>
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
        />
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 201, width: 'min(420px, 90vw)',
          background: t.panel, border: `1px solid ${t.border}`,
          borderRadius: 16, padding: '28px 28px 24px',
          fontFamily: t.bodyFont, color: t.text,
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: t.titleFont, color: t.accent, letterSpacing: 1 }}>
                {tl('settings_title')}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 1,
                padding: '2px 8px', borderRadius: 4,
                border: `1px solid ${planColor}`,
                color: planColor, fontFamily: t.titleFont,
              }}>{planLabel}</span>
            </div>
            <button onClick={() => setShowSettings(false)} style={{
              background: 'none', border: 'none', color: t.subtext,
              fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4,
            }}>✕</button>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: t.subtext, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' }}>
              {tl('daily_token_usage')}
            </div>
            {daily_token_limit ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: t.text }}>{tl('token_used')(daily_tokens)}</span>
                  <span style={{ color: t.subtext }}>{tl('token_limit')(daily_token_limit)}</span>
                </div>
                <div style={{ height: 8, background: t.border, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: barColor,
                    borderRadius: 4,
                    transition: 'width 0.4s ease',
                    boxShadow: `0 0 6px ${barColor}88`,
                  }} />
                </div>
                <div style={{ fontSize: 11, color: pct >= 90 ? '#ef4444' : t.subtext, marginTop: 6 }}>
                  {tl('token_pct')(pct)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: t.subtext }}>
                {tl('token_unlimited')(daily_tokens)}
              </div>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: t.subtext, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' }}>
              {lang === 'en' ? 'Plan' : '플랜'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
              {plan === 'admin'
                ? (lang === 'en' ? 'Admin' : '관리자')
                : plan === 'pro'
                  ? 'Roa Pro'
                  : (lang === 'en' ? 'Free' : '무료')}
            </div>
          </div>

          {plan !== 'admin' && (
            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16, marginBottom: 20 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 2,
                color: '#ef4444', fontFamily: t.titleFont,
                textTransform: 'uppercase', marginBottom: 8,
              }}>
                {lang === 'en' ? 'DELETE ACCOUNT' : '회원 탈퇴'}
              </div>
              <div style={{ fontSize: 12, color: t.subtext, marginBottom: 12, lineHeight: 1.6 }}>
                {lang === 'en'
                  ? 'Deleting your account permanently erases all chats, memories, planner, and billing history. This cannot be undone.'
                  : '탈퇴하면 모든 대화, 장기기억, 플래너, 결제 내역이 영구 삭제됩니다. 되돌릴 수 없습니다.'}
              </div>
              {!settingsDeleteOpen ? (
                <button
                  onClick={() => setSettingsDeleteOpen(true)}
                  style={{
                    fontSize: 12, fontFamily: t.titleFont, letterSpacing: 2,
                    color: '#ef4444', border: '1px solid #ef4444',
                    background: 'transparent',
                    padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                  }}
                >{lang === 'en' ? 'DELETE ACCOUNT' : '회원 탈퇴'}</button>
              ) : (
                <div>
                  <input
                    type="password"
                    placeholder={lang === 'en' ? 'Enter password' : '비밀번호 입력'}
                    value={settingsDeletePw}
                    onChange={e => setSettingsDeletePw(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px',
                      border: `1px solid ${t.border}`, borderRadius: 8,
                      fontSize: 13, fontFamily: t.bodyFont, marginBottom: 8,
                      boxSizing: 'border-box',
                      background: t.bg, color: t.text,
                    }}
                  />
                  {settingsDeleteError && (
                    <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>
                      {settingsDeleteError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setSettingsDeleteOpen(false); setSettingsDeletePw(''); setSettingsDeleteError('') }}
                      disabled={settingsDeleteBusy}
                      style={{
                        fontSize: 12, fontFamily: t.titleFont, letterSpacing: 2,
                        color: t.subtext, border: `1px solid ${t.border}`,
                        background: 'transparent',
                        padding: '8px 16px', borderRadius: 8,
                        cursor: settingsDeleteBusy ? 'not-allowed' : 'pointer',
                      }}
                    >{lang === 'en' ? 'CANCEL' : '취소'}</button>
                    <button
                      onClick={deleteAccount}
                      disabled={settingsDeleteBusy}
                      style={{
                        fontSize: 12, fontFamily: t.titleFont, letterSpacing: 2,
                        color: '#fff', border: '1px solid #ef4444',
                        background: '#ef4444',
                        padding: '8px 16px', borderRadius: 8,
                        cursor: settingsDeleteBusy ? 'not-allowed' : 'pointer',
                        opacity: settingsDeleteBusy ? 0.6 : 1,
                      }}
                    >{settingsDeleteBusy
                      ? (lang === 'en' ? 'Processing…' : '처리 중…')
                      : (lang === 'en' ? 'CONFIRM DELETE' : '탈퇴 확정')}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16 }}>
            <button
              onClick={refreshTokenInfo}
              style={{
                fontSize: 12, color: t.subtext, background: 'none',
                border: `1px solid ${t.border}`, borderRadius: 8,
                padding: '6px 14px', cursor: 'pointer', fontFamily: t.bodyFont,
              }}
            >
              {tl('refresh')}
            </button>
          </div>

        </div>
      </>
    )
  }

  // 법적 페이지 / 기능 소개는 로그인 상태와 무관하게 표시
  const path = window.location.pathname
  if (path === '/privacy') return <Privacy />
  if (path === '/terms') return <Terms />
  if (path === '/my/settings') return <Settings />

  if (loggedIn === null) return null
  if (!loggedIn) {
    return <Login onLogin={() => {
      const params = new URLSearchParams(window.location.search)
      const next = params.get('next')
      if (next && /^\/[^/]/.test(next)) {
        window.location.href = next
        return
      }
      setLoggedIn(true); restoreOrCreateSession()
    }} t={t} lang={lang} toggleLang={toggleLang} tl={tl} />
  }
  // 이미 로그인 + ?next= 가 있으면 해당 페이지로 이동.
  {
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next')
    if (next && /^\/[^/]/.test(next)) {
      window.location.href = next
      return null
    }
  }
  const onSettings = () => { refreshTokenInfo(); setShowSettings(true) }



  let mainView
  if (currentProject) {
    mainView = <ProjectView project={currentProject} t={t} tl={tl}
      sessionsRev={sessionsRev} onSessionsChanged={bumpSessions}
      onBack={() => { setCurrentProject(null); setShowProjects(true) }}
      onStartChat={handleSessionChange} />
  } else if (showProjects) {
    mainView = <ProjectsMain t={t} onOpenProject={handleProjectOpen} projectsRev={projectsRev} />
  } else if (showPlanner) {
    mainView = <PlannerView t={t} />
  } else if (showMeeting) {
    if (newRecording) {
      mainView = <MeetingView t={t} tl={tl}
        onBack={() => setNewRecording(false)}
        onDone={(rid) => { setNewRecording(false); setCurrentRecording(rid || null) }} />
    } else if (currentRecording) {
      mainView = <RecordingView t={t} tl={tl} recordingId={currentRecording}
        onBack={() => setCurrentRecording(null)}
        onStartChat={(sid) => { setShowMeeting(false); setCurrentRecording(null); handleSessionChange(sid) }} />
    } else {
      mainView = <RecordingsMain t={t} tl={tl}
        onOpen={(rid) => setCurrentRecording(rid)}
        onNew={() => setNewRecording(true)} />
    }
  } else {
    mainView = <ChatArea messages={messages} setMessages={setMessages}
      sessionId={currentSession} t={t} setArtifact={setArtifact} ttsEnabled={ttsEnabled}
      lang={lang} tl={tl}
      generating={generating}
      onGenerationBusy={() => startStatusPolling(currentSession)}
      onTurnStart={beginClientTurn} onTurnEnd={endClientTurn} />
  }

  // 모바일 오버레이 사이드바 (모바일/태블릿 공용)
  const SidebarOverlay = ({ open, onClose }) => (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.48)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.3s ease',
        }}
      />
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0,
        width: 'min(300px, 85vw)', zIndex: 51,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <Sidebar
          projectsRev={projectsRev}
          sessionsRev={sessionsRev}
          onSessionsChanged={bumpSessions}
          onProjectsChanged={() => setProjectsRev(v => v + 1)}
          currentSession={currentSession}
          onSessionChange={handleSessionChange}
          onShowProjects={handleShowProjects}
          showProjects={showProjects}
          onShowPlanner={handleShowPlanner}
          showPlanner={showPlanner}
          onShowMeeting={handleShowMeeting}
          showMeeting={showMeeting}
          collapsed={false}
          setCollapsed={() => {}}
          t={t}
          tl={tl}
          messagesCount={messages.length}
          isMobile={true}
          onClose={onClose}
          onLogout={handleLogout}
          onSettings={onSettings}
        />
      </div>
    </>
  )

  // ── 모바일 (< 768px) ──────────────────────────────
  if (isMobile) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateRows: `${HEADER_ROW} 1fr`,
        gridTemplateColumns: '1fr',
        height: '100dvh',
        // landscape 노치 / 홈버튼 없는 기기 좌우 safe area
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxSizing: 'border-box',
        overflow: 'hidden',
        overflowX: 'hidden',
        width: '100%',
        maxWidth: '100%',
        background: t.bg,
        fontFamily: t.bodyFont,
        position: 'relative',
      }}>
        <Header
          onLogout={handleLogout}
          t={t}
          ttsEnabled={ttsEnabled} onTtsToggle={toggleTts}
          lang={lang} toggleLang={toggleLang} tl={tl}
          layout="mobile"
          onMenuToggle={() => setSidebarOpen(p => !p)}
          onPanelToggle={() => setPanelOpen(p => !p)}
          panelOpen={panelOpen}
        />

        {/* 명시적 grid 배치 — iOS Safari auto-placement 버그 방어 */}
        <div style={{
          gridColumn: '1 / -1', gridRow: '2 / 3',
          overflow: 'hidden', overflowX: 'hidden',
          minHeight: 0,
          display: 'flex', flexDirection: 'column',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {mainView}
          </div>
        </div>

        {SidebarOverlay({ open: sidebarOpen, onClose: () => setSidebarOpen(false) })}

        <RightPanel
          t={t} artifact={artifact} setArtifact={setArtifact}
          asOverlay={true} isOpen={panelOpen}
          onClose={() => setPanelOpen(false)}
        />
        {showSettings && SettingsModal()}
      </div>
    )
  }

  // ── 태블릿 (768~1024px) ───────────────────────────
  if (isTablet) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateRows: `${HEADER_ROW} 1fr`,
        gridTemplateColumns: `${sidebarCollapsed ? 52 : 240}px 1fr`,
        height: '100dvh',
        // iPad landscape: 좌우 safe area (홈버튼 없는 모델 / Face ID 모델)
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxSizing: 'border-box',
        overflow: 'hidden',
        width: '100%',
        maxWidth: '100%',
        background: t.bg,
        fontFamily: t.bodyFont,
        position: 'relative',
      }}>
        <Header
          onLogout={handleLogout}
          t={t}
          ttsEnabled={ttsEnabled} onTtsToggle={toggleTts}
          lang={lang} toggleLang={toggleLang} tl={tl}
          layout="tablet"
          onPanelToggle={() => setPanelOpen(p => !p)}
          panelOpen={panelOpen}
        />

        {/* gridColumn/gridRow 명시 — iOS Safari auto-placement 버그 방어 */}
        <div style={{
          gridColumn: '1 / 2', gridRow: '2 / 3',
          position: 'relative', zIndex: 30,
          overflow: 'hidden', minHeight: 0,
        }}>
          <Sidebar
            currentSession={currentSession}
            onSessionChange={handleSessionChange}
            onShowProjects={handleShowProjects}
            showProjects={showProjects}
            onShowPlanner={handleShowPlanner}
            showPlanner={showPlanner}
            onShowMeeting={handleShowMeeting}
            showMeeting={showMeeting}
            collapsed={sidebarCollapsed}
            setCollapsed={setSidebarCollapsed}
            t={t}
            tl={tl}
            messagesCount={messages.length}
            onSettings={onSettings}
          />
        </div>

        {/* 메인 콘텐츠 — col 2에 고정, 사이드바 영역(col 1) 침범 불가 */}
        <div style={{
          gridColumn: '2 / 3', gridRow: '2 / 3',
          overflow: 'hidden', minHeight: 0,
          display: 'flex', flexDirection: 'column',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {mainView}
          </div>
        </div>

        <RightPanel
          t={t} artifact={artifact} setArtifact={setArtifact}
          asOverlay={true} isOpen={panelOpen}
          onClose={() => setPanelOpen(false)}
        />
        {showSettings && SettingsModal()}
      </div>
    )
  }

  // ── 데스크탑 (> 1024px) ───────────────────────────
  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: '56px 1fr',
      gridTemplateColumns: `${sidebarCollapsed ? 52 : 240}px 1fr auto`,
      height: '100dvh',
      paddingBottom: 'env(safe-area-inset-bottom)',
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      width: '100%',
      maxWidth: '100%',
      background: t.bg,
      fontFamily: t.bodyFont,
      transition: 'grid-template-columns 0.25s ease',
      position: 'relative',
    }}>
      {/* SW 업데이트 토스트 */}
      {showUpdate && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12,
          background: t.panel, border: `1px solid ${t.accent}`,
          borderRadius: 12, padding: '12px 18px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
          fontFamily: t.bodyFont, fontSize: 13, color: t.text,
          whiteSpace: 'nowrap',
        }}>
          <span>{tl('new_version')}</span>
          <button onClick={applyUpdate} style={{
            padding: '5px 14px', borderRadius: 7,
            border: `1px solid ${t.accent}`, background: t.accentSoft,
            color: t.accent, fontFamily: t.bodyFont, fontSize: 12,
            cursor: 'pointer', fontWeight: 600,
          }}>{tl('reload')}</button>
          <button onClick={dismissUpdate} style={{
            padding: '5px 10px', borderRadius: 7,
            border: `1px solid ${t.border}`, background: 'transparent',
            color: t.subtext, fontFamily: t.bodyFont, fontSize: 12,
            cursor: 'pointer',
          }}>{tl('later')}</button>
        </div>
      )}

      <Header
        onLogout={handleLogout}
        t={t}
        ttsEnabled={ttsEnabled} onTtsToggle={toggleTts}
        lang={lang} toggleLang={toggleLang} tl={tl}
        layout="desktop"
      />

      {/* gridColumn/gridRow 명시 — iOS Safari auto-placement 버그 방어 */}
      <div style={{
        gridColumn: '1 / 2', gridRow: '2 / 3',
        position: 'relative', zIndex: 30,
        overflow: 'hidden', minHeight: 0,
      }}>
        <Sidebar
          projectsRev={projectsRev}
          sessionsRev={sessionsRev}
          onSessionsChanged={bumpSessions}
          onProjectsChanged={() => setProjectsRev(v => v + 1)}
          currentSession={currentSession}
          onSessionChange={handleSessionChange}
          onShowProjects={handleShowProjects}
          showProjects={showProjects}
          onShowPlanner={handleShowPlanner}
          showPlanner={showPlanner}
          onShowMeeting={handleShowMeeting}
          showMeeting={showMeeting}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          t={t}
          tl={tl}
          messagesCount={messages.length}
          onSettings={onSettings}
        />
      </div>

      {/* 메인 콘텐츠 — col 2에 고정, 사이드바 영역(col 1) 침범 불가 */}
      <div style={{
        gridColumn: '2 / 3', gridRow: '2 / 3',
        overflow: 'hidden', minHeight: 0,
        display: 'flex', flexDirection: 'column',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {mainView}
        </div>
      </div>

      <RightPanel t={t} artifact={artifact} setArtifact={setArtifact} />
      {showSettings && SettingsModal()}
    </div>
  )
}
