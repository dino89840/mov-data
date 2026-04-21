export async function onRequestPost(context) {
    const { env } = context;
    try {
        const body = await context.request.json();
        const SECURE_PASSWORD = env.ADMIN_PASSWORD; 

        // Password စစ်ဆေးခြင်း
        if (body.password !== SECURE_PASSWORD) {
            return new Response("Unauthorized: Wrong Password", { status: 401 });
        }
        
        // Data သိမ်းဆည်းခြင်း
        await env.MOVIE_DB.put(body.genre, body.data);
        return new Response("Success: Data Updated!", { status: 200 });
        
    } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
    }
}
