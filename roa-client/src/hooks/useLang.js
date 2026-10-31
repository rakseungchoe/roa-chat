import { useState, useCallback } from 'react'
import { createTFn } from '../i18n'

// 언어는 계정 설정이다(서버가 진실의 원천). localStorage는 첫 화면을 즉시
// 그리기 위한 캐시로만 쓴다 — 서버 응답을 기다리면 잘못된 언어가 한 번
// 깜빡이기 때문이다. /api/me 응답이 오면 applyLang으로 덮어쓴다.
export const LANG_CACHE_KEY = 'roa_lang'

function detectLang() {
  const cached = localStorage.getItem(LANG_CACHE_KEY)
  if (cached === 'ko' || cached === 'en') return cached
  return navigator.language?.startsWith('ko') ? 'ko' : 'en'
}

export function useLang() {
  const [lang, setLang] = useState(detectLang)

  // 서버에서 받은 값을 적용한다 (저장 요청은 보내지 않는다)
  const applyLang = useCallback((next) => {
    if (next !== 'ko' && next !== 'en') return
    localStorage.setItem(LANG_CACHE_KEY, next)
    setLang(next)
  }, [])

  // 사용자가 직접 바꾼 경우 — 캐시를 갱신하고 계정에도 저장한다
  const toggleLang = useCallback(() => {
    setLang(prev => {
      const next = prev === 'ko' ? 'en' : 'ko'
      localStorage.setItem(LANG_CACHE_KEY, next)
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ language: next }),
      }).catch(() => {})   // 저장 실패해도 화면은 이미 바뀌었다
      return next
    })
  }, [])

  const tl = createTFn(lang)

  return { lang, toggleLang, applyLang, tl }
}
