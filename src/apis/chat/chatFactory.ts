import { ChatProvider } from './chatProvider';
import { GeminiChatProvider } from "./gemini";
import { OpenAIChatProvider } from "./openai";

export class ChatFactory {
    static create(providerName: string, apiKey: string): ChatProvider {
        switch(providerName.toLowerCase()) {
            case 'openai': return new OpenAIChatProvider(apiKey);
            case 'gemini': return new GeminiChatProvider(apiKey);

            default: throw new Error(`Unsupported api: ${providerName}`);
        }
    }
}