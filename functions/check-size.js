// ============================================
// /functions/check-size.js
// Admin only — KV လုံးဝ မသုံးပါ
// ============================================

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

const FETCH_TIMEOUT_MS = 15000;       // 15s timeout per fetch
const MAX_URL_LENGTH = 2000;
const HEAD_CHUNK_SIZE = 2 * 1024 * 1024;   // 2 MB
const TAIL_CHUNK_SIZE = 512 * 1024;        // 512 KB

const USER_AGENT = 'Mozilla/5.0 (compatible; MovieBot/1.0)';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const checkType = searchParams.get('type') || 'size';
  const pass = searchParams.get('pass');

  // ============================================
  // AUTH (constant-time)
  // ============================================
  const SECURE_PASSWORD = env.ADMIN_PASSWORD;
  if (!pass || !SECURE_PASSWORD || !safeEqual(pass, SECURE_PASSWORD)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // ============================================
  // INPUT VALIDATION
  // ============================================
  if (!url) {
    return jsonResponse({ error: "No URL provided" }, 400);
  }
  if (url.length > MAX_URL_LENGTH) {
    return jsonResponse({ error: "URL too long" }, 400);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return jsonResponse({ error: "Invalid URL" }, 400);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return jsonResponse({ error: "Invalid URL protocol" }, 400);
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    return jsonResponse({ error: "Private/local host not allowed" }, 403);
  }

  // ============================================
  // FETCH SIZE (HEAD)
  // ============================================
  try {
    let sizeResult = { success: false, size: null, bytes: null };
    let contentType = '';

    let headRes;
    try {
      headRes = await fetchWithTimeout(url, {
        method: 'HEAD',
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow'
      }, FETCH_TIMEOUT_MS);
    } catch (e) {
      return jsonResponse({
        success: false,
        sizeSuccess: false,
        durationSuccess: false,
        error: "HEAD request failed"
      });
    }

    contentType = headRes.headers.get('content-type') || '';
    const contentLength = headRes.headers.get('content-length');

    if (contentLength) {
      const bytes = parseInt(contentLength, 10);
      if (!isNaN(bytes) && bytes > 0) {
        sizeResult = {
          success: true,
          bytes,
          size: formatSize(bytes),
          contentType
        };
      }
    }

    // size only request
    if (checkType === 'size') {
      return jsonResponse(sizeResult.success
        ? { success: true, size: sizeResult.size, bytes: sizeResult.bytes, contentType }
        : { success: false, error: "Content-Length မရရှိပါ။" }
      );
    }

    // ============================================
    // FETCH DURATION (Range request, MP4 parser)
    // ============================================
    let durationResult = { success: false };
    const isVideo = contentType.toLowerCase().includes('video') ||
      /\.(mp4|m4v|mov|3gp)(\?|#|$)/i.test(parsedUrl.pathname);

    if (isVideo || checkType === 'duration' || checkType === 'all') {
      durationResult = await getDuration(url, sizeResult.bytes);
    }

    if (checkType === 'duration') {
      return jsonResponse(durationResult);
    }

    // type === 'all'
    return jsonResponse({
      success: sizeResult.success || durationResult.success,
      size: sizeResult.size || null,
      bytes: sizeResult.bytes || null,
      contentType,
      duration: durationResult.duration || null,
      durationFormatted: durationResult.durationFormatted || null,
      durationSuccess: !!durationResult.success,
      sizeSuccess: !!sizeResult.success
    });

  } catch (e) {
    return jsonResponse({ success: false, error: "Fetch failed" }, 500);
  }
}

// ============================================
// PRIVATE HOST DETECTION (IPv4 + IPv6 + special names)
// ============================================
function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();

  // Special hostnames
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h.endsWith('.internal') || h === 'broadcasthost') {
    return true;
  }

  // IPv4
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const o = ipv4Match.slice(1, 5).map(Number);
    if (o.some(x => x < 0 || x > 255)) return true;
    if (o[0] === 10) return true;
    if (o[0] === 127) return true;
    if (o[0] === 0) return true;
    if (o[0] === 169 && o[1] === 254) return true;       // link-local
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
    if (o[0] >= 224) return true;                         // multicast/reserved
    return false;
  }

  // IPv6 (bracketed or plain)
  const ipv6 = h.replace(/^\[|\]$/g, '');
  if (ipv6.includes(':')) {
    if (ipv6 === '::1' || ipv6 === '::') return true;
    const lower = ipv6.toLowerCase();
    if (lower.startsWith('fe80') || lower.startsWith('fc') ||
        lower.startsWith('fd') || lower.startsWith('ff')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.)
    const v4InV6 = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4InV6 && isPrivateHost(v4InV6[1])) return true;
    return false;
  }

  return false;
}

