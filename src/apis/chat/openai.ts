import OpenAI from 'openai';
import { ChatItem, ChatProvider, ChatResponse, ModelInfo, StreamYield } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';

export class OpenAIChatProvider extends ChatProvider {
    public static stateManagementSupport: boolean = true;
    private client: OpenAI;
    private static GPTTools: any = allToolSchemas;

    protected featuredModels: string[] = [
            'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
            'gpt-5.5', 'gpt-5.5-pro',
            'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
            'gpt-5.3-codex',
    ];

    constructor(apiKey: string) {
        super();
        this.client = new OpenAI({ apiKey });
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        const infos: ModelInfo[] = [];
        const response = await this.client.models.list();
        const exclusionKeywords = [
            'instruct', 'search', 'tts', 'transcribe', 
            'chat', 'audio', 'image', 'translate', 
            'whisper', 'realtime'
        ];

        for (const m of response.data) {
            // Filter out irrelevant models
            const id = m.id;
            const relevant = id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3');
            const exluded = exclusionKeywords.some(keyword => id.includes(keyword));

            if (relevant && !exluded) {
                // Reasoning should be supported by all o-x models and gpt-5.x
                // THERE IS NO ENDPOINT I CAN FIND TO CHECK FOR THIS SO I WILL BE HARD CODING THIS
                const reasonCapable = 
                    id.startsWith('o1') ||
                    id.startsWith('o3') ||
                    id.startsWith('gpt-5') ||
                    id.startsWith('gpt-oss');
                
                // The different models even have different reasoning effort levels
                // So this will break with new models too
                let supportedEfforts: string[] = [];
                let defaultEffort: string | null = null;

                if (reasonCapable) {
                    defaultEffort = 'medium';

                    // Extract the minor version for the gpt-5.x series
                    const gpt5Match = id.match(/gpt-5\.(\d+)/);
                    const minorVersion = gpt5Match ? parseInt(gpt5Match[1], 10) : -1;

                    if (id.includes('gpt-5-pro')) {
                        // gpt-5-pro only supports high
                        supportedEfforts = ['high'];
                        defaultEffort = 'high';

                    } else if (minorVersion === 6) {
                        // gpt-5.6 models support max mode
                        supportedEfforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

                    } else if (minorVersion > 1) {
                        // models after gpt-5.1-codex-max (e.g., gpt-5.2, 5.3, 5.4, 5.5) support xhigh
                        supportedEfforts = ['none', 'low', 'medium', 'high', 'xhigh'];

                    } else if (minorVersion === 1) {
                        // gpt-5.1 supports none, low, medium, high
                        supportedEfforts = ['none', 'low', 'medium', 'high'];

                    } else {
                        // models before gpt-5.1 (e.g., o1, o3, gpt-5.0) do NOT support none
                        supportedEfforts = ['minimal', 'low', 'medium', 'high'];
                    }
                }
                infos.push({
                    id: id,
                    reason: reasonCapable,
                    efforts: supportedEfforts,
                    defaultEffort: defaultEffort
                });
            }
        }
        return infos;
    }

    // Not needed for Responses API
    // private parseTools(tools: any[]): OpenAI.Responses.Tool[] | undefined {}

