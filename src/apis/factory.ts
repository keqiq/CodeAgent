import { LLMProvider } from './provider';
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";

export class LLMFactory {
    static create(providerName: string, apiKey: string): LLMProvider {
        switch(providerName.toLowerCase()) {
            case 'openai': return new OpenAIProvider(apiKey);
            case 'gemini': return new GeminiProvider(apiKey);

            default: throw new Error(`Unsupported api: ${providerName}`)
        }
    }
}