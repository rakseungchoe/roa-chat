const CACHE_NAME = 'roa-v4'

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-egg-v2-192.png',
  '/icon-egg-v2-512.png',
]

// 설치: 정적 에셋 캐시 + 즉시 활성화 (자동 업데이트)
self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
})

// 활성화: 구버전 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// 앱에서 SKIP_WAITING 메시지를 보내면 즉시 활성화
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// 패치 전략
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 외부 요청(폰트 등) 무시
  if (url.origin !== self.location.origin) return

  // API 요청: Network-First (오프라인 시 503)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ success: false, error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
    return
  }

  // 정적 에셋: Network-First, 실패 시 캐시 폴백
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request))
  )
})
