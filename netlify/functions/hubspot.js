exports.handler = async (event) => {
    console.log('Received event:', event.httpMethod, event.queryStringParameters, event.body);

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            },
            body: '',
        };
    }

    if (event.httpMethod !== 'POST') {
        console.log('Method not POST:', event.httpMethod);
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: 'Use POST',
        };
    }

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
        console.error('No token');
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'No token' }),
        };
    }

    let body = {};
    try {
        body = JSON.parse(event.body);
        console.log('Parsed body:', body);
    } catch (e) {
        console.error('JSON parse error:', e);
        return {
            statusCode: 400,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Invalid body' }),
        };
    }

    const searchBody = {
        objectTypes: ['BLOG_POST'],
        filters: body.filters || [],
        sorts: body.sorts || [
            { propertyName: 'publish_date', direction: 'DESCENDING' },
        ],
        limit: body.limit || 100,
        after: body.after || undefined,
    };

    console.log('Search body sent to HubSpot:', searchBody);

    const url = new URL('https://api.hubapi.com/crm/v3/objects/search');

    try {
        console.log('Fetching HubSpot API');
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchBody),
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('HubSpot error:', res.status, text);
            throw new Error(`HubSpot error ${res.status}: ${text}`);
        }

        const data = await res.json();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(data),
        };
    } catch (err) {
        console.error('Proxy error:', err);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: 'Proxy error',
                message: err.message,
            }),
        };
    }
};