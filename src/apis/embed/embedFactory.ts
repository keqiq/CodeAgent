import { EmbedProvider } from "./embedProvider";
import { GeminiEmbedProvider } from "./gemini";

export class EmbedFactory {
    static create(providerName: string, apiKey: string): EmbedProvider {
        switch(providerName.toLowerCase()) {
            case 'gemini': return new GeminiEmbedProvider(apiKey);

            default: throw new Error(`Unsupported api: ${providerName}`);
        }
    }
}