// ============================================
// FETCH WITH TIMEOUT
// ============================================
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// MP4 DURATION EXTRACTION
// ============================================
async function getDuration(url, totalBytes) {
  try {
    // Try head chunk first (most MP4s have moov at start)
    const headBuf = await fetchRange(url, 0, HEAD_CHUNK_SIZE - 1);
    if (headBuf) {
      const duration = findMP4Duration(new Uint8Array(headBuf));
      if (duration) {
        return { success: true, duration, durationFormatted: formatDuration(duration) };
      }
    }

    // Fallback to tail (moov at end — common for streamed MP4s)
    if (totalBytes && totalBytes > HEAD_CHUNK_SIZE) {
      const endStart = Math.max(0, totalBytes - TAIL_CHUNK_SIZE);
      const tailBuf = await fetchRange(url, endStart, totalBytes - 1);
      if (tailBuf) {
        const duration = findMP4Duration(new Uint8Array(tailBuf));
        if (duration) {
          return { success: true, duration, durationFormatted: formatDuration(duration) };
        }
      }
    }

    return { success: false, error: "Duration ထုတ်ယူ၍မရပါ (moov atom မတွေ့ပါ)" };
  } catch (e) {
    return { success: false, error: "Duration parse error" };
  }
}

async function fetchRange(url, start, end) {
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Range': `bytes=${start}-${end}`
      },
      redirect: 'follow'
    }, FETCH_TIMEOUT_MS);

    if (!res.ok && res.status !== 206) {
      return null;
    }

    // Safety cap on response size (avoid OOM on misbehaving servers)
    const expected = end - start + 1;
    const lenHeader = parseInt(res.headers.get('content-length') || '0', 10);
    if (lenHeader > expected + 1024 * 1024) {
      return null;
    }

    return await res.arrayBuffer();
  } catch (e) {
    return null;
  }
}

function findMP4Duration(bytes) {
  const mvhd = [0x6d, 0x76, 0x68, 0x64]; // 'mvhd'
  const limit = bytes.length - 36;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === mvhd[0] && bytes[i+1] === mvhd[1] &&
        bytes[i+2] === mvhd[2] && bytes[i+3] === mvhd[3]) {
      const version = bytes[i + 4];
      let timescale, durationVal;
      if (version === 0) {
        timescale = readUint32(bytes, i + 16);
        durationVal = readUint32(bytes, i + 20);
      } else if (version === 1) {
        if (i + 36 > bytes.length) continue;
        timescale = readUint32(bytes, i + 24);
        // 64-bit duration — high 32 bits ignored (durations >2^32 / timescale rare)
        const high = readUint32(bytes, i + 28);
        const low = readUint32(bytes, i + 32);
        durationVal = high * 0x100000000 + low;
      } else {
        continue;
      }

      if (timescale > 0 && durationVal > 0) {
        const seconds = Math.round(durationVal / timescale);
        if (seconds > 0 && seconds < 86400 * 7) return seconds; // up to 7 days
      }
    }
  }
  return null;
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset+1] << 16) |
          (bytes[offset+2] << 8) | bytes[offset+3]) >>> 0;
}

function formatSize(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
  if (bytes >= 1048576)    return (bytes / 1048576).toFixed(2) + " MB";
  if (bytes >= 1024)       return (bytes / 1024).toFixed(2) + " KB";
  return bytes + " B";
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache"
    }
  });
}
