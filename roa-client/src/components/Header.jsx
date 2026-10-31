import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import RoaLogo from './RoaLogo'

function weatherIcon(desc) {
  if (!desc) return '🌡️'
  if (desc.includes('맑') || desc.includes('clear')) return '☀️'
  if (desc.includes('구름') || desc.includes('cloud')) return '☁️'
  if (desc.includes('비') || desc.includes('rain')) return '🌧️'
  if (desc.includes('눈') || desc.includes('snow')) return '❄️'
  if (desc.includes('안개') || desc.includes('fog')) return '🌫️'
  if (desc.includes('천둥') || desc.includes('thunder')) return '⛈️'
  return '🌤️'
}

const KR_TO_EN_WEATHER = {
  '맑음': 'Clear', '구름조금': 'Few clouds', '구름 조금': 'Few clouds',
  '튼구름': 'Broken clouds', '흐림': 'Cloudy', '온흐림': 'Overcast',
  '이슬비': 'Drizzle', '가벼운 비': 'Light rain', '보통 비': 'Moderate rain',
  '강한 비': 'Heavy rain', '폭우': 'Heavy rain', '약한 눈': 'Light snow',
  '눈': 'Snow', '진눈깨비': 'Sleet', '뇌우': 'Thunderstorm',
  '안개': 'Fog', '연무': 'Mist', '박무': 'Haze',
}

function translateDesc(desc, lang) {
  if (!desc || lang !== 'en') return desc
  return KR_TO_EN_WEATHER[desc.trim()] || desc
}

