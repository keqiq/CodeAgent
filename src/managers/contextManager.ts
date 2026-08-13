import * as vscode from 'vscode';
import { getEncoding } from 'js-tiktoken';
import { ChatFactory } from '../apis/chat/chatFactory';
import { PRUNE_TOOLS } from '../tools/toolIndex';

export interface MessageItem {
    type: 'message';
    role: 'user' | 'assistant';
    content: string;
    thought?: string;
    turnID?: string;
    isHidden?: boolean;
}

export interface FunctionCallItem {
    type: 'function_call';
    id: string;
    name: string;
    arguments: any;
    turnID?: string;
    server?: boolean;
}

export interface FunctionResultItem {
    type: 'function_result';
    id: string;
    name: string;
    result: string;
    error: boolean;
    turnID?: string;
    data?:any;
}

export interface RunSummaryItem {
    type: 'run_summary';
    provider: string;
    status: 'ok' | 'aborted' | 'error';
    tokenUsage?: TokenUsage;
    message?: string;
    turnID?: string;
}

export type ChatItem = MessageItem | FunctionCallItem | FunctionResultItem | RunSummaryItem

export interface ChatResponse {
    items: ChatItem[];
    tokenUsage: TokenUsage | undefined;
    turnID?: string;
}

export interface TokenUsage {
    totalTokens: number | undefined,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    thoughtTokens: number | undefined
}

export interface TokenCategoryUsage {
    userTokens: number;
    assistantTokens: number;
    systemTokens: number;
    toolCallTokens: number;
    toolResultTokens: number;
    totalTokens: number;
}

interface ChatState {
    history: ChatItem[];
    summarizedHistory: ChatItem[];
    summarizeIndex: number;
}

export class ContextManager {
    private isInitialized: boolean = false;

    // Full history for frontend
    private history: ChatItem[] = [];

    private activeToolResults: FunctionResultItem[] = [];
    private turnsSinceLastPrune: number = 0;
    private runsSinceLastPrune: number = 0;

    private summarizedHistory: ChatItem[] = [];
    private summarizeIndex = 0;

    private activeTurnID: string | undefined = undefined;
    private activeProvider: string = '';

    // For roll back
    private previousTurnID: string | undefined = undefined;
    private previousProvider: string = '';

    private runTokenUsage: TokenUsage = {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        thoughtTokens: 0
    };

