export async function onRequestPost(context) {
    const { env } = context;
    try {
        const body = await context.request.json();
        
        // body.genre ကို Key လုပ်ပြီး body.data ကို သိမ်းမယ်
        await env.MOVIE_DB.put(body.genre, body.data);
        
        return new Response("Update Successful", { status: 200 });
    } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
    }
}
