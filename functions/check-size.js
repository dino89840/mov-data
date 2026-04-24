export async function onRequestGet(context) {
    const { request } = context;
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
        return new Response(JSON.stringify({ error: "No URL provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const contentLength = response.headers.get('content-length');
        const contentType = response.headers.get('content-type');

        if (contentLength) {
            const bytes = parseInt(contentLength);
            let size = "";
            if (bytes >= 1073741824) {
                size = (bytes / 1073741824).toFixed(2) + " GB";
            } else if (bytes >= 1048576) {
                size = (bytes / 1048576).toFixed(2) + " MB";
            } else if (bytes >= 1024) {
                size = (bytes / 1024).toFixed(2) + " KB";
            } else {
                size = bytes + " B";
            }

            return new Response(JSON.stringify({ 
                success: true, 
                size: size,
                bytes: bytes,
                contentType: contentType || "unknown"
            }), {
                headers: { 
                    "Content-Type": "application/json", 
                    "Access-Control-Allow-Origin": "*" 
                }
            });
        } else {
            return new Response(JSON.stringify({ 
                success: false, 
                error: "Content-Length မရရှိပါ။ Link သည် file size မပြသောနည်းလမ်းဖြင့် serve လုပ်နေသည်။" 
            }), {
                headers: { 
                    "Content-Type": "application/json", 
                    "Access-Control-Allow-Origin": "*" 
                }
            });
        }
    } catch (e) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: "Fetch မအောင်မြင်ပါ: " + e.message 
        }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}
