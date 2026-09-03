import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useRecorder — captures the student's camera+mic and (best effort) their
 * screen, then uploads both to Supabase Storage.
 *
 * Flow used by the quiz page:
 *   1. requestMedia()  -> asks for camera+mic (required) and screen (asked)
 *   2. start()         -> begins recording both
 *   3. stop()          -> stops and keeps the video blobs
 *   4. uploadAll(id)   -> uploads and returns { cameraUrl, screenUrl }
 */
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
      video: { width: 640, height: 480 },
      audio: true,
    })
    camStreamRef.current = cam
    setCameraStream(cam)

    // Screen — asked for, but we don't hard-block if the browser cancels it.
    try {
      const scr = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 8 },
        audio: true,
      })
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
      const r = new MediaRecorder(camStreamRef.current, { mimeType: mime.current })
      r.ondataavailable = (e) => { if (e.data.size) camChunks.current.push(e.data) }
      r.start(4000) // flush every 4s so long recordings survive
      camRecRef.current = r
    }
    if (scrStreamRef.current) {
      const r = new MediaRecorder(scrStreamRef.current, { mimeType: mime.current })
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

  const uploadAll = useCallback(async (studentId) => {
    // Returns storage PATHS (not public URLs). The bucket is private now —
    // the teacher dashboard and the email function create signed links.
    const out = { cameraUrl: null, screenUrl: null }
    const ext = 'webm'
    const upload = async (chunks, label) => {
      if (!chunks.length) return null
      const blob = new Blob(chunks, { type: mime.current })
      const path = `${studentId}/${label}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('recordings')
        .upload(path, blob, { contentType: mime.current, upsert: true })
      if (upErr) { console.error('Upload failed', label, upErr); return null }
      return path
    }
    out.cameraUrl = await upload(camChunks.current, 'camera')
    out.screenUrl = await upload(scrChunks.current, 'screen')
    return out
  }, [])

  return { cameraStream, hasScreen, error, requestMedia, start, stop, uploadAll }
}
