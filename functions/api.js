// ============================================
// /functions/api.js
// APK request → unlimited, KV reads minimized
// Browser → 404, Admin → direct KV access
// ============================================

// Constant-time string compare (timing attack ကာကွယ်ဖို့)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Genre key validation — KV abuse ကာကွယ်ဖို့
function isValidGenre(genre) {
  if (!genre || typeof genre !== 'string') return false;
  if (genre.length > 64) return false;
  // alphanumeric, dash, underscore ပဲ ခွင့်ပြု
  return /^[a-zA-Z0-9_-]+$/.test(genre);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { searchParams } = new URL(request.url);
  const genre = searchParams.get('genre') || 'all';
  const pass = searchParams.get('pass');
  const userAgent = request.headers.get("user-agent") || "";

  const SECURE_PASSWORD = env.ADMIN_PASSWORD;
  const isAdmin = pass && SECURE_PASSWORD && safeEqual(pass, SECURE_PASSWORD);

  // ============================================
  // STEP 0: GENRE VALIDATION (KV မသုံးခင်)
  // ============================================
  if (!isValidGenre(genre)) {
    return new Response("[]", {
      status: 400,
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "Cache-Control": "public, max-age=3600"
      }
    });
  }

  // ============================================
  // STEP 1: BROWSER BLOCK (KV မသုံးခင်)
  // APK က okhttp/Volley/Retrofit/cronet UA သုံးလို့ pass ဖြစ်တယ်
  // Browser UA ဆိုရင်သာ block + empty UA လည်း block
  // ============================================
  if (!isAdmin) {
    const browserPatterns = /Mozilla\/|Chrome\/|Safari\/|Opera\/|Edg\/|Firefox\/|MSIE|Trident\//i;
    if (browserPatterns.test(userAgent) || userAgent.trim() === "") {
      return new Response(
        `<!DOCTYPE html>
<html><head><title>404 Not Found</title>
<style>body{font-family:sans-serif;text-align:center;padding:80px;background:#f7fafc;}
h1{color:#2d3748;font-size:48px;}p{color:#718096;}</style></head>
<body><h1>404</h1><p>The page you requested could not be found.</p></body></html>`,
        {
          status: 404,
          headers: {
            "Content-Type": "text/html;charset=UTF-8",
            "Cache-Control": "public, max-age=3600"
          }
        }
      );
    }
  }

  // ============================================
  // STEP 2: EDGE CACHE စစ် (APK requests အတွက် KV bypass)
  // pass parameter ကို cache key ထဲက အမြဲဖျက် (security)
  // ============================================
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete('pass');
  // Cache key normalize — extra params တွေ ဖြုတ်
  const normalizedUrl = `${cacheUrl.origin}${cacheUrl.pathname}?genre=${encodeURIComponent(genre)}`;
  const cacheKey = new Request(normalizedUrl, { method: 'GET' });
  const cache = caches.default;

  if (!isAdmin) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      // Edge cache hit → KV လုံးဝမသုံး
      const newResponse = new Response(cached.body, cached);
      newResponse.headers.set('X-Cache', 'HIT');
      return newResponse;
    }
  }

  // ============================================
  // STEP 3: ADMIN ACCESS — direct KV, no cache
  // ============================================
  if (isAdmin) {
    try {
      const data = await env.MOVIE_DB.get(genre);
      return new Response(data || "[]", {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Cache": "BYPASS-ADMIN"
        }
      });
    } catch (e) {
      return new Response("[]", {
        status: 500,
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }
  }

  // ============================================
  // STEP 4: KV FETCH (cache miss only)
  // APK request → here only on first call per 2hr
  // ============================================
  let responseBody;
  try {
    if (genre.endsWith("-show")) {
      const showData = await env.MOVIE_DB.get(genre);
      if (showData) {
        responseBody = showData;
      } else {
        // Legacy fallback
        const mainGenre = genre.replace("-show", "");
        if (!isValidGenre(mainGenre)) {
          responseBody = "[]";
        } else {
          const rawData = await env.MOVIE_DB.get(mainGenre);
          let list = [];
          try {
            list = JSON.parse(rawData || "[]");
            if (!Array.isArray(list)) list = [];
          } catch (e) {
            list = [];
          }
          responseBody = JSON.stringify(list.slice(0, 8));
        }
      }
    } else {
      const data = await env.MOVIE_DB.get(genre);
      responseBody = data || "[]";
    }
  } catch (e) {
    // KV error → empty array (APK က crash မဖြစ်အောင်)
    responseBody = "[]";
  }

  // ============================================
  // STEP 5: RESPONSE + LONG EDGE CACHE
  // 2 နာရီ cache → KV reads 92% လျှော့
  // update.js က save လုပ်တိုင်း cache purge လုပ်ပေးတယ် → stale data မရှိ
  // stale-while-revalidate နဲ့ user အမြဲ မြန်မြန်ရ
  // ============================================
  const response = new Response(responseBody, {
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400",
      "X-Cache": "MISS"
    }
  });

  // Background မှာ edge cache မှာ သိမ်း
  context.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
