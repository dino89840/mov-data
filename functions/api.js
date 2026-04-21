export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // ၁။ Admin Password ပါရင် (Owner) Cache ကို ကျော်ပြီး KV ကနေ အစစ်ယူပြမယ်
    if (pass && pass === SECURE_PASSWORD) {
        const kvData = await env.MOVIE_DB.get(genre);
        return new Response(kvData || "[]", {
            headers: { "Content-Type": "application/json;charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
    }

    // ၂။ Browser Block
    const isBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari");
    if (isBrowser && !pass) {
        return new Response(JSON.stringify({ error: "Access Denied" }), { status: 403 });
    }

    // ၃။ APK အတွက် Cache စနစ်
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    let response = await cache.match(cacheKey);

    if (!response) {
        let rawData;
        if (genre.endsWith("-show")) {
            const mainGenre = genre.replace("-show", "");
            const kvData = await env.MOVIE_DB.get(mainGenre);
            let list = JSON.parse(kvData || "[]");
            rawData = JSON.stringify(list.slice(0, 8));
        } else {
            rawData = await env.MOVIE_DB.get(genre);
        }

        response = new Response(rawData || "[]", {
            headers: { 
                "Content-Type": "application/json;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600" // ၁ နာရီ Cache သိမ်းမယ်
            }
        });
        context.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
}
