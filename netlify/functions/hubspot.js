exports.handler = async (event) => {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            },
            body: '',
        };
    }

    // Only POST allowed for Search API
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: 'Method Not Allowed — use POST',
        };
    }

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'No access token configured' }),
        };
    }

    // Parse body safely
    let requestBody = {};
    if (event.body) {
        try {
            requestBody = JSON.parse(event.body);
        } catch (e) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Invalid JSON in request body' }),
            };
        }
    }

    // Get blog_id from query (for compatibility)
    const query = event.queryStringParameters || {};
    const blogId = query.blog_id || 'default';

    // Build search body
    const searchBody = {
        objectTypes: ['BLOG_POST'],
        filters: requestBody.filters || [],
        sorts: requestBody.sorts || [
            { propertyName: 'publish_date', direction: 'DESCENDING' }
        ],
        limit: requestBody.limit || 100,
        after: requestBody.after,
    };

    // Add blog filter
    if (blogId && blogId !== 'default') {
        searchBody.filters.push({
            propertyName: 'blog_id',
            operator: 'EQ',
            value: blogId,
        });
    }

    // Always filter by PUBLISHED
    searchBody.filters.push({
        propertyName: 'state',
        operator: 'EQ',
        value: 'PUBLISHED',
    });

    try {
        const response = await fetch('https://api.hubapi.com/crm/v3/objects/search', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchBody),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error('HubSpot Search API error:', response.status, text);
            throw new Error(`HubSpot error ${response.status}: ${text}`);
        }

        const data = await response.json();

        // Normalize results (adapt to your util.normalizeApiResults)
        const results = data.results.map(post => ({
            hs_path: post.properties.hs_path || '',
            name: post.properties.name || 'Untitled',
            description: post.properties.post_summary || '',
            image: { url: post.properties.featured_image || '' },
            publishDate: post.properties.publish_date,
            tagIds: post.properties.tag_ids ? post.properties.tag_ids.split(',') : [],
            state: post.properties.state,
        }));

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                results,
                total: data.total,
                paging: data.paging || null,
            }),
        };
    } catch (err) {
        console.error('Proxy error:', err);

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: err.message,
            }),
        };
    }
};