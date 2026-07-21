import { ChatProvider } from './chatProvider';
import { ClaudeChatProvider } from './claude';
import { DeepSeekChatProvider } from './deepseek';
import { GeminiChatProvider } from "./gemini";
import { KimiChatProvider } from './kimi';
import { OpenAIChatProvider } from "./openai";

interface ChatProviderConstructor {
    new (apiKey: string): ChatProvider;
    stateManagementSupport: boolean;
}

export class ChatFactory {

    static register(providerName: string, providerClass: ChatProviderConstructor): void {
        this.providers[providerName] = providerClass;
    }

    private static readonly providers: Record<string, ChatProviderConstructor> = {
        'OpenAI': OpenAIChatProvider,
        'Gemini': GeminiChatProvider,
        'Claude': ClaudeChatProvider,
        'DeepSeek': DeepSeekChatProvider,
        'Kimi': KimiChatProvider
    };

    static supportsStateManagement(providerName: string): boolean {
        const ProviderClass = this.providers[providerName];
        return ProviderClass.stateManagementSupport;
    }

    static getAvailableProviders(): string[] {
        return Object.keys(this.providers);
    }

    static create(providerName: string, apiKey: string): ChatProvider {
        const ProviderClass = this.providers[providerName];

        return new (ProviderClass as any)(apiKey);
    }
}