// layout: 'mobile' | 'tablet' | 'desktop'
export default function Header({
  t,
  layout = 'desktop', onPanelToggle, panelOpen, onMenuToggle,
  ttsEnabled, onTtsToggle,
  onLogout,
  lang = 'ko', toggleLang, tl = (k) => k,
}) {
  const [weather, setWeather] = useState(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [usageData, setUsageData] = useState(null)
  const dropdownRef = useRef(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  const openDeleteModal = useCallback(() => {
    setDropdownOpen(false)
    setDeletePassword('')
    setDeleteError('')
    setDeleteLoading(false)
    setDeleteModalOpen(true)
  }, [])

  const closeDeleteModal = useCallback(() => {
    setDeleteModalOpen(false)
  }, [])

  const confirmDeleteAccount = useCallback(async () => {
    if (!deletePassword) { setDeleteError(tl('enter_password_error')); return }
    setDeleteLoading(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: deletePassword }),
      })
      const data = await res.json()
      if (data.success) {
        onLogout()
      } else {
        setDeleteError(data.error || tl('unknown_error'))
        setDeleteLoading(false)
      }
    } catch {
      setDeleteError(tl('network_error'))
      setDeleteLoading(false)
    }
  }, [deletePassword, onLogout])
  const isMobile = layout === 'mobile'
  const isTablet = layout === 'tablet'
  const isLight = t.isLight !== false

  useEffect(() => {
    fetch('/api/weather').then(r => r.json()).then(d => { if (d.success) setWeather(d.data || d) }).catch(() => {})
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          fetch('/api/weather/location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          }).then(r => r.json()).then(d => { if (d.success) setWeather(d.data) }).catch(() => {})
        },
        () => {}
      )
    }
  }, [])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 설정 드롭다운 토글 행
  const ToggleRow = ({ label, active, onToggle }) => (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 16px', cursor: 'pointer', transition: 'background 0.12s',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = t.accentSoft }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: t.text, fontFamily: t.bodyFont }}>{label}</span>
      </div>
      {/* 토글 스위치 */}
      <div style={{
        width: 40, height: 22, borderRadius: 11, flexShrink: 0,
        background: active ? t.accent : (isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.18)'),
        position: 'relative', transition: 'background 0.2s',
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 2,
          left: active ? 20 : 2,
          transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }} />
      </div>
    </div>
  )

  // 공통 헤더 (모바일/태블릿/데스크탑)
  return (
    <div style={{
      gridColumn: isMobile ? undefined : '1 / -1',
      display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
      paddingLeft: isMobile ? 12 : 24,
      paddingRight: isMobile ? 12 : 24,
      paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0,
      paddingBottom: isMobile ? 8 : 0,
      gap: isMobile ? 8 : 12,
      borderBottom: `1px solid ${t.border}`,
      background: t.headerBg,
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      position: 'relative', zIndex: 10,
      boxShadow: isLight ? '0 1px 0 rgba(0,0,0,0.06)' : 'none',
    }}>

      {/* 모바일: 햄버거 */}
      {isMobile && (
        <button onClick={onMenuToggle} style={{
          width: 36, height: 36, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: `1px solid ${t.border}`,
          color: t.subtext, borderRadius: 8, cursor: 'pointer', fontSize: 14,
          WebkitTapHighlightColor: 'transparent',
        }}>☰</button>
      )}

      {/* 로고 (모드 선택 버튼이 있던 자리를 로고가 대신한다) */}
      <RoaLogo size={isMobile ? 28 : (isTablet ? 32 : 36)} />

      {/* 스페이서 */}
      <div style={{ flex: 1 }} />

      {/* 날씨 */}
      {weather && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
          title={`${translateDesc(weather.desc, lang)} · ${tl('weather_title')(Math.round(weather.feels), weather.humidity, weather.city)}`}
        >
          <span style={{ fontSize: isMobile ? 14 : 16 }}>{weatherIcon(weather.desc)}</span>
          {isMobile ? (
            <span style={{ fontSize: 12, color: t.accent, fontFamily: t.titleFont, fontWeight: 700 }}>
              {Math.round(weather.temp)}°
            </span>
          ) : (
            <>
              <span style={{ fontSize: 13, color: t.accent, fontFamily: t.titleFont, fontWeight: 700 }}>{Math.round(weather.temp)}°C</span>
              <span style={{ fontSize: 11, color: t.border }}>|</span>
              <span style={{ fontSize: 11, color: t.text }}>{translateDesc(weather.desc, lang)}</span>
              <span style={{ fontSize: 11, color: t.border }}>|</span>
              <span style={{ fontSize: 11, color: t.subtext }}>{weather.city}</span>
            </>
          )}
        </div>
      )}

      {/* 패널 토글 (artifact 뷰어) */}
      {onPanelToggle && (
        <button
          onClick={onPanelToggle}
          title={tl('artifact_panel')}
          style={{
            width: isMobile ? 36 : 34, height: isMobile ? 36 : 34, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: panelOpen ? t.accentSoft : 'transparent',
            border: `1px solid ${panelOpen ? t.accent : t.border}`,
            color: panelOpen ? t.accent : t.subtext,
            borderRadius: 8, cursor: 'pointer', fontSize: 14,
            transition: 'all 0.18s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >CODE</button>
      )}

      {/* ⚙️ 설정 버튼 + 드롭다운 */}
      <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => {
            const next = !dropdownOpen
            setDropdownOpen(next)
            if (next) {
              fetch('/api/me', { credentials: 'include' })
                .then(r => r.json())
                .then(d => { if (d.success) setUsageData(d) })
                .catch(() => {})
            }
          }}
          title={tl('settings')}
          style={{
            width: isMobile ? 36 : 34, height: isMobile ? 36 : 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: dropdownOpen ? t.accentSoft : 'transparent',
            border: `1px solid ${dropdownOpen ? t.accent : t.border}`,
            color: dropdownOpen ? t.accent : t.subtext,
            borderRadius: 8, cursor: 'pointer', fontSize: 16,
            transition: 'all 0.18s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >⚙</button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            background: t.panel, border: `1px solid ${t.border}`,
            borderRadius: 12, overflow: 'hidden', zIndex: 200, minWidth: 210,
            boxShadow: isLight
              ? '0 4px 20px rgba(0,0,0,0.12)'
              : '0 4px 24px rgba(0,0,0,0.55)',
          }}>
            {/* 사용량 표시 */}
            {usageData && (() => {
              const used = usageData.daily_tokens ?? 0
              const limit = usageData.daily_token_limit ?? 0
              const pct = limit > 0 ? Math.min(used / limit, 1) : 0
              const isAdmin = usageData.plan === 'admin'
              return (
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: t.subtext, fontFamily: t.titleFont, letterSpacing: 0.5 }}>{tl('today_usage')}</span>
                    <span style={{ fontSize: 11, color: t.subtext, fontFamily: t.bodyFont }}>
                      {isAdmin ? '∞' : `${used.toLocaleString()} / ${limit.toLocaleString()} ${tl('tokens')}`}
                    </span>
                  </div>
                  {!isAdmin && (
                    <div style={{ height: 4, borderRadius: 2, background: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${pct * 100}%`,
                        background: pct > 0.9 ? '#ef4444' : pct > 0.7 ? '#f59e0b' : t.accent,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  )}
                </div>
              )
            })()}
            {/* 🌐 언어 전환 */}
            {toggleLang && (
              <div
                onClick={toggleLang}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 16px', cursor: 'pointer', transition: 'background 0.12s',
                  WebkitTapHighlightColor: 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = t.accentSoft }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: t.text, fontFamily: t.bodyFont }}>
                    {lang === 'ko' ? 'English' : '한국어'}
                  </span>
                </div>
                <span style={{
                  fontSize: 11, color: t.accent, fontFamily: t.titleFont,
                  letterSpacing: 1, border: `1px solid ${t.accent}`,
                  padding: '2px 7px', borderRadius: 4,
                }}>
                  {lang === 'ko' ? 'KO' : 'EN'}
                </span>
              </div>
            )}
            <ToggleRow
              label={tl('voice')}
              active={ttsEnabled}
              onToggle={onTtsToggle}
            />
            <div style={{ height: 1, background: t.border }} />
            <div
              onClick={() => { setDropdownOpen(false); onLogout() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 16px', cursor: 'pointer', transition: 'background 0.12s',
                WebkitTapHighlightColor: 'transparent',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: 15, width: 22, textAlign: 'center', lineHeight: 1 }}>⊘</span>
              <span style={{
                fontSize: 13, color: t.dangerText,
                fontFamily: t.titleFont, letterSpacing: 1,
              }}>{tl('logout')}</span>
            </div>
            <div style={{ height: 1, background: t.border }} />
            <div
              onClick={openDeleteModal}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 16px', cursor: 'pointer', transition: 'background 0.12s',
                WebkitTapHighlightColor: 'transparent',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: 15, width: 22, textAlign: 'center', lineHeight: 1 }}>✕</span>
              <span style={{ fontSize: 13, color: '#ef4444', fontFamily: t.bodyFont }}>{tl('delete_account')}</span>
            </div>
          </div>
        )}
      </div>

      {/* 계정 삭제 모달 — portal로 body에 마운트하여 stacking context 탈출 */}
      {deleteModalOpen && createPortal(
        <>
          <div
            onClick={closeDeleteModal}
            style={{
              position: 'fixed', inset: 0, zIndex: 9000,
              background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 9001, width: 'min(360px, 90vw)',
            background: t.panel,
            border: `1px solid rgba(239,68,68,0.4)`,
            borderRadius: 16, padding: '28px 24px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 40px rgba(239,68,68,0.08)',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {/* 제목 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                fontSize: 14, fontWeight: 700,
                fontFamily: t.titleFont, letterSpacing: 2,
                color: '#ef4444',
              }}>{tl('delete_account')}</span>
              <button
                onClick={closeDeleteModal}
                style={{
                  background: 'none', border: 'none', color: t.subtext,
                  fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 4,
                }}
              >✕</button>
            </div>

            {/* 경고 문구 */}
            <div style={{
              fontSize: 13, color: t.text, lineHeight: 1.7,
              padding: '12px 14px',
              background: 'rgba(239,68,68,0.06)',
              border: `1px solid rgba(239,68,68,0.2)`,
              borderRadius: 8,
            }}>
              {lang === 'ko' ? (
                <>
                  계정을 삭제하면 모든 대화, 기억, 플래너 데이터가{' '}
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>영구적으로 삭제</span>됩니다.
                  <br />이 작업은 되돌릴 수 없습니다.
                </>
              ) : (
                <>
                  Deleting your account will{' '}
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>permanently remove</span>{' '}
                  all conversations, memory, and planner data.
                  <br />This action cannot be undone.
                </>
              )}
            </div>

            {/* 비밀번호 입력 */}
            <input
              type="password"
              placeholder={tl('enter_password')}
              autoComplete="current-password"
              value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !deleteLoading) confirmDeleteAccount() }}
              autoFocus
              style={{
                padding: '10px 14px',
                background: t.inputBg ?? 'rgba(0,0,0,0.2)',
                border: `1px solid ${deleteError ? 'rgba(239,68,68,0.6)' : t.border}`,
                borderRadius: 8,
                color: t.text,
                fontFamily: t.bodyFont,
                fontSize: 14,
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />

            {/* 에러 메시지 */}
            {deleteError && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: -8 }}>
                {deleteError}
              </div>
            )}

            {/* 버튼 */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={closeDeleteModal}
                style={{
                  padding: '8px 18px',
                  border: `1px solid ${t.border}`,
                  background: 'transparent',
                  color: t.subtext,
                  borderRadius: 8,
                  fontFamily: t.bodyFont,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >{tl('cancel')}</button>
              <button
                onClick={confirmDeleteAccount}
                disabled={deleteLoading}
                style={{
                  padding: '8px 18px',
                  border: '1px solid rgba(239,68,68,0.6)',
                  background: deleteLoading ? 'rgba(239,68,68,0.06)' : 'transparent',
                  color: '#ef4444',
                  borderRadius: 8,
                  fontFamily: t.bodyFont,
                  fontSize: 13,
                  cursor: deleteLoading ? 'not-allowed' : 'pointer',
                  opacity: deleteLoading ? 0.6 : 1,
                  transition: 'all 0.15s',
                }}
              >{deleteLoading ? tl('processing') : tl('withdraw')}</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
