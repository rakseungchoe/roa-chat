import { useState, useEffect } from 'react'

const EXT_MAP = {
  python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts',
  html:'html', css:'css', json:'json', bash:'sh', sh:'sh', sql:'sql',
  java:'java', cpp:'cpp', c:'c', go:'go', rust:'rs', yaml:'yaml', md:'md',
}

// 간단한 syntax highlight (Python/JS/HTML 기본 색상)
function SyntaxCode({ lang, code }) {
  const l = lang?.toLowerCase() || ''
  const colors = {
    keyword: '#7c3aed',
    string:  '#059669',
    comment: '#94a3b8',
    number:  '#d97706',
    builtin: '#0284c7',
    tag:     '#dc2626',
    attr:    '#d97706',
  }

  // 먼저 escape 처리
  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  if (l === 'html') {
    const highlighted = escaped
      .replace(/(&lt;\/?)([\w-]+)/g, `$1<span style="color:${colors.tag}">$2</span>`)
      .replace(/\b([\w-]+)=/g, `<span style="color:${colors.attr}">$1</span>=`)
      .replace(/(["'])(.*?)\1/g, `<span style="color:${colors.string}">$1$2$1</span>`)
    return <code dangerouslySetInnerHTML={{ __html: highlighted }} />
  }

  // 주석 먼저 (다른 패턴과 충돌 방지) → placeholder로 교체 후 마지막에 복원
  const comments = []
  escaped = escaped.replace(/(#[^\n]*)|(\/\/[^\n]*)/g, (m) => {
    comments.push(m)
    return `\x00COMMENT${comments.length - 1}\x00`
  })

  // 문자열
  const strings = []
  escaped = escaped.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, (m) => {
    strings.push(m)
    return `\x00STRING${strings.length - 1}\x00`
  })

  // 키워드
  const pyKeywords = /\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|True|False|None|try|except|with|as|pass|break|continue|lambda|yield|async|await|const|let|var|function|export|default|new|this|typeof|instanceof|switch|case|throw|catch|finally)\b/g
  const builtins = /\b(print|len|range|type|str|int|float|list|dict|set|tuple|bool|open|map|filter|zip|enumerate|super|self|console|Math|JSON|Object|Array|Promise|require|module)\b/g

  escaped = escaped
    .replace(pyKeywords, `<span style="color:${colors.keyword}">$1</span>`)
    .replace(builtins, `<span style="color:${colors.builtin}">$1</span>`)
    .replace(/\b(\d+\.?\d*)\b/g, `<span style="color:${colors.number}">$1</span>`)

  // placeholder 복원 — 치환값을 함수로 넘긴다. 문자열로 넘기면 코드 안의
  // "$&", "$'" 같은 시퀀스를 replace가 특수 패턴으로 해석해 출력이 깨진다.
  strings.forEach((s, i) => {
    escaped = escaped.replace(`\x00STRING${i}\x00`, () => `<span style="color:${colors.string}">${s}</span>`)
  })
  comments.forEach((c, i) => {
    escaped = escaped.replace(`\x00COMMENT${i}\x00`, () => `<span style="color:${colors.comment}">${c}</span>`)
  })

  return <code dangerouslySetInnerHTML={{ __html: escaped }} />
}

// asOverlay: 모바일/태블릿 - isOpen/onClose로 제어
// !asOverlay: 데스크탑 - 자체 collapsed 토글
export default function RightPanel({ t, artifact, setArtifact, asOverlay = false, isOpen, onClose }) {
  const [collapsed, setCollapsed] = useState(true)
  const [copied, setCopied] = useState(false)
  // artifact 있으면 자동 열기, 없으면 자동 닫기
  useEffect(() => {
    if (artifact) setCollapsed(false)
    else setCollapsed(true)
  }, [artifact])

  const copy = () => {
    if (!artifact) return
    navigator.clipboard.writeText(artifact.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    if (!artifact) return
    const blob = new Blob([artifact.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = artifact.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const isLight = t.isLight !== false
  // 코드 패널은 항상 라이트 배경 (가독성)
  const codeBg = '#f8f9fc'
  const codeHeaderBg = '#eef0f8'
  const codeBorder = '#dde1f0'

  const card = {
    background: t.panel, border: `1px solid ${t.border}`,
    borderRadius: 10, padding: 16, marginBottom: 12,
    boxShadow: isLight ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
  }
  const titleStyle = {
    fontFamily: t.titleFont, fontSize: 10, color: t.accent,
    letterSpacing: 3, marginBottom: 12, fontWeight: 600,
  }

  const PanelContent = () => (
    <div style={{
      flex: 1, overflowY: 'auto',
      padding: asOverlay ? '0 14px 20px' : '52px 12px 16px',
      scrollbarWidth: 'thin',
      scrollbarColor: `${t.scrollbar} transparent`,
    }}>
      {artifact ? (
            <div style={{ marginBottom: 12 }}>
              {/* 헤더 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', background: codeHeaderBg,
                border: `1px solid ${codeBorder}`,
                borderBottom: 'none', borderRadius: '10px 10px 0 0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{artifact.filename}</div>
                    <div style={{ fontSize: 10, color: '#64748b', letterSpacing: 1 }}>{artifact.lang?.toUpperCase()}</div>
                  </div>
                </div>
                <button onClick={() => setArtifact(null)} style={{
                  background: 'transparent', border: 'none',
                  color: '#94a3b8', cursor: 'pointer', fontSize: 16, padding: '0 4px',
                }} title="닫기">✕</button>
              </div>

              {/* 버튼 바 */}
              <div style={{
                display: 'flex', gap: 6, padding: '8px 12px',
                background: codeHeaderBg,
                border: `1px solid ${codeBorder}`,
                borderBottom: 'none',
              }}>
                <button onClick={copy} style={{
                  flex: 1, padding: '6px 0', borderRadius: 6,
                  border: `1px solid ${copied ? '#6366f1' : '#c7d0e8'}`,
                  background: copied ? '#eef0fc' : 'white',
                  color: copied ? '#6366f1' : '#64748b',
                  fontSize: 12, cursor: 'pointer',
                  transition: 'all 0.2s',
                }}>
                  {copied ? '✓ 복사됨' : '복사'}
                </button>
                <button onClick={download} style={{
                  flex: 1, padding: '6px 0', borderRadius: 6,
                  border: '1px solid #c7d0e8',
                  background: 'white', color: '#64748b',
                  fontSize: 12, cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.borderColor = '#6366f1' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#c7d0e8' }}
                >⬇ 다운로드</button>
              </div>

              {/* 코드 - 라이트 배경 + 컬러 */}
              <pre style={{
                background: codeBg, margin: 0,
                padding: '18px 18px',
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                fontSize: 13, lineHeight: 1.75,
                color: '#1e293b',
                border: `1px solid ${codeBorder}`,
                borderRadius: '0 0 10px 10px',
                whiteSpace: 'pre',
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 220px)',
                scrollbarWidth: 'thin',
                scrollbarColor: '#c7d0e8 transparent',
              }}>
                <SyntaxCode lang={artifact.lang} code={artifact.content} />
              </pre>
            </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 10 }}>
          <div style={{ fontSize: 11, opacity: 0.25, letterSpacing: 2 }}>CODE</div>
          <div style={{ fontSize: 11, color: t.subtext, letterSpacing: 1, opacity: 0.5 }}>코드 결과물이 여기 표시됩니다</div>
        </div>
      )}
    </div>
  )

  // ── 오버레이 모드 (모바일/태블릿) ─────────────────────
  if (asOverlay) {
    return (
      <>
        {/* 딤 배경 */}
        {isOpen && (
          <div
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 60,
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          />
        )}

        {/* 패널 시트 */}
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(360px, 92vw)',
          zIndex: 61,
          background: t.sidebar,
          borderLeft: `1px solid ${t.border}`,
          display: 'flex', flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
          paddingTop: 'env(safe-area-inset-top)',
        }}>
          {/* 시트 헤더 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: `1px solid ${t.border}`,
            flexShrink: 0,
          }}>
            <span style={{
              fontFamily: t.titleFont, fontSize: 11,
              color: t.accent, letterSpacing: 2, fontWeight: 600,
            }}>
              {artifact ? '코드 뷰어' : '정보 패널'}
            </span>
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'transparent',
                border: `1px solid ${t.border}`,
                color: t.subtext, cursor: 'pointer', fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
              }}
            >✕</button>
          </div>

          <PanelContent />
        </div>
      </>
    )
  }

  // ── 데스크탑: 기존 컬럼 모드 ──────────────────────────
  return (
    <div style={{
      width: collapsed ? 40 : 440,
      minWidth: collapsed ? 40 : 440,
      transition: 'width 0.25s ease, min-width 0.25s ease',
      background: t.bg, borderLeft: `1px solid ${t.border}`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative', zIndex: 1,
    }}>
      <button onClick={() => setCollapsed(p => !p)} style={{
        position: 'absolute', top: 12,
        left: collapsed ? 6 : 12,
        width: 28, height: 28,
        background: artifact ? t.accentSoft : t.panel,
        border: `1px solid ${artifact ? t.accent : t.border}`,
        color: artifact ? t.accent : t.subtext,
        cursor: 'pointer', borderRadius: 6, fontSize: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2, transition: 'left 0.25s',
      }}>
        {collapsed ? '‹' : '›'}
      </button>

      {!collapsed && <PanelContent />}
    </div>
  )
}
