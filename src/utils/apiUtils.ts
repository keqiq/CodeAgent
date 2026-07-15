import { ChatFactory } from "../apis/chat/chatFactory";
import { EmbedFactory } from "../apis/embed/embedFactory";

export async function getChatModelsFromProvider(provider: string, apiKey: string, fetchAll?: boolean) {
    const providerInstance = ChatFactory.create(provider, apiKey);
    return await providerInstance.getModels(fetchAll);
}

export async function getEmbedModelsFromProvider(provider: string, apiKey: string) {
    const providerInstance = EmbedFactory.create(provider, apiKey);
    return await providerInstance.getModels();
}

