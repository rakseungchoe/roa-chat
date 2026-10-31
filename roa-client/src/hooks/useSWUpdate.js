import { useState, useEffect, useRef } from 'react'

export function useSWUpdate() {
  const [showUpdate, setShowUpdate] = useState(false)
  const waitingWorkerRef = useRef(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 이미 대기 중인 SW가 있는 경우 (탭을 오래 열어뒀을 때)
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorkerRef.current = reg.waiting
        setShowUpdate(true)
      }

      // 새 SW가 설치되기 시작할 때
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return

        newWorker.addEventListener('statechange', () => {
          // installed = 설치 완료, 활성화 대기 중
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorkerRef.current = newWorker
            setShowUpdate(true)
          }
        })
      })
    })

    // SW가 교체되면 페이지 새로고침
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    })
  }, [])

  const applyUpdate = () => {
    setShowUpdate(false)
    if (waitingWorkerRef.current) {
      waitingWorkerRef.current.postMessage({ type: 'SKIP_WAITING' })
    }
  }

  const dismissUpdate = () => setShowUpdate(false)

  return { showUpdate, applyUpdate, dismissUpdate }
}
