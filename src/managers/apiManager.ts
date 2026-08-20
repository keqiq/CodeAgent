import * as vscode from 'vscode';
import { ChatFactory } from '../apis/chat/chatFactory';
import { EmbedFactory } from '../apis/embed/embedFactory';
import { tavily } from '@tavily/core';
import { ModelInfo } from '../apis/chat/chatProvider';

export class APIManager {
    private chatModelInfo: Map<string, ModelInfo> = new Map();
    private emitter = new vscode.EventEmitter();
    public readonly onDidUpdateStatus = this.emitter.event;
    
    constructor(private context: vscode.ExtensionContext) {};
    
    public async getChatAPIKey(provider: string): Promise<string> {
        if (provider.toLowerCase() === 'ollama') {
            const port = this.context.globalState.get<number | string>('ollamaChatPort') ?? 11434;
            return String(port);
        }
        const chatSecretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
        let chatAPIKey = await this.context.secrets.get(chatSecretKey);

        // Fallback to embed api key if embed is not found
        if (!chatAPIKey) {
            const embedSecretKey = `${provider.toUpperCase()}_EMBED_API_KEY`;
            chatAPIKey = await this.context.secrets.get(embedSecretKey);
        }

        // if we have neither chat nor embed apikey, request chat key
        if (!chatAPIKey) {
            this.emitter.fire({ type: 'requestChatAPIKey', provider: provider });
            throw new Error(`Missing ${provider} API key`);
        }
        return chatAPIKey;
    }

    public async getEmbedAPIKey(provider: string): Promise<string> {
        if (provider.toLowerCase() === 'ollama') {
            const port = this.context.globalState.get<number | string>('ollamaEmbedPort') ?? 11434;
            return String(port);
        }

        const embedSecretKey = `${provider.toUpperCase()}_EMBED_API_KEY`;
        let embedAPIKey = await this.context.secrets.get(embedSecretKey);

        // Fallback to chat api key if embed is not found
        if (!embedAPIKey) {
            const chatSecretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
            embedAPIKey = await this.context.secrets.get(chatSecretKey);
        }

        // if we have neither chat nor embed apikey, request embedding key
        if (!embedAPIKey) {
            this.emitter.fire({ type: 'requestEmbedAPIKey', provider: provider });
            throw new Error(`Missing ${provider} API key`);
        }
        return embedAPIKey;
    }

    public async verifyTavilyAPIKey(apiKey: string | undefined) {
        if (!apiKey) throw new Error('Tavily API key not configured!');
        const client = tavily({ apiKey: apiKey });
        await client.search("ping", { maxResults: 1 }); // this is wasting a call... but how else can i check the key is valid
    }

    public async getChatModels(provider: string) {
        try {
            this.emitter.fire({ type: 'setChatModelsLoading', provider: provider });

            const apiKey = await this.getChatAPIKey(provider);

            const fetchAll = this.context.globalState.get<boolean>('showAllChatModels') ?? false;
            const providerInstance = ChatFactory.create(provider, apiKey, 'none');
            const infos = await providerInstance.getModels(fetchAll);

            this.chatModelInfo.clear();
            infos.forEach((info: ModelInfo) => this.chatModelInfo.set(info.id, info));

            this.emitter.fire({ type: 'setChatModels', models: infos.map((info: ModelInfo) => info.id) });

            const chatModel = this.context.globalState.get<string>(`${provider}_chatModel`);
            const isValidModel = infos.some((info: ModelInfo) => info.id === chatModel);

            this.emitter.fire({ type: 'updateChatModel', model: isValidModel ? chatModel : undefined });

        } catch (e) {
            vscode.window.showErrorMessage(`Failed to fetch chat models: ${e}`);
            this.emitter.fire({ type: 'requestChatAPIKey', provider: provider });
        }
    }

    public async getEmbedModels(provider: string): Promise<void> {
        try {
            this.emitter.fire({ type: 'setEmbedModelsLoading', provider: provider });

            const apiKey = await this.getEmbedAPIKey(provider);
            const providerInstance = EmbedFactory.create(provider, apiKey);
            const models = await providerInstance.getModels();

            this.emitter.fire({ type: 'setEmbedModels', models });

            const savedModel = this.context.globalState.get<string>(`${provider}_embedModel`);
            const isValidModel = models.includes(savedModel as any);

            this.emitter.fire({ type: 'updateEmbedModel', model: isValidModel ? savedModel : undefined });

        } catch (e) {
            vscode.window.showErrorMessage(`Failed to fetch embed models: ${e}`);
            this.emitter.fire({ type: 'requestEmbedAPIKey', provider: provider });
        }
    }

    public getChatModelInfo(model: string): void {
         const info = this.chatModelInfo.get(model);
        if (info) {
            const chatProvider = this.context.globalState.get<string>('chatProvider');
            const savedEffort = this.context.globalState.get<string>(`${chatProvider}_${model}_Effort`);
            this.emitter.fire({
                type: 'updateChatModelInfo',
                reason: info.reason,
                efforts: info.efforts,
                defaultEffort: savedEffort ? savedEffort : info.defaultEffort,
                contextWindow: info.contextWindow
            });
        }
    }

    public async saveChatProvider(provider: string): Promise<void> {
        await this.context.globalState.update('chatProvider', provider);

        const serverStateManagement = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
        this.emitter.fire({ type: 'restoreChatSettings', stateful: serverStateManagement });
        const stateManagementSupport = ChatFactory.supportsStateManagement(provider);
        const serverWebSearchSupport = ChatFactory.supportsServerWebSearch(provider);
        this.emitter.fire({
            type: 'updateChatProvider',
            provider: provider,
            stateful: stateManagementSupport,
            serverSearch: serverWebSearchSupport
        });
    }

    public async saveEmbedProvider(provider: string): Promise<void> {
        await this.context.globalState.update('embedProvider', provider);
        this.emitter.fire({ type: 'updateEmbedProvider', provider: provider });
    }

    public async saveChatModel(provider: string, model: string): Promise<void> {
        await this.context.globalState.update(`${provider}_chatModel`, model);
        this.emitter.fire({ type: 'updateChatModel', model: model });
    }

    public async saveEmbedModel(provider: string, model: string): Promise<void> {
        await this.context.globalState.update(`${provider}_embedModel`, model);
        this.emitter.fire({ type: 'updateEmbedModel', model: model });
    }

    public async saveChatAPIKey(provider: string, key: string): Promise<void> {
        if (provider.toLowerCase() === 'ollama') {
             const port = parseInt(key, 10) || 11434;
            await this.context.globalState.update('ollamaChatPort', port);
            return;
        }
        const secretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
        await this.context.secrets.store(secretKey, key);
    }

    public async saveEmbedAPIKey(provider: string, key: string): Promise<void> {
        if (provider.toLowerCase() === 'ollama') {
            const port = parseInt(key, 10) || 11434;
            await this.context.globalState.update('ollamaEmbedPort', port);
            return;
        }

        const secretKey = `${provider.toUpperCase()}_EMBED_API_KEY`;
        await this.context.secrets.store(secretKey, key);
    }

    public async saveTavilyAPIKey(key: string): Promise<void> {
        try {
            await this.verifyTavilyAPIKey(key);
            await this.context.secrets.store('TAVILY_API_KEY', key);
        } catch (e) {
            vscode.window.showErrorMessage('Invalid Tavily API key');
            this.emitter.fire({ type: 'requestTavilyAPIKey' });
        }
    }
}