import RoaLogo from './RoaLogo'

const ACCENT = '#3b82f6'
const BG = '#f8fafc'
const TEXT = '#1e293b'
const SUBTEXT = '#64748b'
const BORDER = 'rgba(0,0,0,0.09)'
const PANEL = '#ffffff'

const sectionTitle = {
  fontFamily: "'Orbitron', monospace",
  fontSize: 13,
  letterSpacing: 3,
  color: ACCENT,
  marginBottom: 10,
  marginTop: 32,
  textTransform: 'uppercase',
}

const para = {
  fontFamily: "'Rajdhani', sans-serif",
  fontSize: 15,
  color: TEXT,
  lineHeight: 1.8,
  marginBottom: 8,
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: "'Rajdhani', sans-serif",
  fontSize: 14,
  color: TEXT,
  marginBottom: 12,
}

const thStyle = {
  borderBottom: `1px solid ${BORDER}`,
  padding: '8px 12px',
  textAlign: 'left',
  color: ACCENT,
  fontWeight: 600,
  letterSpacing: 1,
}

const tdStyle = {
  borderBottom: `1px solid rgba(0,0,0,0.05)`,
  padding: '8px 12px',
  verticalAlign: 'top',
}

const handleBack = () => {
  window.location.href = '/'
}

export default function Privacy() {
  return (
    <div className="privacy-scroll" style={{
      height: '100dvh',
      overflowY: 'auto',
      background: BG,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '48px 16px 80px',
    }}>
      <style>{`
        .privacy-scroll::-webkit-scrollbar { width: 8px; }
        .privacy-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.04); }
        .privacy-scroll::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.35); border-radius: 4px; }
        .privacy-scroll::-webkit-scrollbar-thumb:hover { background: rgba(59,130,246,0.6); }
      `}</style>
      <div style={{ marginBottom: 8, cursor: 'pointer' }} onClick={handleBack}>
        <RoaLogo size={72} />
      </div>
      <div style={{
        fontFamily: "'Rajdhani', sans-serif",
        fontSize: 11,
        letterSpacing: 4,
        color: SUBTEXT,
        marginBottom: 40,
        textTransform: 'uppercase',
      }}>Personal AI Assistant</div>

      <div style={{
        width: '100%',
        maxWidth: 720,
        background: PANEL,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: '40px 40px 48px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: '50%',
          transform: 'translateX(-50%)',
          width: '60%', height: 2,
          background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
          borderRadius: 2,
        }} />

        <h1 style={{
          fontFamily: "'Orbitron', monospace",
          fontSize: 20,
          letterSpacing: 4,
          color: ACCENT,
          marginBottom: 4,
          textAlign: 'center',
        }}>개인정보처리방침</h1>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 12,
          letterSpacing: 2,
          color: SUBTEXT,
          textAlign: 'center',
          marginBottom: 32,
        }}>Privacy Policy · Roa AI</div>

        <p style={para}>
          로아(이하 "회사")는 Roa AI 서비스(이하 "서비스") 이용자의 개인정보를 소중히 여기며,
          「개인정보 보호법」, 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」 등 관련 법령을 준수합니다.
          본 방침은 회사가 어떤 개인정보를 수집하고, 어떻게 이용·보관·파기하는지를 안내합니다.
        </p>
        <p style={{ ...para, color: SUBTEXT, fontSize: 13 }}>
          시행일: 2026년 4월 24일
        </p>

        {/* 1 */}
        <div style={sectionTitle}>1. 수집하는 개인정보 항목</div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>수집 항목</th>
              <th style={thStyle}>수집 목적</th>
              <th style={thStyle}>보유 기간</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle}>아이디 (ID)</td>
              <td style={tdStyle}>회원 식별 및 로그인</td>
              <td style={tdStyle}>회원 탈퇴 시 즉시 삭제</td>
            </tr>
            <tr>
              <td style={tdStyle}>비밀번호 (bcrypt 해시)</td>
              <td style={tdStyle}>본인 인증</td>
              <td style={tdStyle}>회원 탈퇴 시 즉시 삭제</td>
            </tr>
            <tr>
              <td style={tdStyle}>이메일 주소</td>
              <td style={tdStyle}>회원가입 인증 및 서비스 공지</td>
              <td style={tdStyle}>회원 탈퇴 시 즉시 삭제</td>
            </tr>
            <tr>
              <td style={tdStyle}>대화 내용 (AI 장기기억)</td>
              <td style={tdStyle}>개인화 AI 서비스 제공</td>
              <td style={tdStyle}>회원 탈퇴 또는 직접 삭제 시까지</td>
            </tr>
            <tr>
              <td style={tdStyle}>과거 유료 이용 기록 (마스킹된 카드 식별 정보, 빌링키, 결제 내역)</td>
              <td style={tdStyle}>과거 거래 기록 보관 및 법령상 의무 이행</td>
              <td style={tdStyle}>관계 법령에 따른 보관 기간 후 파기</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...para, fontSize: 13, color: SUBTEXT }}>
          ※ 비밀번호는 bcrypt 해시로 단방향 암호화되어 저장되며, 평문 비밀번호는 보관하지 않습니다.
        </p>
        <p style={{ ...para, fontSize: 13, color: SUBTEXT }}>
          ※ 현재 카드 등록 및 정기결제 기능은 제공하지 않습니다. 과거 결제 처리 과정에서
          카드 원문 정보는 결제대행사가 처리했으며, 회사에는 마스킹된 카드 식별 정보와
          법령상 보관이 필요한 거래 기록이 남아 있을 수 있습니다.
        </p>

        {/* 2 */}
        <div style={sectionTitle}>2. 개인정보 수집 방법</div>
        <p style={para}>
          회원가입·로그인·서비스 이용 과정에서 이용자가 직접 입력하거나 서비스 이용 중 생성됩니다.
        </p>

        {/* 3 */}
        <div style={sectionTitle}>3. 개인정보의 처리 및 이용 목적</div>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>회원가입 및 로그인 인증</li>
          <li>이메일 인증 코드 발송 및 서비스 공지</li>
          <li>개인화 AI 서비스 제공 (AI 장기기억 기반 맞춤형 응답)</li>
          <li>과거 거래 기록 보관 및 관련 법령 준수</li>
          <li>부정 이용 방지 및 서비스 품질 개선</li>
        </ul>

        {/* 4 */}
        <div style={sectionTitle}>4. 개인정보의 제3자 제공 및 처리 위탁</div>
        <p style={para}>
          회사는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다.
          다만, 아래와 같이 서비스 제공에 필요한 범위에서 외부 사업자에게 정보가 전송되거나 처리가 위탁될 수 있습니다.
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>수탁사</th>
              <th style={thStyle}>처리 목적</th>
              <th style={thStyle}>제공 항목</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle}>㈜토스페이먼츠 (과거 결제 처리)</td>
              <td style={tdStyle}>과거 카드 결제 및 거래 처리</td>
              <td style={tdStyle}>과거 처리 당시 제공된 고객 식별자, 결제 및 주문 정보</td>
            </tr>
            <tr>
              <td style={tdStyle}>Anthropic (미국)</td>
              <td style={tdStyle}>Claude AI 응답 생성</td>
              <td style={tdStyle}>대화 내용 (개인 식별정보 미포함)</td>
            </tr>
            <tr>
              <td style={tdStyle}>OpenAI (미국)</td>
              <td style={tdStyle}>GPT 응답 생성, TTS 음성 합성, Whisper 음성 인식</td>
              <td style={tdStyle}>대화 내용, 음성 파일 (개인 식별정보 미포함)</td>
            </tr>
            <tr>
              <td style={tdStyle}>Google (미국)</td>
              <td style={tdStyle}>Gemini 응답 생성</td>
              <td style={tdStyle}>대화 내용 (개인 식별정보 미포함)</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...para, fontSize: 13, color: SUBTEXT }}>
          ※ 토스페이먼츠와의 결제 연동은 종료되어 현재 결제 요청을 보내지 않습니다.
          과거 거래 기록은 관련 법령에 따른 보관 기간 동안 관리합니다.
        </p>
        <p style={{ ...para, fontSize: 13, color: SUBTEXT }}>
          ※ AI 수탁사의 개인정보 처리방침:
          anthropic.com/privacy · openai.com/privacy · policies.google.com/privacy
        </p>

        {/* 5 */}
        <div style={sectionTitle}>5. 개인정보의 국외 이전</div>
        <p style={para}>
          AI 응답 생성을 위해 대화 내용이 <strong style={{ color: ACCENT }}>미국 소재</strong> AI 사업자(Anthropic, OpenAI, Google)에게
          HTTPS 암호화 네트워크를 통해 전송됩니다. 각 사업자는 자사 개인정보보호정책에 따라 정보를 처리합니다.
          이에 동의하지 않으시면 AI 응답 기능을 이용할 수 없습니다.
        </p>

        {/* 6 */}
        <div style={sectionTitle}>6. 개인정보의 보유 및 파기</div>
        <p style={para}>
          개인정보는 수집 목적이 달성되거나 이용자가 회원 탈퇴를 요청한 경우 지체 없이 파기합니다.
          단, 관계 법령에 의해 보존이 필요한 경우 아래 기간 동안 보관 후 파기합니다.
        </p>
        <ul style={{ ...para, paddingLeft: 20, fontSize: 14 }}>
          <li>계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래법)</li>
          <li>대금결제 및 재화 공급에 관한 기록: 5년 (전자상거래법)</li>
          <li>소비자의 불만 또는 분쟁 처리에 관한 기록: 3년 (전자상거래법)</li>
        </ul>
        <p style={para}>
          AI 장기기억 데이터는 <strong style={{ color: ACCENT }}>설정 &gt; AI 기억 초기화</strong>에서
          이용자가 언제든지 직접 삭제할 수 있으며, 회원 탈퇴 시에도 즉시 삭제됩니다.
        </p>

        {/* 7 */}
        <div style={sectionTitle}>7. 이용자의 권리와 행사 방법</div>
        <p style={para}>이용자는 다음 권리를 행사할 수 있으며, 회사는 관련 법령에 따라 신속히 처리합니다.</p>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>개인정보 열람 요청</li>
          <li>개인정보 수정·삭제 요청</li>
          <li>개인정보 처리 정지 요청</li>
          <li>회원 탈퇴 (데이터 즉시 삭제)</li>
        </ul>
        <p style={{ ...para, color: SUBTEXT, fontSize: 13 }}>
          권리 행사는 서비스 내 설정 메뉴를 이용해 주시기 바랍니다.
        </p>

        {/* 8 */}
        <div style={sectionTitle}>8. 개인정보 안전성 확보 조치</div>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>비밀번호는 bcrypt 단방향 해시로 저장</li>
          <li>통신 구간 전체 HTTPS(TLS) 암호화</li>
          <li>과거 거래 처리 시 결제대행사가 카드 원본 정보를 처리했으며, 현재 회사는 카드 정보를 수집하지 않음</li>
          <li>관리자 접근 통제 및 접근 기록 관리</li>
        </ul>

        {/* 9 */}
        <div style={sectionTitle}>9. 쿠키 및 세션</div>
        <p style={para}>
          서비스는 로그인 유지를 위해 세션 쿠키를 사용합니다.
          브라우저 설정에서 쿠키를 비활성화할 수 있으나, 이 경우 로그인 기능이 정상 동작하지 않을 수 있습니다.
        </p>

        {/* 10 */}
        <div style={sectionTitle}>10. 개인정보 보호책임자</div>
        <p style={para}>
          개인정보 관련 불만, 피해 신고는 서비스 내 문의 기능으로 접수하시기 바랍니다.
        </p>
        <p style={{ ...para, fontSize: 13, color: SUBTEXT }}>
          그 밖의 개인정보 침해 신고 및 상담: 개인정보분쟁조정위원회(kopico.go.kr, 1833-6972),
          개인정보침해신고센터(privacy.kisa.or.kr, 118), 대검찰청 사이버수사과(spo.go.kr, 1301),
          경찰청 사이버수사국(ecrm.cyber.go.kr, 182).
        </p>

        {/* 11 */}
        <div style={sectionTitle}>11. 방침 변경 안내</div>
        <p style={para}>
          본 개인정보처리방침은 법령 또는 서비스 변경에 따라 수정될 수 있으며,
          변경 시 서비스 내 공지를 통해 안내합니다.
        </p>

        <div style={{
          marginTop: 40,
          paddingTop: 24,
          borderTop: `1px solid ${BORDER}`,
          textAlign: 'center',
        }}>
          <button
            onClick={handleBack}
            style={{
              background: 'transparent',
              border: `1px solid ${ACCENT}`,
              color: ACCENT,
              fontFamily: "'Orbitron', monospace",
              fontSize: 12,
              letterSpacing: 3,
              padding: '10px 32px',
              cursor: 'pointer',
              borderRadius: 8,
              transition: 'all 0.3s',
            }}
            onMouseEnter={e => {
              e.target.style.background = 'rgba(59,130,246,0.08)'
            }}
            onMouseLeave={e => {
              e.target.style.background = 'transparent'
            }}
          >
            ← BACK
          </button>
        </div>
      </div>
    </div>
  )
}
