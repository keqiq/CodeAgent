import { GoogleGenAI } from '@google/genai';
import { ChatProvider, ModelInfo, StreamYield, WebSearchMode } from './chatProvider';
import { requiredSchemas, ToolSchema, webSchema } from '../../tools/toolIndex';
import { ChatItem, ChatResponse, TokenUsage } from '../../managers/contextManager';

export class GeminiChatProvider extends ChatProvider {
    public static stateManagementSupport: boolean = true;
    public static serverWebSearchSupport: boolean = true;
    public static summaryModel: string = 'gemini-3.5-flash-lite';
    private client: GoogleGenAI;
    // private static geminiTools: any = requiredSchemas;
    private activeInteractionId: string | null = null;

    protected featuredModels: string[] = [
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash', 'gemini-3.5-flash-lite',
        'gemini-3.1-pro', 'gemini-3.1-flash-lite'
    ];

    constructor(apiKey: string, webSearchMode: WebSearchMode) {
        super();
        this.client = new GoogleGenAI({ apiKey: apiKey });
        
        const runTools: any[] = [...GeminiChatProvider.baseTools];
        if (webSearchMode === 'tavily') runTools.push(...webSchema);
        else if (webSearchMode === 'server') runTools.push({ "type": "google_search" });

        this.tools = runTools;
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        const infos: ModelInfo[] = [];
        const response = await this.client.models.list();
        const exclusionKeywords = [
            'antigravity', 'research', 'computer', 'image',
            'tts', 'omni', 'robotics', 'lyria', 'banana',
            'veo', 'imagen', 'live', 'translate'
        ];

        for await (const m of response) {
            const chatCapable = Array.isArray(m.supportedActions) && m.supportedActions.includes('generateContent');
            
            if (m.name && chatCapable) {
                const id = m.name.replace('models/', '');
                const exluded = exclusionKeywords.some(keyword => id.includes(keyword));
                if (exluded) continue;
                const reasonCapable = m.thinking;
                
                // Exception for 3.1-pro models
                let effortLevels: string[];
                let defaultEffort = 'medium';
                if (id.includes('gemini-3.1-pro')) effortLevels = ['low', 'medium', 'high'];

                // On their docs it says medium is supported but thats not true at the time of writing
                // Only low and high are supported for the newest model
                else if (id.includes('gemini-3.5-flash-lite') || id.includes('gemini-3.6-flash')) {
                    effortLevels = ['low', 'high'];
                    defaultEffort = 'low';
                }
                else effortLevels = ['minimal', 'low', 'medium', 'high'];

                // const effortLevels = id.includes('gemini-3.1-pro') ? ['low', 'medium', 'high'] : ['minimal', 'low', 'medium', 'high'];
                infos.push({
                    id: id,
                    reason: reasonCapable,
                    efforts: reasonCapable ? effortLevels: [],
                    defaultEffort: reasonCapable ? defaultEffort : null,
                    ...(m.inputTokenLimit && { contextWindow: m.inputTokenLimit })
                });
            }
        }
        return infos;
    }

    // Not needed for Interactions api
    // private parseTools() {}

    private formatMessages(items: ChatItem[]): any[] {
        const formatted: any[] = [];
        for (const item of items) {

            if (item.type === 'message') {
                formatted.push({ 
                    type: item.role === 'user' ? 'user_input' : 'model_output',
                    content: [{ type: "text", text: item.content }]
                });
            } else if (item.type === 'function_call') {
                formatted.push({ 
                    type: "function_call", 
                    id: item.id, 
                    name: item.name, 
                    arguments: typeof item.arguments === "string" 
                        ? (item.arguments ? JSON.parse(item.arguments) : {}) 
                        : (item.arguments || {})
                });
            } else if (item.type === 'function_result') {
                const rawOutput = typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
                const contentText = item.turnReminder ? `${rawOutput}\n\n${item.turnReminder}` : rawOutput;

                formatted.push({ 
                    type: "function_result", 
                    call_id: item.id, 
                    name: item.name || "", 
                    result: [{ 
                        type: "text", 
                        text: JSON.stringify({ response: contentText })
                    }] 
                });
            }
        }
        return formatted;
    }

