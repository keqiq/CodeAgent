import { ChatFactory } from "../apis/chat/chatFactory";
import { EmbedFactory } from "../apis/embed/embedFactory";
import { tavily } from '@tavily/core';

export async function getChatModelsFromProvider(provider: string, apiKey: string, fetchAll?: boolean) {
    const providerInstance = ChatFactory.create(provider, apiKey, 'none');
    return await providerInstance.getModels(fetchAll);
}

export async function getEmbedModelsFromProvider(provider: string, apiKey: string) {
    const providerInstance = EmbedFactory.create(provider, apiKey);
    return await providerInstance.getModels();
}

export async function verifyTavilyAPIKey(apiKey: string | undefined) {
    if (!apiKey) throw new Error('Tavily API key not configured!');
    const client = tavily({ apiKey: apiKey });
    await client.search("ping", { maxResults: 1 });
}
