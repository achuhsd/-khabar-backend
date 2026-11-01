const express = require('express')
const router = express.Router()

// ---------------------------------------------------------------------------
// Model fallback chain
// Read from env GEMINI_MODELS (comma-separated) or use these validated defaults.
// Order: highest free-tier RPM first → best free-tier model → fallback.
// ---------------------------------------------------------------------------
const DEFAULT_MODELS = [
  'gemini-2.0-flash-lite', // 30 RPM, 1 500 RPD — best free quota
  'gemini-1.5-flash',      // 15 RPM, 1 500 RPD — stable fallback
  'gemini-2.5-flash',      // 15 RPM, 1 500 RPD — latest fallback
]

function getModels() {
  const raw = process.env.GEMINI_MODELS || ''
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_MODELS
}

function geminiUrl(modelId) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`
}

// ---------------------------------------------------------------------------
// Quick-reply cache  (max 200 entries, 10-min TTL)
// Key = articleId/title + normalised chip text, used ONLY for well-known chips.
// ---------------------------------------------------------------------------
const QUICK_CHIP_LABELS = new Set([
  'quiz me',
  'aur explain karo',
  'impact kya hoga?',
  'simplify karo',
  "what's trending?",
])

const replyCache = new Map()  // key → { reply, expiresAt }
const CACHE_MAX = 200
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 min

function cacheKey(article, message) {
  const articleRef = article?.id || article?.title || 'no-article'
  return `${articleRef}::${message.trim().toLowerCase()}`
}

function cacheGet(key) {
  const entry = replyCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    replyCache.delete(key)
    return null
  }
  return entry.reply
}

function cacheSet(key, reply) {
  if (replyCache.size >= CACHE_MAX) {
    // Evict the oldest entry
    replyCache.delete(replyCache.keys().next().value)
  }
  replyCache.set(key, { reply, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ---------------------------------------------------------------------------
// Per-IP rate limit  (max 8 messages / minute)
// ---------------------------------------------------------------------------
const ipWindows = new Map() // ip → { count, windowStart }
const IP_MAX_PER_MINUTE = 8
const IP_WINDOW_MS = 60_000

function checkIpLimit(ip) {
  const now = Date.now()
  let w = ipWindows.get(ip)
  if (!w || now - w.windowStart >= IP_WINDOW_MS) {
    w = { count: 0, windowStart: now }
    ipWindows.set(ip, w)
  }
  w.count++
  return w.count > IP_MAX_PER_MINUTE
}

// Periodically clean up old IP windows to avoid memory leaks
setInterval(() => {
  const cutoff = Date.now() - IP_WINDOW_MS
  for (const [ip, w] of ipWindows) {
    if (w.windowStart < cutoff) ipWindows.delete(ip)
  }
}, 5 * 60_000)

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_INSTRUCTION = `You are "Khabar Mitra" (News Friend), the friendly AI chat assistant inside
the KHABAR Indian news app. Your personality:
- Talk in casual, warm Hinglish (a natural mix of Hindi and English), like a
  smart friend explaining news over chai — not a formal news anchor.
- Keep replies short and easy to read: 2 to 5 sentences unless the user
  clearly asks for a longer breakdown.
- If an article is provided as context, ground your answer in it. If the
  question goes beyond the article, answer from general knowledge but say so.
- Never invent fake facts, numbers, or quotes. If you are unsure, say so
  honestly instead of guessing.