    private formatMessages(items: ChatItem[]): any[] {
        return items.map(item => {
            if (item.type === 'message') {
                return { role: item.role, content: item.content };
            } else if (item.type === 'function_call') {
                return { type: "function_call", call_id: item.id, name: item.name, arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments) };
            } else if (item.type === 'function_result') {
                return { type: "function_call_output", call_id: item.id, output: item.result };
            }
        });
    }

    async *fetchStream(
        model: string, 
        effort: string, 
        history: ChatItem[], 
        previousTurnID: string | undefined,
        useCache: boolean,
        abortSignal: AbortSignal
    ): AsyncGenerator<StreamYield, ChatResponse, unknown> {
        
        let fullText = "";
        const currentCalls = new Map();
        let responseID = null;

        let currentInput;
        if (previousTurnID && useCache) {
            const newItemsToSubmit = history.filter(item => 
                item.turnID === previousTurnID && (item.type === 'function_result' || (item.type === 'message' && item.role === 'user'))
            );

            currentInput = this.formatMessages(newItemsToSubmit);
        } else {
            currentInput = this.formatMessages(history);
        }

        const stream = await this.client.responses.create({
            model: model,
            input: currentInput,
            tools: OpenAIChatProvider.GPTTools,
            stream: true,
            reasoning: {effort: effort as any, summary: 'auto' },

            ...(previousTurnID && { previous_response_id: previousTurnID })
        }, { signal: abortSignal });

        for await (const event of stream) {
            if (abortSignal?.aborted) throw new Error('AbortError');
            if (event.type === 'error') {
                const errMsg = (event as any).error?.message || 'Unknown stream error';
                throw new Error(`OpenAI API Error: ${errMsg}`);
            }

            else if (event.type === 'response.created') {
                responseID = event.response.id;
            }

            else if (event.type === 'response.output_text.delta') {
                const text = event.delta;
                if (text) {
                    fullText += text;
                    yield { type: 'text', content: text };
                }
            }

            else if (event.type === 'response.reasoning_text.delta') {
                const text = event.delta;
                if (text) yield { type: 'thought', content: text };
            }

            else if (event.type === 'response.output_item.added') {
                const item = event.item;
                if (item && item.type === 'function_call') {
                    currentCalls.set(item.id, {
                        id: item.call_id,
                        name: item.name,
                        arguments: ''
                    });
                }
            }

            else if (event.type === 'response.function_call_arguments.delta') {

                if (currentCalls.has(event.item_id)) {
                    currentCalls.get(event.item_id).arguments += event.delta;
                }
            }
        }

        if (currentCalls.size > 0 || fullText.length > 0) {
            return ChatProvider.formatResponse(fullText, currentCalls, responseID!);
        }

        return { items: [] };
    }
}

// For other providers using OpenAI SDK
export abstract class OpenAICompatibleProvider extends ChatProvider {
    protected client: OpenAI;
    protected static tools: any = OpenAICompatibleProvider.parseTools(allToolSchemas);
    
    constructor(apiKey: string, baseURL: string) {
        super();
        this.client = new OpenAI({
            baseURL: baseURL,
            apiKey: apiKey
        });
    }
    
    protected formatMessages(items: ChatItem[]): any[] {
        return items.map(item => {
            if (item.type === 'message') {
                const mappedRole = item.role === 'developer' ? 'system' : item.role;
                return { role: mappedRole, content: item.content };
            } else if (item.type === 'function_call') {
                return {
                    role: 'assistant',
                    tool_calls: [{
                        id: item.id,
                        type: 'function',
                        function: {
                            name: item.name,
                            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments)
                        }
                    }]
                };
            } else if (item.type === 'function_result') {
                return {
                    role: 'tool',
                    tool_call_id: item.id,
                    content: item.result
                };
            }
        });
    }

    protected static parseTools(flatTools: any[]): any[] {
        return flatTools.map(tool => {
            return {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            };
        });
    }

    async *fetchStream(
        model: string, 
        effort: string, 
        history: ChatItem[], 
        previousTurnID: string | undefined,
        useCache: boolean,
        abortSignal: AbortSignal
    ): AsyncGenerator<StreamYield, ChatResponse, unknown> {
        let fullText = '';
        const formattedMessages = this.formatMessages(history);

        // I don't think any of the third party provider support the responses api
        // Just use the old chat.completions, ignore previousTurnID
        const stream = await this.client.chat.completions.create({
            model: model,
            messages: formattedMessages,
            tools: OpenAICompatibleProvider.tools,
            stream: true,

            reasoning_effort: effort as any
        }, { signal: abortSignal });

        const currentCalls = new Map();

        for await (const event of stream) {
            if (abortSignal?.aborted) throw new Error('AbortError');
            const delta = event.choices[0]?.delta;

            if (!delta) continue;

            if (delta.content) {
                fullText += delta.content;
                yield { type: 'text', content: delta.content };
            }

            // Safely parse reasoning content if the model provides it
            if ((delta as any).reasoning_content) {
                const text = (delta as any).reasoning_content;
                yield { type : 'thought', content: text };
            }

            if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index;

                    if (!currentCalls.has(index)) {
                        currentCalls.set(index, {
                            id: toolCall.id || '',
                            name: toolCall.function?.name || '',
                            arguments: ''
                        });
                    }

                    const existing = currentCalls.get(index);
                    if (toolCall.id) existing.id = toolCall.id;
                    if (toolCall.function?.name) existing.name = toolCall.function.name;
                    if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
                }
            }
        }

        if (currentCalls.size > 0 || fullText.length > 0) {
            return ChatProvider.formatResponse(fullText, currentCalls);
        }

        return { items: [] };
    }
}
