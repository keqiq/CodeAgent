export type ChatItem =
    | { type: 'message'; role: 'user' | 'assistant'; content: string, thought?: string, turnID?: string, isHidden?: boolean }
    | { type: 'function_call'; id: string; name: string; arguments: any, turnID?: string}
    | { type: 'function_result'; id: string; name: string; result: string, turnID?: string }
    | { type: 'run_summary'; provider: string, status: 'ok' | 'aborted' | 'error'; tokenUsage?: TokenUsage; message?: string; turnID?: string}

export interface ChatResponse {
    items: ChatItem[];
    tokenUsage: TokenUsage | undefined;
    turnID?: string;
}

export interface StreamYield {
    type: 'text' | 'thought';
    content: string;
}

export interface ModelInfo {
    id: string;
    reason: boolean | undefined;
    efforts: string[];
    defaultEffort: string | null;
}

export interface TokenUsage {
    totalTokens: number | undefined,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    thoughtTokens: number | undefined
}

export abstract class ChatProvider {

    protected static systemPrompt: string = `You are an autonomous, expert software engineering agent integrated into VS Code. 
                      You have access to tools that can search, read, write, and edit files in the user's workspace.
                      When a user asks you to find a bug or fix a problem, DO NOT ask them for the file name if you can search for it yourself. 
                      Proactively use your semantic search tool 'searchCodebase' tool to search the workspace.
                      Tools like 'glob' and 'grep' should be used as a fallback if semantic search fails to return relevant results, or if you need to view files in more detail. 
                      Find the relevant code, read it, and edit it to fix the issue. 
                      Always explain your thought process before executing a tool.`;

    public static stateManagementSupport: boolean = false;

    private static modelCache: Record<string, ModelInfo[]> = {};

    protected abstract featuredModels: string[];

    protected abstract getModelInfos(): Promise<ModelInfo[]>;

    public async getModels(fetchAll?: boolean): Promise<ModelInfo[]> {
        const providerName = this.constructor.name;

        // Fetch and cache models if not already cached for this specific provider
        if (!ChatProvider.modelCache[providerName]) {
            ChatProvider.modelCache[providerName] = await this.getModelInfos();
        }

        const cachedModels = ChatProvider.modelCache[providerName];

        if (fetchAll || this.featuredModels.length === 0) return cachedModels;

        // Filter based on the subclass's featuredModels array
        return cachedModels.filter(info => this.featuredModels.includes(info.id));
    }

    abstract fetchStream(
        model: string, 
        effort: string, 
        history: ChatItem[], 
        previousTurnID: string | undefined,
        useCache: boolean,
        abortSignal: AbortSignal
    ): AsyncGenerator<StreamYield, ChatResponse, unknown>;

    public static formatResponse(
        text: string, 
        toolCalls: Map<any, any>, 
        tokenUsage: TokenUsage, 
        turnID?: string,
        reasoning_content?: string
    ): ChatResponse {
        const items: ChatItem[] = [];

        items.push({
             type: 'message', 
             role: 'assistant', 
             content: text,
             ...(reasoning_content && { reasoning_content: reasoning_content } )
            });

        for (const call of Array.from(toolCalls.values())) {
            items.push({ 
                type: 'function_call', 
                id: call.id, 
                name: call.name, 
                arguments: call.arguments ? JSON.parse(call.arguments) : {},
                turnID: call.turnID
            });
        }

        return { items, tokenUsage, ...(turnID && {turnID}) };
    }
}