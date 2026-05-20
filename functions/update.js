// ============================================
// /functions/update.js
// Admin update တိုင်း version တိုးပေးမယ်
// → User တွေအတွက် cache key က automatic ပြောင်းသွားလို့
// → VPN/Region မရွေး instant update ဖြစ်သွားမယ်
// ============================================

export async function onRequestPost(context) {
    const { env, request } = context;

    // CORS Options
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

        // Password စစ်ဆေးခြင်း
        if (!body.password || body.password !== SECURE_PASSWORD) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Data စစ်ဆေးခြင်း
        if (!body.genre || typeof body.genre !== 'string' || !body.data || typeof body.data !== 'string') {
            return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400 });
        }

        let parsedData;
        try {
            parsedData = JSON.parse(body.data);
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
        }

        // ============================================
        // KV SAVE — Main key
        // ============================================
        await env.MOVIE_DB.put(body.genre, body.data);

        // ============================================
        // VERSION BUMP — အရေးကြီးဆုံး
        // Version တိုးလိုက်တာနဲ့ user တွေအတွက် cache key အသစ် ဖြစ်သွားမယ်
        // ============================================
        const newVersion = Date.now().toString();
        await env.MOVIE_DB.put(`__v_${body.genre}`, newVersion);

        // PRE-COMPUTE "-show" key
        if (Array.isArray(parsedData)) {
            const showData = JSON.stringify(parsedData.slice(0, 8));
            context.waitUntil(env.MOVIE_DB.put(`${body.genre}-show`, showData));
        }

        // ============================================
        // SLIDER MOVIE AUTO UPDATE
        // ============================================
        const sliderCategories = [
            "jav-mmsub", "jav-nosub", "usa-mmsub", "usa-nosub",
            "chinese-mmsub", "chinese-nosub", "yoteshin"
        ];

        if (sliderCategories.includes(body.genre)) {
            const otherCats = sliderCategories.filter(c => c !== body.genre);

            const otherFetches = otherCats.map(async (cat) => {
                const catData = await env.MOVIE_DB.get(cat);
                let movies = [];
                try { movies = JSON.parse(catData || "[]"); } catch (e) {}
                return movies.slice(0, 3).map((movie, index) => ({
                    ...movie, _source_category: cat, _order_index: index
                }));
            });

            const currentMovies = (Array.isArray(parsedData) ? parsedData : [])
                .slice(0, 3).map((m, i) => ({ ...m, _source_category: body.genre, _order_index: i }));

            const otherResults = await Promise.all(otherFetches);
            const allMovies = [...currentMovies];
            otherResults.forEach(catMovies => allMovies.push(...catMovies));

            allMovies.sort((a, b) => a._order_index - b._order_index);
            const sliderMovies = allMovies.slice(0, 6).map(({ _source_category, _order_index, ...clean }) => clean);

            await env.MOVIE_DB.put("slider-movie", JSON.stringify(sliderMovies));
            await env.MOVIE_DB.put("slider-movie-show", JSON.stringify(sliderMovies.slice(0, 8)));
            
            // Slider version ကိုပါ bump လုပ်ပေးမယ်
            await env.MOVIE_DB.put(`__v_slider-movie`, newVersion);
        }

        // ============================================
        // EDGE CACHE PURGE (Local data center only — but it's OK now)
        // Version system ကြောင့် ဒီ purge က မရှိမဖြစ်တော့မဟုတ်ပါ
        // ဒါပေမယ့် local data center အတွက် bonus speedup ဖြစ်စေတယ်
        // ============================================
        const url = new URL(request.url);
        const baseOrigin = url.origin;
        const cache = caches.default;

        // Old version cache keys (best-effort delete)
        const purgeUrls = [
            `${baseOrigin}/api?genre=${body.genre}`,
            `${baseOrigin}/api?genre=${body.genre}-show`
        ];

        if (sliderCategories.includes(body.genre)) {
            purgeUrls.push(`${baseOrigin}/api?genre=slider-movie`);
            purgeUrls.push(`${baseOrigin}/api?genre=slider-movie-show`);
        }

        context.waitUntil(Promise.all(purgeUrls.map(u => cache.delete(new Request(u)))));

        // အောင်မြင်ကြောင်း ပြန်ပို့မည်
        return new Response(JSON.stringify({
            success: true,
            message: "Updated successfully",
            version: newVersion
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
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
