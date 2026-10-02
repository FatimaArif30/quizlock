import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useRecorder — captures the student's camera+mic and (best effort) their
 * screen and uploads them LIVE, in short self-contained segments, while the
 * exam is running.
 *
 * Why segments (and not one file at the end):
 *   The old design held the whole recording in memory and only uploaded it
 *   when the student pressed submit. If the browser crashed, the laptop slept,
 *   or the tab was force-closed mid-exam, the entire recording was lost — the
 *   one thing the whole product exists to produce.
 *
 *   Now each stream is recorded as a sequence of ~SEG_MS clips. Every time a
 *   clip finishes it is a COMPLETE, independently playable WebM file (its own
 *   header), and it is uploaded immediately. A crash therefore costs at most
 *   the final in-progress clip (<= SEG_MS). There is no wasted bandwidth: the
 *   total uploaded equals the real recording size.
 *
 * Storage layout (one folder per attempt, zero-padded so names sort in order):
 *   <studentId>/<attemptId>/camera/0000.webm, 0001.webm, ...
 *   <studentId>/<attemptId>/screen/0000.webm, 0001.webm, ...
 *
 * start(studentId) returns { cameraPrefix, screenPrefix } so the caller can
 * persist those prefixes to the student row AT ONCE — that way a crashed
 * attempt is still discoverable by the teacher (the already-uploaded clips
 * live under the saved prefix).
 */

const CAMERA_BITS = 300_000 // ~300 kbps webcam video
const SCREEN_BITS = 900_000 // ~900 kbps screen video (low fps compresses well)
const AUDIO_BITS = 64_000   // ~64 kbps audio
const SEG_MS = 45_000       // one clip every ~45s → max ~45s lost on a crash

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
  const camTimer = useRef(null)
  const scrTimer = useRef(null)
  const camIdx = useRef(0)
  const scrIdx = useRef(0)
  const camOk = useRef(0)
  const scrOk = useRef(0)
  const inflight = useRef([])         // in-progress segment uploads
  const prefixes = useRef({ cameraPrefix: null, screenPrefix: null })
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

  // Upload one finished clip with a few retries. The clip is already a valid
  // standalone WebM, so we never touch its bytes.
  const uploadSeg = useCallback(async (path, blob, okRef) => {
    for (let i = 0; i < 3; i++) {
      const { error: upErr } = await supabase.storage
        .from('recordings')
        .upload(path, blob, { contentType: mime.current, upsert: true })
      if (!upErr) { okRef.current += 1; return true }
      console.error(`Segment upload failed (${path}) attempt ${i + 1}/3`, upErr)
      if (i < 2) await sleep(1200 * Math.pow(2, i))
    }
    return false
  }, [])

  // Record ONE stream as an endless chain of clips. Each clip is its own
  // MediaRecorder run: start → (SEG_MS later) stop → on stop, upload the clip
  // and immediately begin the next one, until recording is turned off.
  const runStream = useCallback((streamRef, recRef, timerRef, idxRef, okRef, prefix, videoBits) => {
    const stream = streamRef.current
    if (!stream || !prefix) return

    const startSeg = () => {
      if (!recording.current) return
      let chunks = []
      let r
      try {
        r = new MediaRecorder(stream, {
          mimeType: mime.current, videoBitsPerSecond: videoBits, audioBitsPerSecond: AUDIO_BITS,
        })
      } catch (_) {
        try { r = new MediaRecorder(stream) } catch (__) { return }
      }
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
      r.onstop = () => {
        const idx = idxRef.current++
        const blob = chunks.length ? new Blob(chunks, { type: mime.current }) : null
        chunks = []
        if (blob && blob.size > 0) {
          const path = `${prefix}/${String(idx).padStart(4, '0')}.webm`
          const task = uploadSeg(path, blob, okRef)
          inflight.current.push(task)
          task.then(() => { inflight.current = inflight.current.filter((t) => t !== task) })
        }
        if (recording.current) startSeg() // chain the next clip
      }
      recRef.current = r
      try { r.start() } catch (_) { return }
      // close this clip after SEG_MS; onstop handles upload + the next clip
      timerRef.current = setTimeout(() => {
        try { if (r.state !== 'inactive') r.stop() } catch (_) { /* ignore */ }
      }, SEG_MS)
    }

    startSeg()
  }, [uploadSeg])

  // Begin recording. Returns the storage prefixes so the caller can save them
  // to the student row right away (crash-recoverable).
  const start = useCallback((studentId) => {
    // Never let a previous recorder keep running.
    ;[camRecRef.current, scrRecRef.current].forEach((r) => {
      try { if (r && r.state !== 'inactive') r.stop() } catch (_) { /* ignore */ }
    })
    clearTimeout(camTimer.current)
    clearTimeout(scrTimer.current)
    if (recording.current) return prefixes.current

    recording.current = true
    camIdx.current = 0; scrIdx.current = 0
    camOk.current = 0; scrOk.current = 0
    inflight.current = []

    const attempt = Date.now().toString(36)
    const base = `${studentId || 'unknown'}/${attempt}`
    const cameraPrefix = camStreamRef.current ? `${base}/camera` : null
    const screenPrefix = scrStreamRef.current ? `${base}/screen` : null
    prefixes.current = { cameraPrefix, screenPrefix }

    runStream(camStreamRef, camRecRef, camTimer, camIdx, camOk, cameraPrefix, CAMERA_BITS)
    runStream(scrStreamRef, scrRecRef, scrTimer, scrIdx, scrOk, screenPrefix, SCREEN_BITS)

    return prefixes.current
  }, [runStream])

  // Stop recording: flush the final clip of each stream (uploads while the
  // student is still 'in_progress'), wait for every upload to settle, then
  // release the camera/mic/screen. Returns which streams got at least one clip.
  const stop = useCallback(async () => {
    recording.current = false
    clearTimeout(camTimer.current)
    clearTimeout(scrTimer.current)

    const stopOne = (rec) =>
      new Promise((resolve) => {
        if (!rec || rec.state === 'inactive') return resolve()
        const prev = rec.onstop
        rec.onstop = (ev) => { try { prev && prev(ev) } finally { resolve() } }
        try { rec.stop() } catch (_) { resolve() }
      })

    await Promise.all([stopOne(camRecRef.current), stopOne(scrRecRef.current)])
    // the final clips' onstop handlers queued their uploads into inflight
    try { await Promise.all(inflight.current.slice()) } catch (_) { /* best effort */ }

    ;[camStreamRef.current, scrStreamRef.current].forEach((s) =>
      s && s.getTracks().forEach((t) => t.stop())
    )

    const hadCam = Boolean(prefixes.current.cameraPrefix)
    const hadScr = Boolean(prefixes.current.screenPrefix)
    return {
      cameraUploaded: !hadCam || camOk.current > 0,
      screenUploaded: !hadScr || scrOk.current > 0,
    }
  }, [])

  return { cameraStream, hasScreen, error, requestMedia, start, stop }
}
