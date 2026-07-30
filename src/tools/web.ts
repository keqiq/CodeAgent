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

    }
];

export async function executeWebSearch(query: string, apiKey: string, signal?: AbortSignal): Promise<ToolResult> {
    if (!apiKey) throw new Error('Tavily API key not configured!');

    try {

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