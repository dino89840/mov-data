export async function onRequestPost(context) {
    const { env, request } = context;

    // ============================================
    // CORS Preflight
    // ============================================
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
            // Failed attempt log
            const failKey = `fail_${clientIP}`;
            const failData = await env.MOVIE_DB.get(failKey);
            let fails = failData ? parseInt(failData) : 0;
            fails++;
            context.waitUntil(
                env.MOVIE_DB.put(failKey, String(fails), { expirationTtl: 900 }) // 15 မိနစ်
            );

            // ၅ ကြိမ်ထက်ပိုရင် တာ
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

        // JSON valid ဟုတ်မဟုတ် စစ်
        let parsedData;
        try {
            parsedData = JSON.parse(body.data);
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON data" }), { status: 400 });
        }

        // Data size limit — 5MB
        if (body.data.length > 5 * 1024 * 1024) {
            return new Response(JSON.stringify({ error: "Data too large (max 5MB)" }), { status: 413 });
        }

        // Password fail count ကို reset လုပ်မယ် (login အောင်မြင်ပြီ)
        context.waitUntil(env.MOVIE_DB.delete(`fail_${clientIP}`));

        // ============================================
        // KV SAVE
        // ============================================
        await env.MOVIE_DB.put(body.genre, body.data);

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
            let allMovies = [];

            const catFetches = sliderCategories.map(async (cat) => {
                let catData;
                if (cat === body.genre) {
                    catData = body.data;
                } else {
                    catData = await env.MOVIE_DB.get(cat);
                }
                let movies = [];
                try { movies = JSON.parse(catData || "[]"); } catch (e) { movies = []; }
                return movies.slice(0, 3).map((movie, index) => ({
                    ...movie,
                    _source_category: cat,
                    _order_index: index
                }));
            });

            const results = await Promise.all(catFetches);
            results.forEach(catMovies => allMovies.push(...catMovies));

            allMovies.sort((a, b) => a._order_index - b._order_index);

            const sliderMovies = allMovies.slice(0, 6).map(({ _source_category, _order_index, ...clean }) => clean);

            context.waitUntil(
                env.MOVIE_DB.put("slider-movie", JSON.stringify(sliderMovies))
            );
        }

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
