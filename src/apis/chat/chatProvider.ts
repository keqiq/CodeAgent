export type ChatItem =
    | { type: 'message'; role: 'developer' | 'user' | 'assistant'; content: string, turnID?: string, isHidden?: boolean }
    | { type: 'function_call'; id: string; name: string; arguments: any, turnID?: string}
    | { type: 'function_result'; id: string; name: string; result: string, turnID?: string }

export interface ChatResponse {
    items: ChatItem[];
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

export abstract class ChatProvider {
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

    public static formatResponse(text: string, toolCalls: Map<any, any>, turnID?: string): ChatResponse {
        const items: ChatItem[] = [];

        if (text) items.push({ type: 'message', role: 'assistant', content: text });

        for (const call of Array.from(toolCalls.values())) {
            items.push({ 
                type: 'function_call', 
                id: call.id, 
                name: call.name, 
                arguments: call.arguments ? JSON.parse(call.arguments) : {},
                turnID: call.turnID
            });
        }

        return { items, ...(turnID && {turnID}) };
    }
}