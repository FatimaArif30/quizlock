import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useRecorder — captures the student's camera+mic and (best effort) their
 * screen, then uploads both to Supabase Storage.
 *
 * Hardened for 40+ concurrent students / 1-hour exams:
 *   - Explicit bitrate caps (camera ~300 kbps, screen ~900 kbps) plus a screen
 *     resolution cap (<=1280x720 @ ~8fps) keep each recording small and uploads
 *     reliable.
 *   - Each recording session writes to its OWN local chunk array (never a shared
 *     ref), and start() stops any lingering recorder first. This prevents a
 *     stray fragment from a previous recorder being prepended to the blob — the
 *     bug that produced unplayable files (media bytes before the WebM header).
 *   - Before upload we verify the blob begins at the WebM/EBML header and trim
 *     any stray leading bytes, so the file ALWAYS plays even if something slips.
 *   - uploadAll() retries with backoff (fresh path each attempt) and reports
 *     per-stream success instead of silently returning null.
 */

const CAMERA_BITS = 300_000 // ~300 kbps webcam video
const SCREEN_BITS = 900_000 // ~900 kbps screen video (low fps compresses well)
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

// Locate the WebM/EBML header (1A 45 DF A3) within the first bytes of a blob.
// Returns its offset (0 if already at the start or not found in the window).
async function ebmlOffset(blob) {
  const head = new Uint8Array(await blob.slice(0, 2_000_000).arrayBuffer())
  for (let i = 0; i + 3 < head.length; i++) {
    if (head[i] === 0x1a && head[i + 1] === 0x45 && head[i + 2] === 0xdf && head[i + 3] === 0xa3) return i
  }
  return 0
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
  const recording = useRef(false)
  const mime = useRef(pickMime())

  // Ask for camera+mic (mandatory) and screen (best effort).
  const requestMedia = useCallback(async () => {
    setError(null)
    const cam = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
      audio: true,
    })
    camStreamRef.current = cam
    setCameraStream(cam)

    try {
      const scr = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 8, max: 10 }, width: { max: 1280 }, height: { max: 720 } },
        audio: true,
      })
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
    // Never let a previous recorder keep running and contaminate this session.
    ;[camRecRef.current, scrRecRef.current].forEach((r) => {
      try { if (r && r.state !== 'inactive') r.stop() } catch (_) { /* ignore */ }
    })
    if (recording.current) return
    recording.current = true

    // Each session gets its OWN arrays; the recorder closures capture THESE,
    // so a stray callback from an old recorder can never write into them.
    const camArr = []
    const scrArr = []
    camChunks.current = camArr
    scrChunks.current = scrArr

    if (camStreamRef.current) {
      const r = new MediaRecorder(camStreamRef.current, {
        mimeType: mime.current, videoBitsPerSecond: CAMERA_BITS, audioBitsPerSecond: AUDIO_BITS,
      })
      r.ondataavailable = (e) => { if (e.data && e.data.size) camArr.push(e.data) }
      r.start(4000)
      camRecRef.current = r
    }
    if (scrStreamRef.current) {
      const r = new MediaRecorder(scrStreamRef.current, {
        mimeType: mime.current, videoBitsPerSecond: SCREEN_BITS, audioBitsPerSecond: AUDIO_BITS,
      })
      r.ondataavailable = (e) => { if (e.data && e.data.size) scrArr.push(e.data) }
      r.start(4000)
      scrRecRef.current = r
    }
  }, [])

  const stop = useCallback(async () => {
    recording.current = false
    const stopOne = (rec) =>
      new Promise((resolve) => {
        if (!rec || rec.state === 'inactive') return resolve()
        rec.onstop = () => resolve()
        rec.stop()
      })
    await Promise.all([stopOne(camRecRef.current), stopOne(scrRecRef.current)])
    ;[camStreamRef.current, scrStreamRef.current].forEach((s) =>
      s && s.getTracks().forEach((t) => t.stop())
    )
  }, [])

  // Upload one blob with retries + backoff. Trims any stray bytes before the
  // WebM header first, and uses a fresh path per attempt so a failed partial
  // upload can never mix with a retry. Returns the storage path, or null.
  const uploadWithRetry = useCallback(async (chunks, studentId, label) => {
    if (!chunks.length) return null
    let blob = new Blob(chunks, { type: mime.current })
    try {
      const off = await ebmlOffset(blob)
      if (off > 0) {
        console.warn(`Trimmed ${off} stray bytes before the WebM header (${label})`)
        blob = blob.slice(off, blob.size, mime.current)
      }
    } catch (_) { /* if the check fails, upload as-is */ }

    const attempts = 4
    for (let i = 0; i < attempts; i++) {
      const path = `${studentId}/${label}-${Date.now()}-${i}.webm`
      const { error: upErr } = await supabase.storage
        .from('recordings')
        .upload(path, blob, { contentType: mime.current, upsert: true })
      if (!upErr) return path
      console.error(`Upload ${label} attempt ${i + 1}/${attempts} failed`, upErr)
      if (i < attempts - 1) await sleep(1500 * Math.pow(2, i))
    }
    return null
  }, [])

  const uploadAll = useCallback(async (studentId) => {
    const cameraUrl = await uploadWithRetry(camChunks.current, studentId, 'camera')
    const screenUrl = await uploadWithRetry(scrChunks.current, studentId, 'screen')
    const cameraExpected = camChunks.current.length > 0
    const screenExpected = scrChunks.current.length > 0
    const cameraOk = !cameraExpected || cameraUrl != null
    const screenOk = !screenExpected || screenUrl != null
    return { cameraUrl, screenUrl, cameraOk, screenOk, ok: cameraOk && screenOk }
  }, [uploadWithRetry])

  return { cameraStream, hasScreen, error, requestMedia, start, stop, uploadAll }
}