    private storageUri: vscode.Uri | undefined;
    private artifactsUri: vscode.Uri | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.storageUri = context.storageUri;
        if (this.storageUri) this.artifactsUri = vscode.Uri.joinPath(this.storageUri, 'artifacts');
    }

    public async initialize(): Promise<void> {
        if (!this.storageUri || this.isInitialized) return;
        try {
            await vscode.workspace.fs.createDirectory(this.storageUri);
            if (this.artifactsUri) await vscode.workspace.fs.createDirectory(this.artifactsUri);
        } catch (e) {
            console.error('Failed to create context directory');
        }

        await this.loadHistory();

        this.isInitialized = true;
    }

    public async loadHistory(): Promise<void> {
        if (!this.storageUri) return;

        const fileUri = vscode.Uri.joinPath(this.storageUri, 'chat_history.json');

        try {
            const data = await vscode.workspace.fs.readFile(fileUri);
            const state = JSON.parse(new TextDecoder().decode(data)) as ChatState;

            if (state.history) this.history = state.history;
            if (state.summarizedHistory) this.summarizedHistory = state.summarizedHistory;
            if (state.summarizeIndex) this.summarizeIndex = state.summarizeIndex;
        } catch (e) {
            console.log('No existing chat history found');
        }
    }

    public async save(): Promise<void> {
        if (!this.storageUri) return;
    
        const state: ChatState = {
            history: this.history,
            summarizedHistory: this.summarizedHistory,
            summarizeIndex: this.summarizeIndex
        };

        const fileUri = vscode.Uri.joinPath(this.storageUri, 'chat_history.json');
        const data = new TextEncoder().encode(JSON.stringify(state, null, 2));
        
        await vscode.workspace.fs.writeFile(fileUri, data);
    }

    public getHistory(): ChatItem[] {
        return [...this.history];
    }

    public getTurnID(): string | undefined {
        return this.activeTurnID;
    }

    public setTurnID(turnID: string | undefined): void {
        this.activeTurnID = turnID;
    }

    public prepareRun(provider: string, serverStateful: boolean): void {
        this.resetTokenUsage();

        // Save previous state
        this.previousTurnID = this.activeTurnID;
        this.previousProvider = this.activeProvider;

        // If the provider changed or stateful is disabled, reset turn id
        if (this.activeProvider !== provider || !serverStateful) this.activeTurnID = undefined;
        this.activeProvider = provider;
    }
    
    // Extract all function calls for the agent loop
    // Save all messages and function calls expect for server function calls
    public processResponseItems(items: ChatItem[]): FunctionCallItem[] {
        if (!items || items.length === 0) return [];

        const functionCalls: FunctionCallItem[] = [];

        for (const item of items) {

            if (item.type === 'function_call') {
                functionCalls.push(item);

                // DO NOT SAVE SERVER FUNCTION CALLS
                if (!item.server) this.addFunctionCall(item.id, item.name, item.arguments);
            }
            else if (item.type === 'message') this.addAssistantMessage(item.content);
        }
        
        return functionCalls;
    }

    public rollback(): void {
        this.activeTurnID = this.previousTurnID;
        this.activeProvider = this.previousProvider;
    }

    private resetTokenUsage(): void {
        this.runTokenUsage = {
            totalTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            thoughtTokens: 0
        };
    }

    public recordTokenUsage(provider: string, usage: TokenUsage): TokenUsage {
        if (provider.toLowerCase() === 'claude') {
            // Claude returns cumulative token usage across turns
            this.runTokenUsage = {
                totalTokens: usage.totalTokens || 0,
                inputTokens: usage.inputTokens || 0,
                outputTokens: usage.outputTokens || 0,
                thoughtTokens: usage.thoughtTokens || 0
            };
        } else {
            // Other providers return incremental per-turn usage that must be accumulated
            this.runTokenUsage.totalTokens! += (usage.totalTokens || 0);
            this.runTokenUsage.inputTokens! += (usage.inputTokens || 0);
            this.runTokenUsage.outputTokens! += (usage.outputTokens || 0);
            this.runTokenUsage.thoughtTokens! += (usage.thoughtTokens || 0);
        }
        return { ...this.runTokenUsage };
    }

    public getTokenUsage(): TokenUsage {
        return { ...this.runTokenUsage };
    }

    public addUserMessage(content: string): void {
        this.history.push({
            type: 'message',
            role: 'user',
            content,
            ...(this.activeTurnID && { turnID: this.activeTurnID })
        });
    }

    public addAssistantMessage(content: string, thought?: string): void {
        this.history.push({
            type: 'message',
            role: 'assistant',
            content,
            ...(thought && { thought }),
            ...(this.activeTurnID && { turnID: this.activeTurnID })
        });
    }

    public addSystemMessage(content: string): void {
        this.history.push({
            type: 'message',
            role: 'user',
            content: `[System: ${content}]`,
            ...(this.activeTurnID && { turnID: this.activeTurnID }),
            isHidden: true
        });
    }

    public addFunctionCall(id: string, name: string, args: any): void {
        this.history.push({
            type: 'function_call',
            id,
            name,
            arguments: args,
            ...(this.activeTurnID && { turnID: this.activeTurnID })
        });
    }

    public addFunctionResult(id: string, name: string, result: string, error: boolean, data?: any): void {
        const item: FunctionResultItem = {
            type: 'function_result',
            id,
            name,
            result,
            error,
            ...(this.activeTurnID && { turnID: this.activeTurnID }),
            ...(data && { data })
        };
        this.history.push(item);
        this.activeToolResults.push(item);
    }

    public addRunSummary(provider: string, status: 'ok' | 'aborted' | 'error', message?: string): void {
        this.history.push({
            type: 'run_summary',
            provider,
            status,
            ...(message && { message }), 
            ...(this.runTokenUsage && { tokenUsage: { ...this.runTokenUsage } }),
            ...(this.activeTurnID && { turnID: this.activeTurnID })
        });
    }

    public async clear(): Promise<void> {
        this.history = [];
        this.summarizedHistory = [];
        this.summarizeIndex = 0;
        this.activeToolResults = [];
        this.activeTurnID = undefined;
        this.previousTurnID = undefined;
        this.activeProvider = '';
        this.previousProvider = '';
        this.turnsSinceLastPrune = 0;
        this.runsSinceLastPrune = 0;
        this.resetTokenUsage();
        await this.save();
        await this.clearArtifacts();
    }

    public async updateTurnBoundary(mode: string, interval: number, previousTurnHadError: boolean): Promise<void> {
        this.turnsSinceLastPrune++;

        // If previous tool results contain errors, keep tool results for debug context
        if (previousTurnHadError) return;

        if (mode === 'turn' && this.turnsSinceLastPrune >= interval) {
            await this.pruneToolResults();
        }
    }

    public async updateRunBoundary(mode: string, interval: number): Promise<void> {
        this.runsSinceLastPrune++;

        if (mode === 'run' && this.runsSinceLastPrune >= interval) {
            await this.pruneToolResults();
        }
    }

    public async readArtifact(artifactID: string): Promise<string> {
        if (!this.artifactsUri) throw new Error('Artifact storage not initialized');

        const fileUri = vscode.Uri.joinPath(this.artifactsUri, artifactID);
        
        const data = await vscode.workspace.fs.readFile(fileUri);
        return new TextDecoder().decode(data);
    }

    // Save tool results to disk, return id
    public async saveArtifact(item: FunctionResultItem): Promise<string> {
        if (!this.artifactsUri) return 'artifact_storage_disabled';

        const artifactID = `artifact_${item.name}_${item.id}_${Date.now()}.txt`;
        const fileUri = vscode.Uri.joinPath(this.artifactsUri, artifactID);

        const data = new TextEncoder().encode(item.result);
        await vscode.workspace.fs.writeFile(fileUri, data);

        return artifactID;
    }

    public async pruneToolResults(): Promise<void> {
        if (this.activeToolResults.length === 0) return;

        for (const item of this.activeToolResults) {

            // For calls to fetch artifacts, we should point to the original artifact
            const isRecall = item.name === 'recall';

            const shouldPrune = isRecall || PRUNE_TOOLS.has(item.name) || item.result.length > 300 || item.error;

            if (!shouldPrune) continue;

            let artifactID: string;
            if (isRecall) artifactID = item.data?.artifactID || 'unknown_artifact';
            else artifactID = await this.saveArtifact(item);

            if (item.error) {
                item.result = `[Tool '${item.name}' failed. Full error stored in artifact: ${artifactID}]`;
            } else {
                item.result = `[Tool '${item.name}' executed successfully. Full output stored in artifact: ${artifactID}]`;
            }
        }

        this.activeToolResults = [];
        this.turnsSinceLastPrune = 0;
        this.runsSinceLastPrune = 0;
    }

    private async clearArtifacts(): Promise<void> {
        if (!this.artifactsUri) return;

        try {
            await vscode.workspace.fs.delete(this.artifactsUri, { recursive: true, useTrash: false });
            await vscode.workspace.fs.createDirectory(this.artifactsUri);
        } catch (e) {
            console.error('Failed to clear artifacts directory:', e);
        }
        
    }

    public getLLMContext(): ChatItem[] {
        // We return the summarized long term history (if it exists)
        // along with verbatim recent history
        return [
            ...this.summarizedHistory,
            ...this.history.slice(this.summarizeIndex)
        ];
    }

    public estimateCategorizedTokens(provider: string): TokenCategoryUsage {
        const encoder = getEncoding('o200k_base');

        const usage: TokenCategoryUsage = {
            userTokens: 0,
            assistantTokens: 0,
            systemTokens: 0,
            toolCallTokens: 0,
            toolResultTokens: 0,
            totalTokens: 0
        };
        
        const baseOverhead = 4;
        
        usage.systemTokens += encoder.encode(ChatFactory.getSystemPrompt(provider)).length + baseOverhead;

        usage.systemTokens += encoder.encode(JSON.stringify(ChatFactory.getToolSchemas(provider))).length + baseOverhead;
        
        const currentContext = this.getLLMContext();
        for (const item of currentContext) {
            let textToEncode = "";

            switch (item.type) {
                case 'message':
                    textToEncode = item.content;
                    if (item.thought) textToEncode += item.thought;

                    const messageTokens = encoder.encode(textToEncode).length + baseOverhead;

                    if (item.role === 'user') usage.userTokens += messageTokens;
                    else if (item.role === 'assistant') usage.assistantTokens += messageTokens;
                    break;

                case 'function_call':
                    textToEncode = item.name + JSON.stringify(item.arguments);
                    usage.toolCallTokens += encoder.encode(textToEncode).length + baseOverhead;
                    break;

                case 'function_result':
                    textToEncode = item.name + item.result;
                    usage.toolResultTokens += encoder.encode(textToEncode).length + baseOverhead;
                    break;

                case 'run_summary':
                    break;
            }   
        }

        usage.totalTokens = usage.userTokens + usage.assistantTokens + usage.systemTokens + usage.toolCallTokens + usage.toolResultTokens;

        return usage;
    }
}