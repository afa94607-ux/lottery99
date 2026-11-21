export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Serve static assets from dist
    try {
      if (env && env.ASSETS) {
        const response = await env.ASSETS.fetch(request);
        if (response.status !== 404) {
          return response;
        }
        // SPA fallback to index.html
        return await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      }
    } catch (e) {
      // Fallback
    }
    return new Response('Lottery888 Platform Loading...', {
      headers: { 'Content-Type': 'text/html;charset=utf-8' }
    });
  }
};
