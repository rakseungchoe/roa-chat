import { useState, useEffect } from 'react'
import RoaLogo from './RoaLogo'
import { createTFn } from '../i18n'
import { LANG_CACHE_KEY } from '../hooks/useLang'

const ACCENT = '#3b82f6'
const BG = '#f8fafc'
const PANEL = '#ffffff'
const TEXT = '#1e293b'
const SUBTEXT = '#64748b'
const BORDER = 'rgba(0,0,0,0.09)'
const TITLE_FONT = "'Orbitron', monospace"
const BODY_FONT = "'Rajdhani', sans-serif"

const PLAN_META = {
  free:   { label: 'FREE',  name: '무료',        color: SUBTEXT },
  pro:    { label: 'PRO',   name: 'Roa Pro',     color: '#f59e0b' },
  admin:  { label: 'ADMIN', name: '관리자',       color: '#a855f7' },
}

export default function Settings() {
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePw, setDeletePw] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // 이 페이지는 App.jsx 밖(독립 라우트)이라 useLang 훅의 상태를 공유하지 않는다.
  // 언어의 진실의 원천은 계정 설정이므로 /api/me 의 settings.language 를 쓰고,
  // 응답 전에는 useLang 과 같은 localStorage 캐시로 첫 렌더를 맞춘다.
  const [lang, setLang] = useState(() => {
    const cached = localStorage.getItem(LANG_CACHE_KEY)
    if (cached === 'ko' || cached === 'en') return cached
    return navigator.language?.startsWith('ko') ? 'ko' : 'en'
  })
  const tl = createTFn(lang)

  const reload = async () => {
    try {
      const meRes = await fetch('/api/me', { credentials: 'include' })
      if (meRes.status === 401) {
        window.location.href = '/?next=/my/settings'
        return
      }
      const meData = await meRes.json()
      if (!meData.success) {
        setError('사용자 정보를 불러오지 못했습니다.')
        return
      }
      setMe(meData)
      const serverLang = meData.settings?.language
      if (serverLang === 'ko' || serverLang === 'en') {
        localStorage.setItem(LANG_CACHE_KEY, serverLang)
        setLang(serverLang)
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const plan = me?.plan ?? 'free'
  const planMeta = PLAN_META[plan] ?? PLAN_META.free
  const handleDelete = async () => {
    setDeleteError('')
    if (!deletePw) { setDeleteError('비밀번호를 입력해주세요.'); return }
    setDeleteBusy(true)
    try {
      const r = await fetch('/api/account/delete', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePw }),
      })
      const d = await r.json()
      if (!d.success) {
        setDeleteError(d.error || '탈퇴 처리에 실패했습니다.')
        return
      }
      window.location.href = '/'
    } catch {
      setDeleteError('네트워크 오류가 발생했습니다.')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: BG,
      fontFamily: BODY_FONT, color: TEXT,
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 32,
        }}>
          <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <RoaLogo size={36} />
          </a>
          <h1 style={{
            fontFamily: TITLE_FONT, fontSize: 18, letterSpacing: 4,
            color: ACCENT, margin: 0, textTransform: 'uppercase',
          }}>Settings</h1>
        </div>

        {loading && (
          <div style={{ color: SUBTEXT, textAlign: 'center', padding: 40 }}>
            로딩 중…
          </div>
        )}
        {error && (
          <div style={{
            color: '#ef4444', background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10,
            padding: '10px 14px', marginBottom: 16, fontSize: 13,
          }}>{error}</div>
        )}

        {!loading && me && (
          <>
            {/* 계정 섹션 */}
            <section style={panelStyle}>
              <div style={sectionTitle}>계정</div>
              <Row label="아이디" value={me.username} />
              <Row
                label="플랜"
                value={
                  <span style={{
                    fontSize: 11, fontFamily: TITLE_FONT, letterSpacing: 1,
                    padding: '2px 8px', borderRadius: 4,
                    border: `1px solid ${planMeta.color}`, color: planMeta.color,
                  }}>{planMeta.label}</span>
                }
              />
            </section>

            {/* 회원 탈퇴 영역 */}
            {plan !== 'admin' && (
              <section style={{
                ...panelStyle,
                border: `1px solid rgba(239,68,68,0.3)`,
              }}>
                <div style={{
                  fontFamily: TITLE_FONT, fontSize: 12, letterSpacing: 3,
                  color: '#ef4444', textTransform: 'uppercase', marginBottom: 12,
                }}>회원 탈퇴</div>
                <div style={{ fontSize: 13, color: SUBTEXT, marginBottom: 16, lineHeight: 1.6 }}>
                  계정을 탈퇴하면 모든 대화, 장기기억, 플래너 데이터가 영구적으로 삭제됩니다.
                  이 작업은 되돌릴 수 없습니다.
                </div>
                {!deleteOpen ? (
                  <button
                    onClick={() => setDeleteOpen(true)}
                    style={{
                      fontSize: 12, fontFamily: TITLE_FONT, letterSpacing: 2,
                      color: '#ef4444', border: '1px solid #ef4444',
                      background: 'transparent',
                      padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                    }}
                  >회원 탈퇴</button>
                ) : (
                  <div>
                    <input
                      type="password"
                      placeholder="비밀번호 입력"
                      value={deletePw}
                      onChange={e => setDeletePw(e.target.value)}
                      style={{
                        width: '100%', padding: '10px 12px',
                        border: `1px solid ${BORDER}`, borderRadius: 8,
                        fontSize: 14, fontFamily: BODY_FONT, marginBottom: 10,
                        boxSizing: 'border-box',
                      }}
                    />
                    {deleteError && (
                      <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10 }}>
                        {deleteError}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => { setDeleteOpen(false); setDeletePw(''); setDeleteError('') }}
                        disabled={deleteBusy}
                        style={{
                          fontSize: 12, fontFamily: TITLE_FONT, letterSpacing: 2,
                          color: SUBTEXT, border: `1px solid ${BORDER}`,
                          background: 'transparent',
                          padding: '8px 16px', borderRadius: 8,
                          cursor: deleteBusy ? 'not-allowed' : 'pointer',
                        }}
                      >취소</button>
                      <button
                        onClick={handleDelete}
                        disabled={deleteBusy}
                        style={{
                          fontSize: 12, fontFamily: TITLE_FONT, letterSpacing: 2,
                          color: '#fff', border: '1px solid #ef4444',
                          background: '#ef4444',
                          padding: '8px 16px', borderRadius: 8,
                          cursor: deleteBusy ? 'not-allowed' : 'pointer',
                          opacity: deleteBusy ? 0.6 : 1,
                        }}
                      >{deleteBusy ? '처리 중…' : '탈퇴 확정'}</button>
                    </div>
                  </div>
                )}
              </section>
            )}

            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <a href="/" style={{
                fontSize: 12, color: SUBTEXT, textDecoration: 'none',
                fontFamily: TITLE_FONT, letterSpacing: 2,
              }}>← 대시보드로</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const panelStyle = {
  background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 14, padding: 24, marginBottom: 20,
}

const sectionTitle = {
  fontFamily: TITLE_FONT, fontSize: 12, letterSpacing: 3,
  color: ACCENT, textTransform: 'uppercase',
  marginBottom: 16,
}

function Row({ label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0',
      borderBottom: `1px solid ${BORDER}`,
    }}>
      <span style={{ fontSize: 13, color: SUBTEXT, letterSpacing: 1, textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: TEXT }}>{value}</span>
    </div>
  )
}
