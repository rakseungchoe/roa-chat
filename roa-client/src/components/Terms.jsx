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

const handleBack = () => {
  window.location.href = '/'
}

export default function Terms() {
  return (
    <div className="terms-scroll" style={{
      height: '100dvh',
      overflowY: 'auto',
      background: BG,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '48px 16px 80px',
    }}>
      <style>{`
        .terms-scroll::-webkit-scrollbar { width: 8px; }
        .terms-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.04); }
        .terms-scroll::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.35); border-radius: 4px; }
        .terms-scroll::-webkit-scrollbar-thumb:hover { background: rgba(59,130,246,0.6); }
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
        }}>이용약관</h1>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 12,
          letterSpacing: 2,
          color: SUBTEXT,
          textAlign: 'center',
          marginBottom: 32,
        }}>Terms of Service · Roa AI</div>

        <p style={para}>
          본 약관은 로아(이하 "회사")가 운영하는 Roa AI 서비스(이하 "서비스")의 이용 조건 및 절차,
          회사와 이용자의 권리·의무 및 책임 사항을 규정합니다.
          이용자는 서비스를 이용함으로써 본 약관에 동의한 것으로 간주됩니다.
        </p>
        <p style={{ ...para, color: SUBTEXT, fontSize: 13 }}>
          시행일: 2026년 4월 24일
        </p>

        {/* 1 */}
        <div style={sectionTitle}>제1조 (목적 및 서비스 개요)</div>
        <p style={para}>
          Roa AI는 Claude(Anthropic), GPT(OpenAI), Gemini(Google) 등의 AI 모델을 활용한
          인공지능 기반 개인 어시스턴트 서비스입니다.
          서비스는 <strong style={{ color: ACCENT }}>app.roa-ai.com</strong>을 통해 제공됩니다.
        </p>

        {/* 2 */}
        <div style={sectionTitle}>제2조 (이용 자격)</div>
        <p style={para}>
          만 14세 이상이며 본 약관에 동의한 자는 서비스를 이용할 수 있습니다.
          회원가입 시 정확한 정보를 제공해야 하며, 타인의 정보를 도용하거나 허위 정보를 입력한 경우
          서비스 이용이 제한될 수 있습니다.
        </p>

        {/* 3 */}
        <div style={sectionTitle}>제3조 (계정 관리)</div>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>이용자는 자신의 계정(아이디·비밀번호)을 안전하게 관리할 책임이 있습니다.</li>
          <li>타인에게 계정을 양도하거나 공유할 수 없습니다.</li>
          <li>계정 도용이 의심될 경우 즉시 회사에 알려야 하며, 지체로 인한 피해는 이용자 본인의 책임입니다.</li>
        </ul>

        {/* 4 */}
        <div style={sectionTitle}>제4조 (이용자 의무)</div>
        <p style={para}>이용자는 다음 행위를 해서는 안 됩니다.</p>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>법령 또는 공서양속에 위반되는 내용의 입력·생성·유포</li>
          <li>타인의 개인정보 수집·도용·유포</li>
          <li>서비스의 정상적인 운영을 방해하는 행위</li>
          <li>자동화 도구(봇 등)를 이용한 과도한 요청</li>
          <li>악성코드 배포, 해킹 시도 등 보안 위협 행위</li>
          <li>회사를 사칭하거나 서비스를 무단으로 상업적으로 이용하는 행위</li>
        </ul>

        {/* 5 */}
        <div style={sectionTitle}>제5조 (서비스 제공 및 변경)</div>
        <p style={para}>
          회사는 연중무휴 24시간 서비스 제공을 원칙으로 하나,
          시스템 점검·장애·외부 API 중단 등 불가피한 사유로 일시 중단될 수 있습니다.
          서비스 내용은 사전 공지를 통해 변경될 수 있으며,
          긴급한 사유가 있는 경우 사후 공지할 수 있습니다.
        </p>

        {/* 6 */}
        <div style={sectionTitle}>제6조 (서비스 플랜)</div>
        <p style={para}>
          서비스는 무료 이용을 제공합니다. 운영자가 별도로 Pro 이용 권한을 부여한 경우 해당 권한은
          안내된 기간 동안 제공되며, 만료 후에는 무료 플랜으로 전환됩니다.
          현재 서비스에서는 유료 플랜 구매, 카드 등록 및 자동 결제를 제공하지 않습니다.
          향후 유료 기능을 도입하는 경우 사전에 공지하고 관련 약관을 갱신합니다.
        </p>

        {/* 7 */}
        <div style={sectionTitle}>제7조 (이용 중단 및 과거 거래)</div>
        <p style={para}>
          이용자는 회원 탈퇴를 통해 서비스 이용을 중단할 수 있습니다.
          과거 거래와 관련하여 법령상 보관이 필요한 기록은 정해진 기간 동안 보관되며,
          문의는 서비스 내 문의 기능을 통해 접수할 수 있습니다.
        </p>

        {/* 8 */}
        <div style={sectionTitle}>제8조 (회원 탈퇴)</div>
        <p style={para}>
          이용자는 설정 메뉴의 "회원 탈퇴" 기능을 통해 언제든지 탈퇴할 수 있습니다.
          탈퇴 요청 시 회사는 <strong style={{ color: ACCENT }}>즉시 이용자의 계정·대화 내역·AI 장기기억 등
          서비스 내 데이터를 삭제</strong>합니다.
        </p>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>과거 거래와 관련하여 법령상 보관이 필요한 기록은 정해진 기간 동안 보관된 후 파기됩니다.</li>
        </ul>

        {/* 9 */}
        <div style={sectionTitle}>제9조 (AI 생성물 면책)</div>
        <p style={para}>
          서비스가 제공하는 AI 응답·이미지·음성 등 일체의 생성물은
          외부 AI 모델의 확률적 산출 결과로서 <strong>오류·편향·부정확한 정보</strong>를 포함할 수 있습니다.
          생성물은 참고 용도로만 활용하시기 바랍니다.
        </p>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>의료·법률·금융·세무 등 전문 분야의 결정은 반드시 해당 분야 전문가의 조언을 구하시기 바랍니다.</li>
          <li>회사는 AI 생성물의 정확성·완전성·최신성·적법성·특정 목적 적합성을 보증하지 않습니다.</li>
          <li>이용자가 AI 생성물을 근거로 한 판단·행위로 발생한 손해에 대해 회사는 책임을 지지 않습니다.</li>
          <li>AI 생성물의 저작권 및 제3자 권리 침해 여부는 이용자가 자체 검토할 책임이 있으며,
              이로 인한 분쟁 발생 시 이용자가 해결 책임을 부담합니다.</li>
        </ul>

        {/* 10 */}
        <div style={sectionTitle}>제10조 (면책 조항)</div>
        <p style={para}>회사는 다음의 경우에 대해 책임을 지지 않습니다.</p>
        <ul style={{ ...para, paddingLeft: 20 }}>
          <li>천재지변, 서버 장애 등 불가항력으로 인한 서비스 중단</li>
          <li>이용자 귀책 사유로 발생한 서비스 이용 장애</li>
          <li>외부 AI 서비스(Anthropic, OpenAI, Google) 장애로 인한 오류</li>
          <li>이용자가 서비스를 이용하여 얻은 정보를 근거로 발생한 손해</li>
          <li>이용자 간 또는 이용자와 제3자 간의 분쟁</li>
        </ul>

        {/* 11 */}
        <div style={sectionTitle}>제11조 (지식재산권)</div>
        <p style={para}>
          서비스의 UI/UX, 로고, 소프트웨어 등의 지식재산권은 회사에 귀속됩니다.
          이용자가 서비스에 입력한 텍스트·파일 등의 권리는 이용자 본인에게 있으며,
          회사는 서비스 제공 목적 외에는 이를 이용하지 않습니다.
        </p>

        {/* 12 */}
        <div style={sectionTitle}>제12조 (약관 변경)</div>
        <p style={para}>
          본 약관은 관련 법령의 변경 또는 서비스 정책에 따라 변경될 수 있으며,
          변경 시 적용일 최소 7일 전(이용자에게 불리한 변경의 경우 30일 전)까지 서비스 내 공지를 통해 안내합니다.
          공지 이후 이용자가 서비스를 계속 이용하면 변경된 약관에 동의한 것으로 간주합니다.
        </p>

        {/* 13 */}
        <div style={sectionTitle}>제13조 (분쟁 해결 및 관할 법원)</div>
        <p style={para}>
          서비스 이용과 관련하여 분쟁이 발생한 경우 회사와 이용자는 우선 상호 협의하여 해결합니다.
          협의가 되지 않는 경우 「민사소송법」에 따른 관할 법원에 소를 제기할 수 있습니다.
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
