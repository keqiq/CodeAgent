import { ChatProvider } from './chatProvider';
import { DeepSeekChatProvider } from './deepseek';
import { GeminiChatProvider } from "./gemini";
import { OpenAIChatProvider } from "./openai";

type ChatProviderConstructor = new (apiKey: string) => ChatProvider;

export class ChatFactory {

    private static readonly providers: Record<string, ChatProviderConstructor> = {
        'OpenAI': OpenAIChatProvider,
        'Gemini': GeminiChatProvider,
        'DeepSeek': DeepSeekChatProvider
    };

    static getAvailableProviders(): string[] {
        return Object.keys(this.providers);
    }

    static create(providerName: string, apiKey: string): ChatProvider {
        const ProviderClass = this.providers[providerName];

        return new ProviderClass(apiKey);
    }
}