import { ChatFactory } from "../apis/chat/chatFactory";
import { EmbedFactory } from "../apis/embed/embedFactory";
import * as vscode from 'vscode';

export async function getModelsFromProvider(provider: string, apiKey: string, fetchAll?: boolean) {
    const providerInstance = ChatFactory.create(provider, apiKey);
    return await providerInstance.getModels(fetchAll);
}

export async function getEmbeddingModelsFromProvider(provider: string, apiKey: string) {
    const providerInstance = EmbedFactory.create(provider, apiKey);
    return await providerInstance.getModels();
}

