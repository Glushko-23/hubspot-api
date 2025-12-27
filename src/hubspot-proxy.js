import fetch from 'node-fetch';

export default async function handler(event, env = process.env) {
    const environment = env || process.env;

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            },
            body: '',
        };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const token = environment.HUBSPOT_ACCESS_TOKEN;

    if (!token) {
        return { statusCode: 500, body: JSON.stringify({ error: 'No token set' }) };
    }

    const query = event.queryStringParameters || {};
    const blogId = query.blog_id || 'default';
    const limit = Number(query.limit) || 100;
    const offset = Number(query.offset) || 0;

    const url = new URL('https://api.hubapi.com/cms/v3/blogs/posts');

    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('offset', offset.toString());

    if (blogId && blogId !== 'default') {
        url.searchParams.set('contentGroupId', blogId);
    }

    Object.entries(query).forEach(([key, value]) => {
        if (!['limit', 'offset', 'blog_id'].includes(key) && typeof value === 'string') {
            url.searchParams.set(key, value);
        }
    });

    try {
        const hubRes = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
        });

        if (!hubRes.ok) {
            const text = await hubRes.text();
            throw new Error(`HubSpot API error ${hubRes.status}: ${text}`);
        }

        const data = await hubRes.json();

        const allTagIds = [...new Set(data.results.flatMap(post => post.tagIds || []))];

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

        const enrichedResults = data.results.map(post => ({
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
                'Cache-Control': 's-maxage=3600, stale-while-revalidate=60'
            },
            body: JSON.stringify({
                ...data,
                results: enrichedResults,
            }),
        };
    } catch (err) {
        console.error('Proxy error:', err);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: JSON.stringify({
                error: 'HubSpot proxy error',
                message: err.message,
            }),
        };
    }
}