export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const referer = request.headers.get("referer") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // ၁။ Admin Password ပါရင် Cache ကို ကျော်ပြီး KV ထဲက Data အစစ်ကို ပြမယ်
    if (pass && pass === SECURE_PASSWORD) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: { 
                "Content-Type": "application/json;charset=UTF-8", 
                "Access-Control-Allow-Origin": "*" 
            }
        });
    }

    // ၂။ Browser ကနေ Password မပါဘဲ လာတာကို ပိတ်မယ်
    const isBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari") || userAgent.includes("Edge");
    if (isBrowser || referer !== "") {
        return new Response(JSON.stringify({ error: "Unauthorized Access" }), { 
            status: 403,
            headers: { "Content-Type": "application/json;charset=UTF-8" }
        });
    }

    // ၃။ APK အတွက် Cache စနစ်သုံးပြီး Data ထုတ်ပေးခြင်း
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    let response = await cache.match(cacheKey);

    if (!response) {
        // Cache ထဲမှာ မရှိသေးရင် KV ထဲက သွားယူမယ်
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
                "Cache-Control": "public, max-age=3600" // ၁ နာရီ သိမ်းထားမယ် (၃၆၀၀ စက္ကန့်)
            }
        });

        // နောက်တစ်ခါ သုံးလို့ရအောင် Cache ထဲ ထည့်လိုက်မယ်
        context.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
}
