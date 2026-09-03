import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useProctoring — best-effort browser lockdown for the quiz screen.
 *
 * What it does (works on laptops/desktops):
 *   - forces fullscreen (must be started from a click)
 *   - flags a "violation" when the student switches tab, minimises,
 *     leaves fullscreen, or switches to another app
 *   - blocks right-click, copy, cut, paste and common shortcut keys
 *
 * What it CANNOT do: truly block the whole operating system. That is a
 * browser limitation — the recording is the real proof of what happened.
 *
 * @param {boolean} active   turn monitoring on/off
 * @param {function} onViolation  called once per violation (debounced)
 */
export function useProctoring(active, onViolation) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const lastViolation = useRef(0)
  const cb = useRef(onViolation)
  cb.current = onViolation

  const fire = useCallback((why) => {
    const now = Date.now()
    if (now - lastViolation.current < 1200) return // debounce paired events
    lastViolation.current = now
    if (cb.current) cb.current(why)
  }, [])

  const enterFullscreen = useCallback(async () => {
    try {
      const el = document.documentElement
      if (el.requestFullscreen) await el.requestFullscreen()
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
    } catch (e) {
      // Some browsers reject; the quiz still runs, just not fullscreen.
      console.warn('Fullscreen request failed:', e)
    }
  }, [])

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen()
      }
    } catch (e) { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!active) return

    const onVisibility = () => { if (document.hidden) fire('tab-hidden') }
    const onBlur = () => fire('window-blur')
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement)
      setIsFullscreen(fs)
      if (!fs) fire('left-fullscreen')
    }
    const block = (e) => { e.preventDefault(); return false }
    const onKeyDown = (e) => {
      const k = e.key
      const ctrl = e.ctrlKey || e.metaKey
      // block dev tools, view-source, print, save, copy/paste, new tab
      if (
        k === 'F12' ||
        (ctrl && e.shiftKey && ['I', 'J', 'C'].includes(k.toUpperCase())) ||
        (ctrl && ['u', 'p', 's', 'c', 'x', 'v', 't', 'w'].includes(k.toLowerCase()))
      ) {
        e.preventDefault()
        return false
      }
    }
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('contextmenu', block)
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    document.addEventListener('paste', block)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
      document.removeEventListener('paste', block)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [active, fire])

  return { enterFullscreen, exitFullscreen, isFullscreen }
}
