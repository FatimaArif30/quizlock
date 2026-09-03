import { useEffect, useRef } from 'react'

// Small floating camera preview with a blinking REC badge.
export default function CameraPreview({ stream, screen }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream
  }, [stream])

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, width: 196, zIndex: 40 }}>
      <div style={{ background: '#131311', padding: 9 }}>
        <div style={{ position: 'relative', height: 112, overflow: 'hidden', background: '#000' }}>
          <video
            ref={ref}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
          />
          <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 5, background: '#e5322d', padding: '3px 8px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'blink 1.4s infinite' }} />
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, fontWeight: 700, color: '#fff' }}>REC</span>
          </div>
        </div>
        <span style={{ display: 'block', marginTop: 8, fontFamily: "'Space Mono',monospace", fontSize: 9.5, letterSpacing: '.5px', color: '#8a8578' }}>
          CAM / MIC{screen ? ' / SCREEN' : ''}
        </span>
      </div>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  )
}
