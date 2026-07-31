import { ToolResult, ToolSchema } from './toolIndex';
import { tavily } from '@tavily/core';

export const webSchema: ToolSchema[] = [
    {
        type: 'function',
        name: 'web',
        description: 'Searches the web for up-to-date information, docs, news or external content.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The primary search query.'
                }
            },
            required: ['query']
        }
    },
    {
        type: 'function',
        name: 'web_extract',
        description: 'Extracts clean, detailed content from one or more specific web page URLs. Use this after web search when the search snippets are not sufficient.',
        parameters: {
            type: 'object',
            properties: {
                urls: {
                    type: 'array',
                    description: 'The web page URLs to extract content from.',
                    items: {
                        type: 'string',
                        description: 'A fully qualified HTTP or HTTPS URL.'
                    }
                },
                query: {
                    type: 'string',
                    description: 'Optional question or topic used to return the most relevant content chunks from each page.'
                }
            },
            required: ['urls']
        }
    }
];

export async function executeWebSearch(query: string, apiKey: string, signal?: AbortSignal): Promise<ToolResult> {
    if (!apiKey) throw new Error('Tavily API key not configured!');

    try {
        if (signal?.aborted) throw new Error('AbortError');

        const client = tavily({ apiKey: apiKey });

        const response = await client.search(query, {
            searchDepth: 'basic',
            maxResults: 5
        });

        let formattedResults = `Search Results for "${query}":\n\n`;
        response.results.forEach((r, index) => {
            formattedResults += `${index + 1}. Title: ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.content}\n\n`;
        });

        return { message: formattedResults.trim() };

    } catch (e) {
        return { message: `Search error: ${e instanceof Error ? e.message : String(e)}` };
    }
}

export async function executeURL(
    urls: string[],
    apiKey: string,
    query?: string,
    signal?: AbortSignal
): Promise<ToolResult> {
    if (!apiKey) throw new Error('Tavily API key not configured!');
    if (!Array.isArray(urls) || urls.length === 0) {
        return { message: 'Extraction error: at least one URL is required.' };
    }

    const normalizedUrls = urls
        .map(url => typeof url === 'string' ? url.trim() : '')
        .filter(Boolean);

    if (normalizedUrls.length === 0) {
        return { message: 'Extraction error: at least one valid URL is required.' };
    }

    try {
        if (signal?.aborted) throw new Error('AbortError');

        const client = tavily({ apiKey });
        const response = await client.extract(normalizedUrls, {
            ...(query?.trim() ? { query: query.trim(), chunksPerSource: 3 } : {})
        });

        let formattedResults = 'Extracted Web Content:\n\n';

        response.results.forEach((result, index) => {
            formattedResults += `${index + 1}. URL: ${result.url}\n${result.rawContent}\n\n`;
        });

        if (response.failedResults.length > 0) {
            formattedResults += 'Failed URLs:\n';
            response.failedResults.forEach(result => {
                formattedResults += `- ${result.url}: ${result.error}\n`;
            });
        }

        return { message: formattedResults.trim() };
    } catch (e) {
        return { message: `Extraction error: ${e instanceof Error ? e.message : String(e)}` };
    }
}