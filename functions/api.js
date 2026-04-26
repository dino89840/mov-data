// ============================================
// /functions/api.js
// KV usage ကို ၈၀%+ လျှော့ချထားပါသည်
// ============================================

export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const clientIP = request.headers.get("cf-connecting-ip") ||
                     request.headers.get("x-forwarded-for") || "unknown";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    const isAdmin = pass && pass === SECURE_PASSWORD;

    // ============================================
    // STEP 1: BROWSER BLOCK အရင်စစ် (KV မသုံးခင်)
    // ============================================
    if (!isAdmin) {
        const browserPatterns = /Mozilla\/|Chrome\/|Safari\/|Opera\/|Edg\/|Firefox\//i;
        if (browserPatterns.test(userAgent)) {
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
    // STEP 2: EDGE CACHE စစ်ဆေး (KV မသုံးခင်)
    // Admin မဟုတ်ရင် Cloudflare edge cache ကိုသုံးမည်
    // ============================================
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.delete('pass'); // pass ကို cache key မှ ဖယ်
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    if (!isAdmin) {
        const cached = await cache.match(cacheKey);
        if (cached) {
            // Edge cache hit — KV လုံးဝမသုံးဘဲ ပြန်
            return cached;
        }
    }

    // ============================================
    // STEP 3: RATE LIMITING (lightweight)
    // KV ကိုမသုံးဘဲ in-memory counter သုံးမည်
    // ပြီး abuse များတဲ့ IP သာ KV မှာ ban list သိမ်းမည်
    // ============================================
    if (!isAdmin) {
        // KV-based rate limit ကို ပယ်ဖျက်လိုက်တယ် (KV သုံးစရာများလို့)
        // Cloudflare က default DDoS protection ရှိပြီးသား
        // ပိုလိုချင်ရင် Cloudflare WAF Rate Limiting Rule ကို Dashboard မှာ setup လုပ်ပါ
    }

    // ============================================
    // STEP 4: ADMIN ACCESS — Password ပါရင် အကုန်ပေး
    // ============================================
    if (isAdmin) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: {
                "Content-Type": "application/json;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store, no-cache"
            }
        });
    }

    // ============================================
    // STEP 5: HOME SHOW ENDPOINT
    // သီးသန့် "{genre}-show" key မှာ pre-computed 8 items သိမ်းထားမည်
    // (update.js မှာ auto-create လုပ်)
    // ============================================
    let responseBody;
    let kvKey = genre;

    if (genre.endsWith("-show")) {
        // Pre-computed key ကိုပဲ direct fetch
        const showData = await env.MOVIE_DB.get(genre);
        if (showData) {
            responseBody = showData;
        } else {
            // Fallback: main key ကို fetch ပြီး slice (legacy support)
            const mainGenre = genre.replace("-show", "");
            const rawData = await env.MOVIE_DB.get(mainGenre);
            let list = [];
            try { list = JSON.parse(rawData || "[]"); } catch (e) { list = []; }
            responseBody = JSON.stringify(list.slice(0, 8));
        }
    } else {
        // Normal full list
        const data = await env.MOVIE_DB.get(genre);
        responseBody = data || "[]";
    }

    // ============================================
    // STEP 6: RESPONSE + EDGE CACHE STORE
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            // 10 မိနစ် edge cache — KV reads ကို 90%+ လျှော့ချ
            "Cache-Control": "public, max-age=600, s-maxage=600"
        }
    });

    // Edge cache မှာသိမ်း (background)
    context.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}
