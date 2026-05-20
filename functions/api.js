// ============================================
// /functions/api.js
// FINAL FIX:
// - s-maxage=3600 (KV reads သက်သာ)
// - KV metadata timestamp → ETag ဖြင့် cache validation
// - Admin save လုပ်တိုင်း ETag ပြောင်း → Cache auto-invalid
// ============================================

export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    const isAdmin = (pass && pass === SECURE_PASSWORD);

    // ============================================
    // STEP 1: BROWSER BLOCK
    // ============================================
    if (!isAdmin) {
        const browserPatterns = /Mozilla\/|Chrome\/|Safari\/|Opera\/|Edg\/|Firefox\//i;
        if (browserPatterns.test(userAgent)) {
            return new Response(
                `<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>`,
                { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } }
            );
        }
    }

    // ============================================
    // STEP 2: EDGE CACHE (Normalized key)
    // ============================================
    const baseUrl = new URL(request.url);
    const normalizedCacheUrl = `${baseUrl.origin}/api?genre=${encodeURIComponent(genre)}`;
    const cacheKey = new Request(normalizedCacheUrl, { method: 'GET' });
    const cache = caches.default;

    if (!isAdmin) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            return cachedResponse;
        }
    }

    // ============================================
    // STEP 3: KV မှ ဖတ်ခြင်း + metadata timestamp ယူမည်
    // ============================================
    let responseBody;
    let lastModified = Date.now().toString();

    if (genre.endsWith("-show")) {
        // -show key အတွက် metadata
        const showResult = await env.MOVIE_DB.getWithMetadata(genre);
        if (showResult.value) {
            responseBody = showResult.value;
            lastModified = showResult.metadata?.lastModified || lastModified;
        } else {
            const mainGenre = genre.replace("-show", "");
            const mainResult = await env.MOVIE_DB.getWithMetadata(mainGenre);
            lastModified = mainResult.metadata?.lastModified || lastModified;
            let list = [];
            try { list = JSON.parse(mainResult.value || "[]"); } catch (e) { list = []; }
            responseBody = JSON.stringify(list.slice(0, 8));
        }
    } else {
        const result = await env.MOVIE_DB.getWithMetadata(genre);
        responseBody = result.value || "[]";
        lastModified = result.metadata?.lastModified || lastModified;
    }

    // ETag = lastModified timestamp ဖြင့် တည်ဆောက်မည်
    const etag = `"${lastModified}"`;

    // ============================================
    // STEP 4: HEADERS
    // s-maxage=3600 → Cloudflare Edge မှာ ၁ နာရီ cache
    // stale-while-revalidate=60 → expire ဖြစ်ပြီး ၁ မိနစ်
    //   အတွင်း background refresh
    // ETag → content ပြောင်းမှသာ cache invalidate
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            "ETag": etag,
            "Last-Modified": new Date(parseInt(lastModified)).toUTCString(),
            "Cache-Control": isAdmin
                ? "no-store, no-cache, must-revalidate"
                : "public, max-age=0, s-maxage=3600, stale-while-revalidate=60"
        }
    });

    if (!isAdmin) {
        context.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
}
