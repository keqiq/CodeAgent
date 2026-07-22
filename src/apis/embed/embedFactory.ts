import { EmbedProvider } from "./embedProvider";
import { GeminiEmbedProvider } from "./gemini";
import { ollamaEmbedProvider } from "./ollama";
import { OpenAIEmbedProvider } from "./openai";

type EmbedProviderConstructor = new (apiKey: string) => EmbedProvider;

export class EmbedFactory {
    private static readonly providers: Record<string, EmbedProviderConstructor> = {
        'Gemini': GeminiEmbedProvider,
        'OpenAI': OpenAIEmbedProvider,
        'Ollama': ollamaEmbedProvider
    };

    static getAvailableProviders(): string[] {
        return Object.keys(this.providers);
    }

    static create(providerName: string, apiKey: string): EmbedProvider {
        const ProviderClass = this.providers[providerName];

        return new ProviderClass(apiKey);
    }
}