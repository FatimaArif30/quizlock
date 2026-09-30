import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useRecorder — captures the student's camera+mic and (best effort) their
 * screen, then uploads both to Supabase Storage.
 *
 * Hardened for 40+ concurrent students / 1-hour exams:
 *   - Explicit bitrate caps (camera ~300 kbps, screen ~900 kbps) plus a screen
 *     resolution cap (<=1280x720 @ ~8fps) keep each recording small
 *     (~roughly 400-500 MB/hr instead of 1 GB+). That cuts storage cost and
 *     makes the end-of-exam upload far more likely to succeed.
 *   - uploadAll() retries with backoff and reports per-stream success, so a
 *     failed upload is no longer silently lost — the caller can warn the
 *     student instead of pretending everything is fine.
 *
 * Flow used by the quiz page:
 *   1. requestMedia()  -> asks for camera+mic (required) and screen (asked)
 *   2. start()         -> begins recording both
 *   3. stop()          -> stops and keeps the video blobs
 *   4. uploadAll(id)   -> uploads; returns { cameraUrl, screenUrl, cameraOk, screenOk, ok }
 */

// Proctoring footage doesn't need high resolution or frame rate. These caps
// keep files small and uploads reliable.
const CAMERA_BITS = 300_000 // ~300 kbps video for the webcam
const SCREEN_BITS = 900_000 // ~900 kbps video for the screen (low fps compresses well)
const AUDIO_BITS = 64_000   // ~64 kbps audio

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pickMime() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const t of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t
  }
  return 'video/webm'
}

export function useRecorder() {
  const [cameraStream, setCameraStream] = useState(null)
  const [hasScreen, setHasScreen] = useState(false)
  const [error, setError] = useState(null)

  const camStreamRef = useRef(null)
  const scrStreamRef = useRef(null)
  const camRecRef = useRef(null)
  const scrRecRef = useRef(null)
  const camChunks = useRef([])
  const scrChunks = useRef([])
  const mime = useRef(pickMime())

  // Ask for camera+mic (mandatory) and screen (best effort).
  const requestMedia = useCallback(async () => {
    setError(null)
    // Camera + mic — REQUIRED. If this throws, the caller blocks the student.
    const cam = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
      audio: true,
    })
    camStreamRef.current = cam
    setCameraStream(cam)

    // Screen — asked for, but we don't hard-block if the browser cancels it.
    try {
      const scr = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 8, max: 10 }, width: { max: 1280 }, height: { max: 720 } },
        audio: true,
      })
      // Best-effort downscale: some browsers ignore the size hints above on
      // display capture, so re-apply them as a constraint on the track.
      try {
        const vt = scr.getVideoTracks()[0]
        if (vt && vt.applyConstraints) {
          await vt.applyConstraints({ width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 10 } })
        }
      } catch (_) { /* non-fatal */ }
      scrStreamRef.current = scr
      setHasScreen(true)
    } catch (e) {
      console.warn('Screen share not granted — continuing with camera only.', e)
      setHasScreen(false)
    }
    return { camera: true, screen: Boolean(scrStreamRef.current) }
  }, [])

  const start = useCallback(() => {
    camChunks.current = []
    scrChunks.current = []
    if (camStreamRef.current) {
      const r = new MediaRecorder(camStreamRef.current, {
        mimeType: mime.current,
        videoBitsPerSecond: CAMERA_BITS,
        audioBitsPerSecond: AUDIO_BITS,
      })
      r.ondataavailable = (e) => { if (e.data.size) camChunks.current.push(e.data) }
      r.start(4000) // flush every 4s so long recordings survive
      camRecRef.current = r
    }
    if (scrStreamRef.current) {
      const r = new MediaRecorder(scrStreamRef.current, {
        mimeType: mime.current,
        videoBitsPerSecond: SCREEN_BITS,
        audioBitsPerSecond: AUDIO_BITS,
      })
      r.ondataavailable = (e) => { if (e.data.size) scrChunks.current.push(e.data) }
      r.start(4000)
      scrRecRef.current = r
    }
  }, [])

  const stop = useCallback(async () => {
    const stopOne = (rec) =>
      new Promise((resolve) => {
        if (!rec || rec.state === 'inactive') return resolve()
        rec.onstop = () => resolve()
        rec.stop()
      })
    await Promise.all([stopOne(camRecRef.current), stopOne(scrRecRef.current)])
    // release camera / screen so the light turns off
    ;[camStreamRef.current, scrStreamRef.current].forEach((s) =>
      s && s.getTracks().forEach((t) => t.stop())
    )
  }, [])

  // Upload one blob with a few retries + backoff. Returns the storage path on
  // success, or null on failure (after all retries).
  const uploadWithRetry = useCallback(async (chunks, studentId, label) => {
    if (!chunks.length) return null
    const blob = new Blob(chunks, { type: mime.current })
    const path = `${studentId}/${label}-${Date.now()}.webm`
    const attempts = 4
    for (let i = 0; i < attempts; i++) {
      const { error: upErr } = await supabase.storage
        .from('recordings')
        .upload(path, blob, { contentType: mime.current, upsert: true })
      if (!upErr) return path
      console.error(`Upload ${label} attempt ${i + 1}/${attempts} failed`, upErr)
      if (i < attempts - 1) await sleep(1500 * Math.pow(2, i)) // 1.5s, 3s, 6s
    }
    return null
  }, [])

  const uploadAll = useCallback(async (studentId) => {
    // Returns storage PATHS (not public URLs). The bucket is private — the
    // teacher dashboard and the email function create signed links.
    const cameraUrl = await uploadWithRetry(camChunks.current, studentId, 'camera')
    const screenUrl = await uploadWithRetry(scrChunks.current, studentId, 'screen')
    // "expected" = we actually recorded something for that stream.
    const cameraExpected = camChunks.current.length > 0
    const screenExpected = scrChunks.current.length > 0
    const cameraOk = !cameraExpected || cameraUrl != null
    const screenOk = !screenExpected || screenUrl != null
    return { cameraUrl, screenUrl, cameraOk, screenOk, ok: cameraOk && screenOk }
  }, [uploadWithRetry])

  return { cameraStream, hasScreen, error, requestMedia, start, stop, uploadAll }
}
