exports.handler = async (event) => {
    // Handle preflight OPTIONS request for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
            },
            body: '',
        };
    }

    // Allow only POST (for Search API) and OPTIONS
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: 'Method Not Allowed',
        };
    }

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'No token set' }),
        };
    }

    const query = event.queryStringParameters || {};
    const blogId = query.blog_id || 'default';

    let body = {};
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Invalid JSON body' }),
        };
    }

    // Build search request body for HubSpot Search API
    const searchBody = {
        objectTypes: ['BLOG_POST'],
        filters: body.filters || [],
        sorts: body.sorts || [
            {
                propertyName: 'publish_date',
                direction: 'DESCENDING',
            },
        ],
        limit: body.limit || 100,
        after: body.after || undefined,
    };

    // Add blog ID filter if provided in query
    if (blogId && blogId !== 'default' && !isNaN(Number(blogId))) {
        searchBody.filters.push({
            propertyName: 'blog_id',
            operator: 'EQ',
            value: blogId,
        });
    }

    const url = new URL('https://api.hubapi.com/crm/v3/objects/search');

    try {
        const hubRes = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchBody),
        });

        if (!hubRes.ok) {
            const text = await hubRes.text();
            throw new Error(`HubSpot Search API error ${hubRes.status}: ${text}`);
        }

        const data = await hubRes.json();

        // Normalize results to match your existing format
        const results = data.results.map(post => ({
            hs_path: post.properties.hs_path,
            name: post.properties.name,
            description: post.properties.post_summary || '',
            publishDate: post.properties.publish_date,
            state: post.properties.state,
            tagIds: post.properties.tag_ids ? post.properties.tag_ids.split(',') : [],
            // Add other fields as needed (image, author, etc.)
        }));

        // Enrich with tag names
        const allTagIds = [...new Set(results.flatMap(post => post.tagIds || []))];

        let tagMap = {};
        if (allTagIds.length > 0) {
            const tagRes = await fetch('https://api.hubapi.com/cms/v3/blogs/tags?limit=500', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
            });

            if (!tagRes.ok) {
                const text = await tagRes.text();
                throw new Error(`HubSpot Tags API error ${tagRes.status}: ${text}`);
            }

            const tagData = await tagRes.json();
            tagMap = tagData.results.reduce((acc, tag) => {
                acc[tag.id] = tag.name;
                return acc;
            }, {});
        }

        const enrichedResults = results.map(post => ({
            ...post,
            tagNames: (post.tagIds || []).map(id => tagMap[id]).filter(Boolean),
        }));

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
            },
            body: JSON.stringify({
                results: enrichedResults,
                total: data.total,
                paging: data.paging,
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
                error: 'HubSpot proxy error',
                message: err instanceof Error ? err.message : String(err),
            }),
        };
    }
};