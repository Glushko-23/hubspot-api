exports.handler = async (event) => {
    // Handle preflight OPTIONS request for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
            },
            body: '',
        };
    }

    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
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
    const tagId = query.tagId__eq; // Tag ID for category filter
    const limit = Number(query.limit) || 100;
    const after = query.after; // For pagination

    // Build search request body for HubSpot Search API
    const searchBody = {
        objectTypes: ['BLOG_POST'],
        filters: [],
        sorts: [
            {
                propertyName: 'publish_date',
                direction: 'DESCENDING',
            },
        ],
        limit: limit,
        after: after || undefined,
    };

    // Filter by blog ID (if specified and not default)
    if (blogId && blogId !== 'default' && !isNaN(Number(blogId))) {
        searchBody.filters.push({
            propertyName: 'blog_id',
            operator: 'EQ',
            value: blogId,
        });
    }

    // Filter by published state
    searchBody.filters.push({
        propertyName: 'state',
        operator: 'EQ',
        value: 'PUBLISHED',
    });

    // Filter by tag ID (category)
    if (tagId) {
        searchBody.filters.push({
            propertyName: 'tag_ids',
            operator: 'IN',
            values: [tagId],
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

        // Enrich with tag names (optional, if you need tag names)
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
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
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