export default function RoaLogo({ size = 80 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="egg-shadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="5" dy="7" stdDeviation="13" floodColor="#0e6ea3" floodOpacity="0.26" />
        </filter>
      </defs>

      {/* 하늘색 라운드 배경 */}
      <rect width="512" height="512" rx="102" ry="102" fill="#29b6f6" />

      {/* 흰 달걀 — e=0.22 자연스러운 달걀 곡선 */}
      <path
        d="M 256,97
           C 321,97  394,197  394,297
           C 394,385  336,425  256,425
           C 176,425  118,385  118,297
           C 118,197  191,97  256,97 Z"
        fill="#FBFCFF"
        filter="url(#egg-shadow)"
      />

      {/* 왼쪽 위 하이라이트 — 입체감 */}
      <ellipse
        cx="210" cy="143"
        rx="44" ry="29"
        fill="rgba(255,255,255,0.40)"
        transform="rotate(-22, 210, 143)"
      />
    </svg>
  )
}
