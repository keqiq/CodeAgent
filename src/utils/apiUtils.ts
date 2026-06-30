import { ChatFactory } from "../apis/chat/chatFactory";
import { EmbedFactory } from "../apis/embed/embedFactory";
import * as vscode from 'vscode';

export async function getModelsFromProvider(provider: string, apiKey: string) {
    const providerInstance = ChatFactory.create(provider, apiKey);
    return await providerInstance.getModels();
}

export async function getEmbeddingModelsFromProvider(provider: string, apiKey: string) {
    const providerInstance = EmbedFactory.create(provider, apiKey);
    return await providerInstance.getModels();
}

export async function getChatAPIKey(context: vscode.ExtensionContext, provider: string) {
    const secretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
    return await context.secrets.get(secretKey);
}

export async function getEmbedAPIKey(context: vscode.ExtensionContext, provider: string) {
    const secretKey = `${provider.toUpperCase()}_EMBED_API_KEY`;
    return await context.secrets.get(secretKey);
}