export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';

    // KV ထဲကနေ data ကို ဆွဲထုတ်မယ်
    const data = await env.MOVIE_DB.get(genre);
    
    return new Response(data || "[]", {
        headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
        }
    });
}