- You may use light emoji, but do not overdo it.`

const FALLBACK_REPLY =
  'Sorry yaar, main is request ka jawab abhi nahi de pa raha. Thoda alag tareeke se poochoge?'

// ---------------------------------------------------------------------------
// Helper: parse retryDelay string like "34s" or "34.07s" → integer seconds
// ---------------------------------------------------------------------------
function parseRetryDelay(errorData) {
  try {
    const details = errorData?.error?.details
    if (!Array.isArray(details)) return null
    for (const d of details) {
      if (d['@type']?.includes('RetryInfo') && d.retryDelay) {
        const seconds = Math.ceil(parseFloat(d.retryDelay))
        if (Number.isFinite(seconds) && seconds > 0) return seconds
      }
    }
  } catch (_) { /* ignore */ }
  return null
}

// ---------------------------------------------------------------------------
// Helper: determine if a quotaId refers to a daily (unrecoverable-soon) limit
// ---------------------------------------------------------------------------
function isDailyQuota(errorData) {
  try {
    const details = errorData?.error?.details
    if (!Array.isArray(details)) return false
    for (const d of details) {
      if (d['@type']?.includes('QuotaFailure')) {
        for (const v of d.violations || []) {
          if (v.quotaId?.toLowerCase().includes('perday')) return true
        }
      }
    }
  } catch (_) { /* ignore */ }
  return false
}

// ---------------------------------------------------------------------------
// @route   POST /api/chat
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  let timeoutId
  let controller

  try {
    const { message, article, history } = req.body

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ message: 'A message is required' })
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY is not configured' })
    }

    // ── Per-IP rate limit ──────────────────────────────────────────────────
    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown'

    if (checkIpLimit(clientIp)) {
      return res.status(429).json({
        message: 'Thoda dheere bhai, 1 minute mein 8 se zyada message nahi bhej sakte 🙏',
      })
    }

    // ── Quick-reply cache check ────────────────────────────────────────────
    const normMsg = message.trim().toLowerCase()
    const isQuickChip = QUICK_CHIP_LABELS.has(normMsg)
    if (isQuickChip) {
      const ck = cacheKey(article, message)
      const cached = cacheGet(ck)
      if (cached) {
        return res.json({ reply: cached })
      }
    }

    // ── Build prompt body ─────────────────────────────────────────────────
    // Cap article context to ~1200 characters
    let contextText = ''
    if (article) {
      const rawContext = article.summary || article.content || ''
      const trimmedContext = rawContext.length > 1200
        ? rawContext.slice(0, 1200) + '…'
        : rawContext
      contextText = `\n\nThe user is currently reading this news article, use it as context when relevant:\nTitle: ${article.title}\nSummary: ${trimmedContext}`
    }

    // Keep last 4 history messages only (reduces tokens per request)
    const contents = []
    if (Array.isArray(history)) {
      history.slice(-4).forEach((h) => {
        contents.push({
          role: h.sender === 'user' ? 'user' : 'model',
          parts: [{ text: h.text }],
        })
      })
    }
    contents.push({ role: 'user', parts: [{ text: message }] })

    const body = {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION + contextText }] },
      contents,
    }

    // ── Timeout / abort controller ────────────────────────────────────────
    controller = new AbortController()
    timeoutId = setTimeout(() => controller.abort(), 25_000)

    // ── Model fallback chain ──────────────────────────────────────────────
    const models = getModels()
    let lastErrorData = null
    let lastStatus = null
    let reply = null

    for (let i = 0; i < models.length; i++) {
      const modelId = models[i]
      const url = geminiUrl(modelId)

      let response, responseText, data

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        responseText = await response.text()
        try {
          data = responseText ? JSON.parse(responseText) : {}
        } catch {
          data = {}
        }
      } catch (fetchErr) {
        // AbortError (timeout) — stop looping, throw so outer catch handles it
        if (fetchErr?.name === 'AbortError') throw fetchErr
        console.error(`Gemini fetch error on model ${modelId}:`, fetchErr?.message)
        lastStatus = 503
        lastErrorData = null
        continue
      }

      if (!response.ok) {
        lastStatus = response.status
        lastErrorData = data
        const snippet = responseText?.slice(0, 300) || ''
        console.error(`Gemini API error (model=${modelId}, status=${response.status}): ${snippet}`)

        // Retry on 429 / 503 / 404 (model not found); stop on other errors
        if (response.status === 429 || response.status === 503 || response.status === 404) {
          if (i < models.length - 1) continue  // try next model
          break
        }
        // Non-retryable error (e.g. 400 bad request) — stop immediately
        break
      }

      // ── Successful response ───────────────────────────────────────────────
      const candidate = data.candidates?.[0]
      const wasBlocked =
        data.promptFeedback?.blockReason ||
        candidate?.finishReason === 'SAFETY' ||
        candidate?.finishReason === 'BLOCKLIST' ||
        candidate?.finishReason === 'PROHIBITED_CONTENT'

      reply = wasBlocked
        ? FALLBACK_REPLY
        : candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || FALLBACK_REPLY

      break  // success — exit loop
    }

    // ── All models failed ─────────────────────────────────────────────────
    if (reply === null) {
      if (lastStatus === 429) {
        const retryAfterSeconds = parseRetryDelay(lastErrorData)
        const daily = isDailyQuota(lastErrorData)

        if (daily) {
          return res.status(429).json({
            message: 'AI ka aaj ka quota khatam ho gaya 😔 Kal dobara try karo, ya thodi der ruko 🙏',
            retryAfterSeconds: null,
          })
        }

        return res.status(429).json({
          message: retryAfterSeconds
            ? `AI abhi busy hai, ${retryAfterSeconds} second baad dobara try karo 🙏`
            : 'AI par abhi bahut requests hain, 1 minute baad try karo 🙏',
          retryAfterSeconds: retryAfterSeconds || 60,
        })
      }

      return res.status(500).json({ message: 'AI se jawab nahi aaya. Thodi der baad dobara try karo 🙏' })
    }

    // ── Cache quick-reply and respond ────────────────────────────────────
    if (isQuickChip && reply !== FALLBACK_REPLY) {
      cacheSet(cacheKey(article, message), reply)
    }

    return res.json({ reply })

  } catch (error) {
    if (controller?.signal.aborted || error?.name === 'AbortError') {
      console.error('Gemini API request timed out after 25 seconds:', error?.message || error)
      return res.status(504).json({ message: 'Gemini API request timed out' })
    }

    console.error('Chat route error:', error?.status || 'unknown status', error?.message || error)
    return res.status(500).json({ message: 'Chat request failed' })
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
})

module.exports = router
