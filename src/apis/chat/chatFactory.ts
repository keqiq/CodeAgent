import { ChatProvider, WebSearchMode } from './chatProvider';
import { ClaudeChatProvider } from './claude';
import { DeepSeekChatProvider } from './deepseek';
import { GeminiChatProvider } from "./gemini";
import { KimiChatProvider } from './kimi';
import { OllamaChatProvider } from './ollama';
import { OpenAIChatProvider } from "./openai";

interface ChatProviderConstructor {
    new (apiKey: string, webSearchMode: WebSearchMode): ChatProvider;
    stateManagementSupport: boolean;
    serverWebSearchSupport: boolean;
    systemPrompt: string;
    compactionPrompt: string;
    baseTools: any[];
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
        'Kimi': KimiChatProvider,
        'Ollama': OllamaChatProvider
    };

    static supportsStateManagement(providerName: string): boolean {
        const ProviderClass = this.providers[providerName];
        return ProviderClass.stateManagementSupport;
    }

    static supportsServerWebSearch(providerName: string): boolean {
        const ProviderClass = this.providers[providerName];
        return ProviderClass.serverWebSearchSupport;
    }

    static getSystemPrompt(providerName: string): string {
        const ProviderClass = this.providers[providerName];
        return ProviderClass.systemPrompt;
    }

    static getCompactionPrompt(providerName: string): string {
        const ProviderClass = this.providers[providerName];
        return ProviderClass.compactionPrompt;

    }

    static getToolSchemas(providerName: string): any[] {
        const ProviderClass = this.providers[providerName];
        return ProviderClass.baseTools;
    }

    static getAvailableProviders(): string[] {
        return Object.keys(this.providers);
    }

    static create(providerName: string, apiKey: string, webSearchMode: WebSearchMode): ChatProvider {
        const ProviderClass = this.providers[providerName];

        return new (ProviderClass as any)(apiKey, webSearchMode);
    }
}