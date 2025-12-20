import handler from '../src/hubspot-proxy.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const queryStringParameters = Object.fromEntries(url.searchParams);

        const fakeEvent = {
            httpMethod: request.method,
            queryStringParameters,
        };

        const result = await handler(fakeEvent, env);

        const headers = new Headers(result.headers || {});
        return new Response(result.body, {
            status: result.statusCode,
            headers,
        });
    },
};