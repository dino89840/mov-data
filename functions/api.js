export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // ၁။ Admin Password ပါရင် Owner ဖြစ်လို့ အကုန်ပေးမယ်
    if (pass && pass === SECURE_PASSWORD) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: { "Content-Type": "application/json;charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
    }

    // ၂။ Browser Block (Password မပါဘဲ Browser ကလာရင် ပိတ်မယ်)
    const isBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari");
    if (isBrowser && !pass) {
        return new Response(JSON.stringify({ error: "Access Denied" }), { 
            status: 403,
            headers: { "Content-Type": "application/json;charset=UTF-8" }
        });
    }

    // ၃။ APK အတွက် Data ထုတ်ပေးခြင်း
    if (genre.endsWith("-show")) {
        const mainGenre = genre.replace("-show", "");
        const rawData = await env.MOVIE_DB.get(mainGenre);
        let list = JSON.parse(rawData || "[]");
        return new Response(JSON.stringify(list.slice(0, 8)), {
            headers: { "Content-Type": "application/json;charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
    }

    const data = await env.MOVIE_DB.get(genre);
    return new Response(data || "[]", {
        headers: { "Content-Type": "application/json;charset=UTF-8", "Access-Control-Allow-Origin": "*" }
    });
}
