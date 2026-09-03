import { useEffect, useState } from 'react'

// Counts down from `startedAt + durationMinutes`. Keeps running even if the
// student leaves (time is anchored to the real start time). Calls onExpire once.
export default function Timer({ startedAt, durationMinutes, onExpire }) {
  const endMs = new Date(startedAt).getTime() + durationMinutes * 60 * 1000
  const [left, setLeft] = useState(Math.max(0, endMs - Date.now()))

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, endMs - Date.now())
      setLeft(remaining)
      if (remaining <= 0) {
        clearInterval(id)
        onExpire && onExpire()
      }
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endMs])

  const totalSec = Math.floor(left / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  const low = totalSec <= 60

  return (
    <div
      className="font-mono font-bold text-xl px-3 py-1.5"
      style={{ background: low ? '#e5322d' : '#131311', color: '#f2f1ec' }}
    >
      {mm}:{ss}
    </div>
  )
}
