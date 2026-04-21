export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // Admin Pass စစ်ဆေးခြင်း
    if (pass === SECURE_PASSWORD) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: { "Content-Type": "application/json;charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
    }

    // Home (Show) Link
    if (genre.endsWith("-show")) {
        const mainGenre = genre.replace("-show", "");
        const rawData = await env.MOVIE_DB.get(mainGenre);
        let list = JSON.parse(rawData || "[]");
        return new Response(JSON.stringify(list.slice(0, 8)), {
            headers: { "Content-Type": "application/json;charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
    }

    // APK အတွက် ပုံမှန် Data
    const data = await env.MOVIE_DB.get(genre);
    return new Response(data || "[]", {
        headers: { 
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}
