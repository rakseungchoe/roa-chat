import { useState } from 'react'
import RoaLogo from './RoaLogo'

const inputStyle = (t) => ({
  background: t.inputBg, border: `1px solid ${t.border}`, color: t.text,
  padding: '10px 14px', fontFamily: t.bodyFont, fontSize: 14,
  outline: 'none', borderRadius: 8, width: '100%', boxSizing: 'border-box',
})

export default function Login({ onLogin, t, onBack, lang = 'ko', toggleLang, tl = (k) => k }) {
  const [tab, setTab] = useState('login')

  // 로그인 상태
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 비밀번호 찾기 상태
  const [forgotStep, setForgotStep] = useState(null) // null | 'email' | 'code'
  const [forgotUsername, setForgotUsername] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [findIdEmail, setFindIdEmail] = useState('')
  const [findIdMsg, setFindIdMsg] = useState('')
  const [forgotCode, setForgotCode] = useState('')
  const [forgotNewPw, setForgotNewPw] = useState('')
  const [forgotNewPwConfirm, setForgotNewPwConfirm] = useState('')
  const [forgotError, setForgotError] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  // 회원가입 상태
  const [regId, setRegId] = useState('')
  const [regPw, setRegPw] = useState('')
  const [regPwConfirm, setRegPwConfirm] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regCode, setRegCode] = useState('')
  const [regStep, setRegStep] = useState('form') // 'form' | 'verify'
  const [regError, setRegError] = useState('')
  const [regSuccess, setRegSuccess] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [usernameCheck, setUsernameCheck] = useState(null) // null | 'available' | 'taken'
  const [usernameCheckMsg, setUsernameCheckMsg] = useState('')
  const [usernameCheckLoading, setUsernameCheckLoading] = useState(false)

  const handleRegIdChange = (v) => {
    setRegId(v)
    if (usernameCheck !== null) {
      setUsernameCheck(null)
      setUsernameCheckMsg('')
    }
  }

  const handleCheckUsername = async () => {
    if (!regId.trim()) return
    setUsernameCheckLoading(true)
    try {
      const res = await fetch(`/api/check-username?username=${encodeURIComponent(regId.trim())}`)
      const d = await res.json()
      if (d.available) {
        setUsernameCheck('available')
        setUsernameCheckMsg(tl('username_available'))
      } else {
        setUsernameCheck('taken')
        setUsernameCheckMsg(d.error || tl('username_taken'))
      }
    } catch {
      setUsernameCheck('taken')
      setUsernameCheckMsg(tl('connect_error'))
    }
    setUsernameCheckLoading(false)
  }

  const handleLogin = async () => {
    if (!id.trim() || !pw.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: id, password: pw })
      })
      const d = await res.json()
      if (d.success) onLogin()
      else setError(d.error || tl('login_failed'))
    } catch {
      setError(tl('connect_error'))
    }
    setLoading(false)
  }

  // 아이디 찾기: 이메일로 가입된 아이디를 메일 발송
  const handleFindId = async () => {
    if (!findIdEmail.trim()) return
    setForgotLoading(true)
    setForgotError('')
    setFindIdMsg('')
    try {
      const res = await fetch('/api/find-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: findIdEmail })
      })
      const d = await res.json()
      if (d.success) setFindIdMsg(tl('find_id_sent'))
      else setForgotError(d.error || tl('send_failed'))
    } catch {
      setForgotError(tl('connect_error'))
    }
    setForgotLoading(false)
  }

  // 비밀번호 찾기: 이메일 발송
  const handleForgotSend = async () => {
    if (!forgotUsername.trim() || !forgotEmail.trim()) return
    setForgotLoading(true)
    setForgotError('')
    setForgotSuccess('')
    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername, email: forgotEmail })
      })
      const d = await res.json()
      if (d.success) {
        setForgotStep('code')
        setForgotSuccess(tl('code_sent'))
      } else {
        setForgotError(d.error || tl('send_failed'))
      }
    } catch {
      setForgotError(tl('connect_error'))
    }
    setForgotLoading(false)
  }

  // 비밀번호 찾기: 코드 + 새 비밀번호로 재설정
  const handleForgotReset = async () => {
    if (!forgotCode.trim() || !forgotNewPw.trim() || !forgotNewPwConfirm.trim()) {
      setForgotError(tl('fill_all_fields'))
      return
    }
    if (forgotNewPw !== forgotNewPwConfirm) {
      setForgotError(tl('pw_no_match'))
      return
    }
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]).{8,}$/
    if (!pwRegex.test(forgotNewPw)) {
      setForgotError(tl('pw_complexity'))
      return
    }
    setForgotLoading(true)
    setForgotError('')
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername, email: forgotEmail, code: forgotCode, new_password: forgotNewPw })
      })
      const d = await res.json()
      if (d.success) {
        setForgotStep(null)
        setForgotUsername(''); setForgotEmail(''); setForgotCode(''); setForgotNewPw(''); setForgotNewPwConfirm('')
        setForgotSuccess('')
        setError(tl('pw_changed'))
      } else {
        setForgotError(d.error || tl('reset_failed'))
      }
    } catch {
      setForgotError(tl('connect_error'))
    }
    setForgotLoading(false)
  }

  const handleRegister = async () => {
    if (!regId.trim() || !regPw.trim() || !regEmail.trim() || !regPwConfirm.trim()) {
      setRegError(tl('fill_all_fields'))
      return
    }
    if (regPw !== regPwConfirm) {
      setRegError(tl('pw_no_match'))
      return
    }
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]).{8,}$/
    if (!pwRegex.test(regPw)) {
      setRegError(tl('pw_complexity'))
      return
    }
    if (!agreePrivacy || !agreeTerms) {
      setRegError(tl('agree_required'))
      return
    }
    if (usernameCheck !== 'available') {
      setRegError(tl('username_check_required'))
      return
    }
    setRegLoading(true)
    setRegError('')
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: regId, password: regPw, email: regEmail })
      })
      const d = await res.json()
      if (d.success) {
        setRegStep('verify')
        setRegSuccess(tl('verification_sent'))
      } else {
        setRegError(d.error || tl('register_failed'))
      }
    } catch {
      setRegError(tl('connect_error'))
    }
    setRegLoading(false)
  }

  const handleVerify = async () => {
    if (!regCode.trim()) return
    setRegLoading(true)
    setRegError('')
    try {
      const res = await fetch('/api/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: regId, code: regCode })
      })
      const d = await res.json()
      if (d.success) {
        window.location.href = '/'
        return
      } else {
        setRegError(d.error || tl('verify_failed'))
      }
    } catch {
      setRegError(tl('connect_error'))
    }
    setRegLoading(false)
  }

  const switchTab = (t) => {
    setTab(t)
    setError(''); setRegError(''); setRegSuccess('')
    setForgotStep(null); setForgotError(''); setForgotSuccess('')
    setForgotEmail(''); setForgotCode(''); setForgotNewPw(''); setForgotNewPwConfirm('')
    setRegStep('form')
    setAgreePrivacy(false); setAgreeTerms(false)
    setUsernameCheck(null); setUsernameCheckMsg('')
  }

  const tabStyle = (active) => ({
    flex: 1, padding: '8px 0', background: 'transparent',
    border: 'none', borderBottom: active ? `2px solid ${t.accent}` : `2px solid transparent`,
    color: active ? t.accent : t.subtext,
    fontFamily: t.bodyFont, fontSize: 12, letterSpacing: 3,
    cursor: 'pointer', transition: 'all 0.2s',
  })

  const pwStrength = (pw) => {
    const hasLetter = /[a-zA-Z]/.test(pw)
    const hasNum = /\d/.test(pw)
    const hasSym = /[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]/.test(pw)
    const isLong = pw.length >= 8
    const missing = []
    if (!hasLetter) missing.push(tl('pw_strength_letter'))
    if (!hasNum) missing.push(tl('pw_strength_num'))
    if (!hasSym) missing.push(tl('pw_strength_sym'))
    if (!isLong) missing.push(`${pw.length}/8`)
    return missing
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', flexDirection: 'column', gap: 24,
      position: 'relative', zIndex: 1,
      background: t.bg, fontFamily: t.bodyFont,
    }}>
      {/* 🌐 언어 전환 버튼 */}
      {toggleLang && (
        <button
          onClick={toggleLang}
          style={{
            position: 'absolute', top: 20, right: 20,
            background: 'transparent', border: `1px solid ${t.border}`,
            color: t.subtext, fontFamily: t.bodyFont,
            fontSize: 12, cursor: 'pointer', letterSpacing: 1,
            padding: '5px 12px', borderRadius: 8,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.color = t.accent }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.subtext }}
        >
          {lang === 'ko' ? 'KO' : 'EN'}
        </button>
      )}

      {onBack && (
        <button onClick={onBack} style={{
          position: 'absolute', top: 20, left: 20,
          background: 'transparent', border: 'none',
          color: t.subtext, fontFamily: t.bodyFont,
          fontSize: 13, cursor: 'pointer', letterSpacing: 1,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8,
          transition: 'color 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.color = t.accent}
          onMouseLeave={e => e.currentTarget.style.color = t.subtext}
        >
          {tl('back_home')}
        </button>
      )}
      <RoaLogo size={120} />
      <div style={{ fontSize: 12, color: t.subtext, letterSpacing: 4 }}>{tl('personal_ai')}</div>

      <div style={{
        display: 'flex', flexDirection: 'column', width: 300,
        background: t.panel, border: `1px solid ${t.border}`,
        marginTop: 16, borderRadius: 12,
        boxShadow: t.bg === '#f5f6fa' ? '0 4px 20px rgba(0,0,0,0.08)' : 'none',
        overflow: 'hidden',
      }}>
        {/* 탭 */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}` }}>
          <button style={tabStyle(tab === 'login')} onClick={() => switchTab('login')}>LOGIN</button>
          <button style={tabStyle(tab === 'register')} onClick={() => switchTab('register')}>REGISTER</button>
        </div>

        {/* 로그인 폼 */}
        {tab === 'login' && !forgotStep && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 32 }}>
            <input value={id} onChange={e => setId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder={tl('username_ph')} autoFocus style={inputStyle(t)} />
            <input value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              type="password" placeholder={tl('password_ph')} style={inputStyle(t)} />
            {error && (
              <div style={{ color: (error === tl('register_done') || error === tl('pw_changed')) ? t.accent : '#ef4444', fontSize: 12 }}>
                {error}
              </div>
            )}
            <button onClick={handleLogin} disabled={loading} style={{
              background: t.accentSoft, border: `1px solid ${t.accent}`,
              color: t.accent, padding: '10px 0', fontFamily: t.titleFont, fontSize: 12,
              letterSpacing: 4, marginTop: 8, cursor: 'pointer', borderRadius: 8,
              opacity: loading ? 0.6 : 1,
            }}>{loading ? '...' : 'LOGIN'}</button>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4 }}>
              <button
                onClick={() => { setForgotStep('findId'); setError(''); setForgotError(''); setFindIdMsg('') }}
                style={{
                  background: 'transparent', border: 'none',
                  color: t.subtext, fontSize: 12, cursor: 'pointer',
                  fontFamily: t.bodyFont, transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = t.accent}
                onMouseLeave={e => e.currentTarget.style.color = t.subtext}
              >
                {tl('find_username')}
              </button>
              <span style={{ color: t.border, fontSize: 12 }}>·</span>
              <button
                onClick={() => { setForgotStep('email'); setError(''); setForgotError(''); setForgotSuccess('') }}
                style={{
                  background: 'transparent', border: 'none',
                  color: t.subtext, fontSize: 12, cursor: 'pointer',
                  fontFamily: t.bodyFont, transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = t.accent}
                onMouseLeave={e => e.currentTarget.style.color = t.subtext}
              >
                {tl('forgot_password')}
              </button>
            </div>
          </div>
        )}

        {/* 아이디 찾기 - 이메일 입력 */}
        {tab === 'login' && forgotStep === 'findId' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 32 }}>
            <div style={{ color: t.text, fontSize: 13, fontWeight: 600, letterSpacing: 1 }}>{tl('find_username')}</div>
            <div style={{ color: t.subtext, fontSize: 12 }}>{tl('find_username_desc')}</div>
            {findIdMsg
              ? <div style={{ color: t.accent, fontSize: 12, lineHeight: 1.6 }}>{findIdMsg}</div>
              : <>
                  <input value={findIdEmail} onChange={e => setFindIdEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFindId()}
                    type="email" placeholder={tl('email_ph')} autoFocus style={inputStyle(t)} />
                  {forgotError && <div style={{ color: '#ef4444', fontSize: 12 }}>{forgotError}</div>}
                  <button onClick={handleFindId} disabled={forgotLoading} style={{
                    background: t.accentSoft, border: `1px solid ${t.accent}`,
                    color: t.accent, padding: '10px 0', fontFamily: t.titleFont, fontSize: 12,
                    letterSpacing: 4, marginTop: 4, cursor: 'pointer', borderRadius: 8,
                    opacity: forgotLoading ? 0.6 : 1,
                  }}>{forgotLoading ? '...' : tl('send_code')}</button>
                </>
            }
            <button onClick={() => { setForgotStep(null); setForgotError(''); setFindIdMsg(''); setFindIdEmail('') }}
              style={{
                background: 'transparent', border: 'none',
                color: t.subtext, fontSize: 12, cursor: 'pointer', fontFamily: t.bodyFont,
              }}>{tl('back_to_login')}</button>
          </div>
        )}

        {/* 비밀번호 찾기 - 이메일 입력 */}
        {tab === 'login' && forgotStep === 'email' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 32 }}>
            <div style={{ color: t.text, fontSize: 13, fontWeight: 600, letterSpacing: 1 }}>{tl('reset_password_title')}</div>
            <div style={{ color: t.subtext, fontSize: 12 }}>{tl('reset_password_desc')}</div>
            <input value={forgotUsername} onChange={e => setForgotUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleForgotSend()}
              placeholder={tl('username_ph')} autoFocus style={inputStyle(t)} />
            <input value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleForgotSend()}
              type="email" placeholder={tl('email_ph')} style={inputStyle(t)} />
            {forgotError && <div style={{ color: '#ef4444', fontSize: 12 }}>{forgotError}</div>}
            <button onClick={handleForgotSend} disabled={forgotLoading} style={{
              background: t.accentSoft, border: `1px solid ${t.accent}`,
              color: t.accent, padding: '10px 0', fontFamily: t.titleFont, fontSize: 12,
              letterSpacing: 4, marginTop: 4, cursor: 'pointer', borderRadius: 8,
              opacity: forgotLoading ? 0.6 : 1,
            }}>{forgotLoading ? '...' : tl('send_code')}</button>
            <button onClick={() => { setForgotStep(null); setForgotError('') }}
              style={{
                background: 'transparent', border: 'none',
                color: t.subtext, fontSize: 12, cursor: 'pointer', fontFamily: t.bodyFont,
              }}>{tl('back_to_login')}</button>
          </div>
        )}

        {/* 비밀번호 찾기 - 코드 + 새 비밀번호 입력 */}
        {tab === 'login' && forgotStep === 'code' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 32 }}>
            <div style={{ color: t.text, fontSize: 13, fontWeight: 600, letterSpacing: 1 }}>{tl('set_new_password')}</div>
            {forgotSuccess && <div style={{ color: t.accent, fontSize: 12 }}>{forgotSuccess}</div>}
            <div style={{ color: t.subtext, fontSize: 12 }}>{tl('enter_code_sent_to')(forgotEmail)}</div>
            <input value={forgotCode} onChange={e => setForgotCode(e.target.value)}
              placeholder={tl('reset_code_ph')} autoFocus
              maxLength={6}
              style={{ ...inputStyle(t), letterSpacing: 8, textAlign: 'center', fontSize: 18 }} />
            <div>
              <input value={forgotNewPw} onChange={e => setForgotNewPw(e.target.value)}
                type="password" placeholder={tl('new_password_ph')} style={inputStyle(t)} />
              {forgotNewPw.length > 0 && (() => {
                const missing = pwStrength(forgotNewPw)
                if (missing.length === 0) return <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>{tl('password_valid')}</div>
                return <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>{tl('password_needs')(missing)}</div>
              })()}
            </div>
            <div>
              <input value={forgotNewPwConfirm} onChange={e => setForgotNewPwConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleForgotReset()}
                type="password" placeholder={tl('reg_confirm_ph')} style={inputStyle(t)} />
              {forgotNewPwConfirm.length > 0 && (
                <div style={{ fontSize: 11, marginTop: 4, color: forgotNewPw === forgotNewPwConfirm ? '#22c55e' : '#ef4444' }}>
                  {forgotNewPw === forgotNewPwConfirm ? tl('pw_match') : tl('pw_no_match')}
                </div>
              )}
            </div>
            {forgotError && <div style={{ color: '#ef4444', fontSize: 12 }}>{forgotError}</div>}
            <button onClick={handleForgotReset} disabled={forgotLoading} style={{
              background: t.accentSoft, border: `1px solid ${t.accent}`,
              color: t.accent, padding: '10px 0', fontFamily: t.titleFont, fontSize: 12,
              letterSpacing: 4, marginTop: 4, cursor: 'pointer', borderRadius: 8,
              opacity: forgotLoading ? 0.6 : 1,
            }}>{forgotLoading ? '...' : tl('change_password')}</button>
            <button onClick={() => { setForgotStep('email'); setForgotError(''); setForgotSuccess(''); setForgotCode(''); setForgotNewPw(''); setForgotNewPwConfirm('') }}
              style={{
                background: 'transparent', border: 'none',
                color: t.subtext, fontSize: 12, cursor: 'pointer', fontFamily: t.bodyFont,
              }}>{tl('re_enter_email')}</button>
          </div>
        )}

        {/* 회원가입 폼 */}
        {tab === 'register' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 32 }}>
            {regStep === 'form' ? (
              <>
                <div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={regId} onChange={e => handleRegIdChange(e.target.value)}
                      placeholder={tl('reg_username_ph')} autoFocus style={{ ...inputStyle(t), flex: 1 }} />
                    <button onClick={handleCheckUsername}
                      disabled={usernameCheckLoading || !regId.trim()}
                      style={{
                        background: t.accentSoft, border: `1px solid ${t.accent}`,
                        color: t.accent, padding: '0 14px', fontFamily: t.titleFont, fontSize: 11,
                        letterSpacing: 2, cursor: (usernameCheckLoading || !regId.trim()) ? 'not-allowed' : 'pointer',
                        borderRadius: 8, whiteSpace: 'nowrap',
                        opacity: (usernameCheckLoading || !regId.trim()) ? 0.4 : 1,
                      }}>{usernameCheckLoading ? '...' : tl('check_duplicate')}</button>
                  </div>
                  {usernameCheck && (
                    <div style={{
                      fontSize: 11, marginTop: 4,
                      color: usernameCheck === 'available' ? '#22c55e' : '#ef4444',
                    }}>{usernameCheckMsg}</div>
                  )}
                </div>
                <div>
                  <input value={regPw} onChange={e => setRegPw(e.target.value)}
                    type="password" placeholder={tl('reg_password_ph')} style={inputStyle(t)} />
                  {regPw.length > 0 && (() => {
                    const missing = pwStrength(regPw)
                    if (missing.length === 0) return <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>{tl('password_valid')}</div>
                    return <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>{tl('password_needs')(missing)}</div>
                  })()}
                </div>
                <div>
                  <input value={regPwConfirm} onChange={e => setRegPwConfirm(e.target.value)}
                    type="password" placeholder={tl('reg_confirm_ph')} style={inputStyle(t)} />
                  {regPwConfirm.length > 0 && (
                    <div style={{ fontSize: 11, marginTop: 4, color: regPw === regPwConfirm ? '#22c55e' : '#ef4444' }}>
                      {regPw === regPwConfirm ? tl('pw_match') : tl('pw_no_match')}
                    </div>
                  )}
                </div>
                <input value={regEmail} onChange={e => setRegEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRegister()}
                  type="email" placeholder={tl('email_ph')} style={inputStyle(t)} />

                {/* 약관 동의 체크박스 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={agreePrivacy}
                      onChange={e => setAgreePrivacy(e.target.checked)}
                      style={{ accentColor: t.accent, width: 15, height: 15, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: t.subtext, lineHeight: 1.4 }}>
                      {lang === 'en' && <>{tl('privacy_agree')}{' '}</>}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer"
                        style={{ color: t.accent, textDecoration: 'none' }}
                        onClick={e => e.stopPropagation()}>
                        {tl('privacy_link')}
                      </a>
                      {lang === 'ko' && '에 동의합니다'}{' '}
                      <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={e => setAgreeTerms(e.target.checked)}
                      style={{ accentColor: t.accent, width: 15, height: 15, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: t.subtext, lineHeight: 1.4 }}>
                      {lang === 'en' && <>{tl('privacy_agree')}{' '}</>}
                      <a href="/terms" target="_blank" rel="noopener noreferrer"
                        style={{ color: t.accent, textDecoration: 'none' }}
                        onClick={e => e.stopPropagation()}>
                        {tl('terms_link')}
                      </a>
                      {lang === 'ko' && '에 동의합니다'}{' '}
                      <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                  </label>
                </div>

                {regError && <div style={{ color: '#ef4444', fontSize: 12 }}>{regError}</div>}
                {(() => {
                  const disabled = regLoading || !agreePrivacy || !agreeTerms || usernameCheck !== 'available'
                  return (
                    <button onClick={handleRegister} disabled={disabled} style={{
                      background: t.accentSoft, border: `1px solid ${t.accent}`,
                      color: t.accent, padding: '10px 0', fontFamily: t.titleFont, fontSize: 12,
                      letterSpacing: 4, marginTop: 8, cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 8,
                      opacity: disabled ? 0.4 : 1,
                    }}>{regLoading ? '...' : 'SIGN UP'}</button>
                  )
                })()}
              </>
            ) : (
              <>
                {regSuccess && <div style={{ color: t.accent, fontSize: 12 }}>{regSuccess}</div>}
                <div style={{ color: t.subtext, fontSize: 12 }}>{tl('enter_verify_code')(regEmail)}</div>
                <input value={regCode} onChange={e => setRegCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleVerify()}
                  placeholder={tl('verify_code_ph')} autoFocus
                  maxLength={6}
                  style={{ ...inputStyle(t), letterSpacing: 8, textAlign: 'center', fontSize: 18 }} />
                {regError && <div style={{ color: '#ef4444', fontSize: 12 }}>{regError}</div>}
                <button onClick={handleVerify} disabled={regLoading} style={{
                  background: t.accentSoft, border: `1px solid ${t.accent}`,
                  color: t.accent, padding: '10px 0', fontFamily: t.titleFont, fontSize: 12,
                  letterSpacing: 4, marginTop: 8, cursor: 'pointer', borderRadius: 8,
                  opacity: regLoading ? 0.6 : 1,
                }}>{regLoading ? '...' : 'VERIFY'}</button>
                <button onClick={() => { setRegStep('form'); setRegError(''); setRegSuccess('') }}
                  style={{
                    background: 'transparent', border: 'none',
                    color: t.subtext, fontSize: 12, cursor: 'pointer', fontFamily: t.bodyFont,
                  }}>{tl('back_re_enter')}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
