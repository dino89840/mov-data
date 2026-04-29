// ============================================
// /functions/api.js
// APK request → unlimited, KV reads minimized
// Browser → 404, Admin → direct KV access
// ============================================

export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    const isAdmin = pass && pass === SECURE_PASSWORD;

    // ============================================
    // STEP 1: BROWSER BLOCK (KV မသုံးခင်)
    // APK က okhttp/Volley/Retrofit/cronet UA သုံးလို့ pass ဖြစ်တယ်
    // Browser UA ဆိုရင်သာ block
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
    // STEP 2: EDGE CACHE စစ် (APK requests အတွက် KV bypass)
    // ============================================
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.delete('pass');
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
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
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: {
                "Content-Type": "application/json;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store, no-cache",
                "X-Cache": "BYPASS-ADMIN"
            }
        });
    }

    // ============================================
    // STEP 4: KV FETCH (cache miss only)
    // APK request → here only on first call per 2hr
    // ============================================
    let responseBody;

    if (genre.endsWith("-show")) {
        const showData = await env.MOVIE_DB.get(genre);
        if (showData) {
            responseBody = showData;
        } else {
            // Legacy fallback
            const mainGenre = genre.replace("-show", "");
            const rawData = await env.MOVIE_DB.get(mainGenre);
            let list = [];
            try { list = JSON.parse(rawData || "[]"); } catch (e) { list = []; }
            responseBody = JSON.stringify(list.slice(0, 8));
        }
    } else {
        const data = await env.MOVIE_DB.get(genre);
        responseBody = data || "[]";
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
        // stale-while-revalidate ကို ဖြုတ်လိုက်ပြီ
        "Cache-Control": "public, max-age=0, s-maxage=7200", 
        "X-Cache": "MISS" 
    } 
});


    // Background မှာ edge cache မှာ သိမ်း
    context.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}
