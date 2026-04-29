// ============================================
// /functions/api.js
// Version-based cache busting + normalized cache key
// ============================================

export async function onRequestGet(context) {
    const { env, request } = context;
    const url = new URL(request.url);
    const genre = url.searchParams.get('genre') || 'all';
    const pass = url.searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    const isAdmin = pass && pass === SECURE_PASSWORD;

    // ============================================
    // STEP 1: BROWSER BLOCK
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
    // STEP 2: ADMIN — direct KV, no cache
    // ============================================
    if (isAdmin) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: {
                "Content-Type": "application/json;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache",
                "X-Cache": "BYPASS-ADMIN"
            }
        });
    }

    // ============================================
    // STEP 3: NORMALIZED CACHE KEY
    // pass parameter ဖြုတ်၊ genre တစ်ခုတည်းပဲ ထား
    // ဒါမှ APK က URL format မကွဲဘဲ ကိုက်ညီမှာ
    // ============================================
    const normalizedUrl = new URL(url.origin + '/api');
    normalizedUrl.searchParams.set('genre', genre);
    const cacheKey = new Request(normalizedUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    // ============================================
    // STEP 4: EDGE CACHE CHECK
    // ============================================
    const cached = await cache.match(cacheKey);
    if (cached) {
        const newResponse = new Response(cached.body, cached);
        newResponse.headers.set('X-Cache', 'HIT');
        return newResponse;
    }

    // ============================================
    // STEP 5: KV FETCH
    // ============================================
    let responseBody;

    if (genre.endsWith("-show")) {
        const showData = await env.MOVIE_DB.get(genre);
        if (showData) {
            responseBody = showData;
        } else {
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
    // STEP 6: RESPONSE + CACHE
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=0, s-maxage=7200",
            "X-Cache": "MISS"
        }
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}
