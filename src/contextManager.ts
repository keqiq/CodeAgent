import * as vscode from 'vscode';

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

export class ContextManager {
    // Full history for frontend
    private history: ChatItem[] = [];

    private activeToolResults: FunctionResultItem[] = [];

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

    constructor(private readonly context: vscode.ExtensionContext) {
        const savedHistory = context.workspaceState.get<ChatItem[]>('chatHistory');
        if (savedHistory && savedHistory.length > 0) this.history = savedHistory;
        const savedSummarizedHistory = context.workspaceState.get<ChatItem[]>('summarizedHistory');
        if (savedSummarizedHistory && savedSummarizedHistory.length > 0) this.summarizedHistory = savedSummarizedHistory;
        const savedSummarizeIndex = context.workspaceState.get<number>('summarizeIndex');
        if (savedSummarizeIndex) this.summarizeIndex = savedSummarizeIndex;
    }

    public async save(): Promise<void> {
        await Promise.all([
            this.context.workspaceState.update('chatHistory', this.history),
            this.context.workspaceState.update('summarizedHistory', this.summarizedHistory),
            this.context.workspaceState.update('summarizeIndex', this.summarizeIndex)
        ]);
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
            this.runTokenUsage.totalTokens = (this.runTokenUsage.totalTokens || 0) + (usage.totalTokens || 0);
            this.runTokenUsage.inputTokens = (this.runTokenUsage.inputTokens || 0) + (usage.inputTokens || 0);
            this.runTokenUsage.outputTokens = (this.runTokenUsage.outputTokens || 0) + (usage.outputTokens || 0);
            this.runTokenUsage.thoughtTokens = (this.runTokenUsage.thoughtTokens || 0) + (usage.thoughtTokens || 0);
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

    public addFunctionResult(id: string, name: string, result: string, error: boolean): void {
        const item: FunctionResultItem = {
            type: 'function_result',
            id,
            name,
            result,
            error,
            ...(this.activeTurnID && { turnID: this.activeTurnID })
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
        this.resetTokenUsage();
        await this.save();
    }

    public pruneToolResults(): void {
        for (const item of this.activeToolResults) {
            if (item.error) item.result = `[Tool '${item.name}' failed. Original error retained: ${item.result}]`;
            else item.result = `[Tool '${item.name}' executed successfully.]`;
        }
        this.activeToolResults = [];
    }

    public getLLMContext(): ChatItem[] {
        // We return the summarized long term history (if it exists)
        // along with verbatim recent history
        return [
            ...this.summarizedHistory,
            ...this.history.slice(this.summarizeIndex)
        ];
    }
}