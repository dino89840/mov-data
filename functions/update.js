// ============================================
// /functions/update.js
// ============================================

export async function onRequestPost(context) {
    const { env, request } = context;

    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    try {
        const body = await request.json();
        const SECURE_PASSWORD = env.ADMIN_PASSWORD;
        const clientIP = request.headers.get("cf-connecting-ip") || "unknown";

        // ============================================
        // PASSWORD VALIDATION
        // ============================================
        if (!body.password || body.password !== SECURE_PASSWORD) {
            const failKey = `fail_${clientIP}`;
            const failData = await env.MOVIE_DB.get(failKey);
            let fails = failData ? parseInt(failData) : 0;
            fails++;
            context.waitUntil(
                env.MOVIE_DB.put(failKey, String(fails), { expirationTtl: 900 })
            );

            if (fails >= 5) {
                return new Response(JSON.stringify({ error: "Too many failed attempts. Locked for 15 minutes." }), {
                    status: 429,
                    headers: { "Content-Type": "application/json" }
                });
            }

            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        // ============================================
        // INPUT VALIDATION
        // ============================================
        if (!body.genre || typeof body.genre !== 'string') {
            return new Response(JSON.stringify({ error: "Invalid genre" }), { status: 400 });
        }
        if (!body.data || typeof body.data !== 'string') {
            return new Response(JSON.stringify({ error: "Invalid data" }), { status: 400 });
        }

        let parsedData;
        try {
            parsedData = JSON.parse(body.data);
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON data" }), { status: 400 });
        }

        if (body.data.length > 5 * 1024 * 1024) {
            return new Response(JSON.stringify({ error: "Data too large (max 5MB)" }), { status: 413 });
        }

        context.waitUntil(env.MOVIE_DB.delete(`fail_${clientIP}`));

        // ============================================
        // KV SAVE — Main key
        // ============================================
        await env.MOVIE_DB.put(body.genre, body.data);

        // ============================================
        // PRE-COMPUTE "-show" key
        // ============================================
        if (Array.isArray(parsedData)) {
            const showData = JSON.stringify(parsedData.slice(0, 8));
            context.waitUntil(env.MOVIE_DB.put(`${body.genre}-show`, showData));
        }

        // ============================================
        // SLIDER MOVIE AUTO UPDATE
        // ============================================
        const sliderCategories = [
            "jav-mmsub", "jav-nosub",
            "usa-mmsub", "usa-nosub",
            "chinese-mmsub", "chinese-nosub",
            "yoteshin"
        ];

        if (sliderCategories.includes(body.genre)) {
            const otherCats = sliderCategories.filter(c => c !== body.genre);

            const otherFetches = otherCats.map(async (cat) => {
                const catData = await env.MOVIE_DB.get(cat);
                let movies = [];
                try { movies = JSON.parse(catData || "[]"); } catch (e) { movies = []; }
                return movies.slice(0, 3).map((movie, index) => ({
                    ...movie,
                    _source_category: cat,
                    _order_index: index
                }));
            });

            const currentMovies = (Array.isArray(parsedData) ? parsedData : [])
                .slice(0, 3)
                .map((movie, index) => ({
                    ...movie,
                    _source_category: body.genre,
                    _order_index: index
                }));

            const otherResults = await Promise.all(otherFetches);
            const allMovies = [...currentMovies];
            otherResults.forEach(catMovies => allMovies.push(...catMovies));

            allMovies.sort((a, b) => a._order_index - b._order_index);

            const sliderMovies = allMovies.slice(0, 6).map(({ _source_category, _order_index, ...clean }) => clean);

            context.waitUntil(
                env.MOVIE_DB.put("slider-movie", JSON.stringify(sliderMovies))
            );
            context.waitUntil(
                env.MOVIE_DB.put("slider-movie-show", JSON.stringify(sliderMovies.slice(0, 8)))
            );
        }

        // ============================================
        // EDGE CACHE PURGE — 2hr cache ဖြစ်တာကြောင့်
        // save လုပ်တိုင်း မဖျက်ရင် APK က old data မြင်နေမယ်
        // ============================================
        const url = new URL(request.url);
        const baseOrigin = url.origin;
        // ============================================
// EDGE CACHE PURGE — အတိအကျတူအောင် ဖျက်နည်း
// ============================================
const cache = caches.default;

// ဖျက်ရမယ့် Genre စာရင်း
const genresToPurge = [body.genre, `${body.genre}-show` ];
if (sliderCategories.includes(body.genre)) {
    genresToPurge.push("slider-movie", "slider-movie-show");
}

const purgePromises = genresToPurge.map(async (g) => {
    // api.js မှာ သိမ်းခဲ့တဲ့ URL format အတိုင်း အတိအကျ ပြန်တည်ဆောက်တာပါ
    const purgeUrl = new URL(`${baseOrigin}/api`);
    purgeUrl.searchParams.set('genre', g);
    
    // Request Object အနေနဲ့ ဖျက်မှ cache.match နဲ့ ကိုက်ညီမှာပါ
    return cache.delete(new Request(purgeUrl.toString()));
});

await Promise.all(purgePromises);


        return new Response(JSON.stringify({ success: true, message: "Updated successfully" }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            }
        });

    } catch (e) {
        return new Response(JSON.stringify({ error: "Server error: " + e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
    });
}
