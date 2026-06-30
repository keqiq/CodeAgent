import { EmbedProvider } from "./embedProvider";
import { GeminiEmbedProvider } from "./gemini";

type EmbedProviderConstructor = new (apiKey: string) => EmbedProvider;

export class EmbedFactory {
    private static readonly providers: Record<string, EmbedProviderConstructor> = {
        'Gemini': GeminiEmbedProvider
    };

    static getAvailableProviders(): string[] {
        return Object.keys(this.providers);
    }

    static create(providerName: string, apiKey: string): EmbedProvider {
        const ProviderClass = this.providers[providerName];

        return new ProviderClass(apiKey);
    }
}