    async *fetchStream(
        model: string, 
        effort: string, 
        history: ChatItem[], 
        previousTurnID: string | undefined,
        useCache: boolean,
        abortSignal: AbortSignal,
        disableTools: boolean,
    ): AsyncGenerator<StreamYield, ChatResponse, unknown> {
        
        let fullText = '';

        const stream = await this.client.interactions.create({
            model: model,
            input: this.formatMessages(history),
            tools: disableTools ? undefined : this.tools,
            system_instruction: GeminiChatProvider.systemPrompt,
            stream: true,
            store: useCache && previousTurnID !== undefined,
            generation_config: {thinking_level: effort as any, thinking_summaries: 'auto'},
            ...(previousTurnID && { previous_interaction_id: previousTurnID })
        }, { signal: abortSignal });

        const currentCalls = new Map();

        let tokenUsage: TokenUsage | undefined = undefined;
        
        for await (const event of stream) {
            if (abortSignal?.aborted) throw new Error('AbortError');

            const evType = event.event_type;

            // Gemini's streaming with tool calls needs multi turn conversation implementation
            // Grab the current call's interaction id which we will need to keep track of for the next turn
            if (evType === 'interaction.created') {
                this.activeInteractionId = event.interaction.id;
            }

            else if (evType === 'step.start') {
                if (event.step.type === 'function_call') {
                    currentCalls.set(event.index, {
                        id: event.step.id,
                        name: event.step.name,
                        arguments: ''
                    });
                    if (event.step.name) yield { type: 'tool', content: event.step.name };
                }

                // Untested, google wants 20 CAD minimum credit deposit to use this
                else if (event.step.type === 'google_search_call') {
                    const queryArr = event.step.arguments?.queries;
                    const query = (Array.isArray(queryArr) && queryArr.length > 0) 
                        ? queryArr[0] 
                        : 'Executing Google Search...';

                    currentCalls.set(event.index, {
                        id: event.step.id,
                        name: event.step.type,
                        arguments: query,
                        server: true
                    });

                    yield {
                        type: 'server_action',
                        content: 'Searching the web...',
                        actionId: event.step.id,
                        actionName: 'web',
                        actionQuery: query
                    };
                }
            }

            else if (evType === 'step.delta') {
                if (event.delta.type === 'arguments_delta') {
                    if (currentCalls.has(event.index)) {
                        currentCalls.get(event.index).arguments += event.delta.arguments;
                    }
                    if (event.delta.arguments) yield { type: 'tool', content: event.delta.arguments };
                }
                
                else if (event.delta.type === 'text') {
                    fullText += event.delta.text;
                    yield { type: 'text', content: event.delta.text };
                }

                else if (event.delta.type === 'thought_summary') {
                    // SHUT UP COMPILER
                    const deltaAny = event.delta as any;
                    const summaryText = deltaAny.content?.text || "";
                    if(summaryText) yield { type: 'thought', content: summaryText };
                }
            }

            else if (evType === 'interaction.completed') {
                const usage = event.interaction.usage;
                if (usage) {
                    tokenUsage = {
                        totalTokens: usage.total_tokens,
                        inputTokens: usage.total_input_tokens,
                        outputTokens: usage.total_output_tokens,
                        thoughtTokens: usage.total_thought_tokens
                    };
                }
            }
        }

        if (currentCalls.size > 0 || fullText.length > 0) {
            return ChatProvider.formatResponse(fullText, currentCalls, tokenUsage!, this.activeInteractionId!);
        }

        return { items: [], tokenUsage: tokenUsage };
    }

    async abortGeneration(): Promise<void> {
        if (this.activeInteractionId) await this.client.interactions.cancel(this.activeInteractionId);
    }

    async summarizeContext(
        model: string, 
        history: ChatItem[], 
        previousTurnID: string, 
        abortSignal?: AbortSignal
    ): Promise<ChatResponse> {

        const response = await this.client.interactions.create({
            model: model,
            input: this.formatMessages(history),
            system_instruction: GeminiChatProvider.systemPrompt,
            stream: false,
            store: previousTurnID !== undefined,
            tools: GeminiChatProvider.compactionTools,
            ...(previousTurnID && { previous_interaction_id: previousTurnID })
        }, { signal: abortSignal });

        let fullText = response.output_text || '';
        const currentCalls = new Map<any, any>();

        if (response.steps && Array.isArray(response.steps)) {
            for (let i = 0; i < response.steps.length; i++) {
                const step = response.steps[i];
                if (step.type === 'function_call') {
                    currentCalls.set(step.id || i, {
                        id: step.id,
                        name: step.name,
                        arguments: step.arguments
                    });
                }
            }
        }

        const usage = response.usage;
        const tokenUsage: TokenUsage = {
            totalTokens: usage?.total_tokens,
            inputTokens: usage?.total_input_tokens,
            outputTokens: usage?.total_output_tokens,
            thoughtTokens: usage?.total_thought_tokens
        };

        return ChatProvider.formatResponse(fullText, currentCalls, tokenUsage, response.id);
    }

    async generateTitle(
        prompt: string, 
        model: string, 
        abortSignal?: AbortSignal
    ): Promise<string> {
        const response = await this.client.interactions.create({
            model: model,
            input: [{
                type: 'user_input',
                content: [{ type: 'text', text: prompt }]
            }],
            system_instruction: GeminiChatProvider.titlePrompt,
            stream: false,
            store: false
        }, { signal: abortSignal });

        const text = response.output_text || '';
        return text.trim().replace(/^["']|["']$/g, '').slice(0, 40);
    }
}