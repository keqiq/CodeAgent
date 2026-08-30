import * as vscode from 'vscode';
import { tavily } from '@tavily/core';
import { ChatFactory } from '../apis/chat/chatFactory';
import { EmbedFactory } from '../apis/embed/embedFactory';
import { ModelInfo } from '../apis/chat/chatProvider';

export class APIManager {
    private chatModelInfo: Map<string, Map<string, ModelInfo>> = new Map();
    private providerModelConfig: Record<string, string> = {};
    private modelEffortConfig: Record<string, string> = {};
    private emitter = new vscode.EventEmitter();
    public readonly onDidUpdateStatus = this.emitter.event;
    
    constructor(private context: vscode.ExtensionContext) {
        this.providerModelConfig = this.context.globalState.get<Record<string, string>>('providerModelConfig') || {};
        this.modelEffortConfig = this.context.globalState.get<Record<string, string>>('modelEffortConfig') || {};
    };

    //-------------------------------------------------------------------------------------------
    // API keys
    //-------------------------------------------------------------------------------------------
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
            throw new Error(`Missing ${provider} API key!`);
        }
        return embedAPIKey;
    }

    public async saveChatAPIKey(provider: string, key: string, sessionID: string): Promise<void> {
        if (provider.toLowerCase() === 'ollama') {
             const port = parseInt(key, 10) || 11434;
            await this.context.globalState.update('ollamaChatPort', port);
            return;
        }
        const secretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
        await this.context.secrets.store(secretKey, key);

        await this.verifyChatAPIKey(provider, key, sessionID);
    }

    public async verifyChatAPIKey(provider: string, key: string, sessionID: string): Promise<void> {
        try {
            const providerInstance = ChatFactory.create(provider, key, 'none');
            await providerInstance.verifyKey();
        } catch (e) {
            // Block prompting
            this.emitter.fire({ 
                type: 'setChatModelsLoading', 
                sessionID: sessionID,
                provider: provider
            });

            this.emitter.fire({
                type: 'requestChatAPIKey',
                sessionID: sessionID,
                provider: provider
            });

            throw new Error(`Invalid ${provider} API key!`);
        }
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

    public async saveTavilyAPIKey(key: string, sessionID: string): Promise<void> {
        await this.context.secrets.store('TAVILY_API_KEY', key);
        await this.verifyTavilyAPIKey(sessionID);
    }

    public async verifyTavilyAPIKey(sessionID: string) {
        try {
            const apiKey = await this.context.secrets.get('TAVILY_API_KEY');
            if (!apiKey) throw new Error('Tavily API key not configured!');
            const client = tavily({ apiKey: apiKey });
            await client.search("ping", { maxResults: 1 }); // this is wasting a call... but how else can i check the key is valid
        } catch (e) {
            vscode.window.showErrorMessage('Invalid Tavily API key');
            this.emitter.fire({ type: 'requestTavilyAPIKey', sessionID: sessionID });
        }
    }


    //-------------------------------------------------------------------------------------------
    // Fetch from configuration
    //-------------------------------------------------------------------------------------------
    public async getChatModels(provider: string, model: string | undefined, fetchAll: boolean, sessionID: string) {
        try {
            this.emitter.fire({ 
                type: 'setChatModelsLoading', 
                sessionID: sessionID,
                provider: provider
            });

            const apiKey = await this.getChatAPIKey(provider);

            const providerInstance = ChatFactory.create(provider, apiKey, 'none');
            const infos = await providerInstance.getModels(fetchAll);

            // Get or initialize provider cache
            let providerModelInfo = this.chatModelInfo.get(provider);
            if (!providerModelInfo) {
                providerModelInfo = new Map<string, ModelInfo>();
                this.chatModelInfo.set(provider, providerModelInfo);
            }

            // Merge entries if new models were fetched or cache is smaller
            if (infos.length > providerModelInfo.size || !providerModelInfo.size) {
                infos.forEach((info: ModelInfo) => providerModelInfo!.set(info.id, info));
            }

            // Fill the frontend model dropdown
            this.emitter.fire({ 
                type: 'setChatModels',
                sessionID: sessionID, 
                models: infos.map((info: ModelInfo) => info.id) 
            });

            // If we pass in a stored model, set the value of the dropdown
            const isValidModel = infos.some((info: ModelInfo) => info.id === model);

            this.emitter.fire({ 
                type: 'updateChatModel', 
                sessionID: sessionID,
                model: isValidModel ? model : undefined });

        } catch (e) {
            vscode.window.showErrorMessage(`Failed to fetch chat models: ${e}`);
            this.emitter.fire({ 
                type: 'requestChatAPIKey',
                sessionID: sessionID,
                provider: provider 
            });
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

    public getChatModelInfo(provider: string, model: string, effort: string | undefined, sessionID: string): void {
        const info = this.chatModelInfo.get(provider)?.get(model);
        if (info) {
            this.emitter.fire({
                type: 'updateChatModelInfo',
                sessionID: sessionID,
                reason: info.reason,
                efforts: info.efforts,
                defaultEffort: effort ? effort : info.defaultEffort,
                contextWindow: info.contextWindow
            });
        }
    }

    //-------------------------------------------------------------------------------------------
    // Session chat API configuration
    //-------------------------------------------------------------------------------------------
    public async saveChatProvider(provider: string, sessionID: string): Promise<void> {
        await this.context.globalState.update('chatProvider', provider);

        const serverStateManagement = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
        this.emitter.fire({ type: 'restoreChatSettings', stateful: serverStateManagement });
        const stateManagementSupport = ChatFactory.supportsStateManagement(provider);
        const serverWebSearchSupport = ChatFactory.supportsServerWebSearch(provider);
        this.emitter.fire({
            type: 'updateChatProvider',
            sessionID: sessionID,
            provider: provider,
            stateful: stateManagementSupport,
            serverSearch: serverWebSearchSupport
        });
    }

    public async saveChatModel(provider: string, model: string, sessionID: string): Promise<void> {
        this.providerModelConfig[provider] = model;
        await this.context.globalState.update('providerModelConfig', this.providerModelConfig);
        this.emitter.fire({ 
            type: 'updateChatModel',
            sessionID: sessionID,
            model: model 
        });
    }

    public async saveChatModelEffort(model: string, effort: string, sessionID: string): Promise<void> {
        this.modelEffortConfig[model] = effort;
        await this.context.globalState.update('modelEffortConfig', this.modelEffortConfig);
    }

    //-------------------------------------------------------------------------------------------
    // Global embedding API configuration
    //-------------------------------------------------------------------------------------------
    public async saveEmbedProvider(provider: string): Promise<void> {
        await this.context.globalState.update('embedProvider', provider);
        this.emitter.fire({ type: 'updateEmbedProvider', provider: provider });
    }

    public async saveEmbedModel(provider: string, model: string): Promise<void> {
        await this.context.globalState.update(`${provider}_embedModel`, model);
        this.emitter.fire({ type: 'updateEmbedModel', model: model });
    }

}