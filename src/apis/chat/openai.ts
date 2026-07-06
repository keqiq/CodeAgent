import OpenAI from 'openai';
import { ChatItem, ChatProvider, ChatResponse, ModelInfo, StreamYield } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';
declare const console: any;

export class OpenAIChatProvider extends ChatProvider {
    private client: OpenAI;
    private static GPTTools: any = allToolSchemas;
    private static cachedModelInfos: ModelInfo[] | null = null;

    constructor(apiKey: string) {
        super();
        this.client = new OpenAI({ apiKey });
    }

    async getModels(fetchAll?: boolean): Promise<ModelInfo[]> {
        if (!OpenAIChatProvider.cachedModelInfos) await this.getModelInfos();
        if (!OpenAIChatProvider.cachedModelInfos) return [];

        if (fetchAll) return OpenAIChatProvider.cachedModelInfos;
        
        // Non deprecated models
        const featuredModels: string[] = [
            'gpt-5.5', 'gpt-5.5-pro',
            'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
            'gpt-5.3-codex',
            'gpt-5.2', 'gpt-5.2-pro',
            'gpt-5.1', 'gpt-5-pro', 'gpt-5-mini', 'gpt-5-nano',
            'gpt-4.1', 'gpt-4.1-mini',
            'gpt-4o-mini',
            'o3', 'o3-pro',
            'gpt-oss-120b', 'gpt-oss-20b',
        ];

        return OpenAIChatProvider.cachedModelInfos.filter(infos => featuredModels.includes(infos.id));
    }

    private async getModelInfos(): Promise<void> {
        const infos: ModelInfo[] = [];
        try {
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
            OpenAIChatProvider.cachedModelInfos = infos;
        } catch (e) {
            console.log('Failed to fetch OpenAI models', e);
        }
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

    async *fetchStream(model: string, effort: string, history: ChatItem[], previousTurnID: string | undefined): AsyncGenerator<StreamYield, ChatResponse, unknown> {

        let fullText = "";
        const toolCallsContext: any[] = [];
        let responseID = null;

        let currentInput;
        if (previousTurnID) {
            const newItemsToSubmit = history.filter(item => 
                item.turnID === previousTurnID && (item.type === 'function_result' || (item.type === 'message' && item.role === 'user'))
            );

            currentInput = this.formatMessages(newItemsToSubmit);
        } else {
            currentInput = this.formatMessages(history);
        }

        try {
            const stream = await this.client.responses.create({
                model: model,
                input: currentInput,
                tools: OpenAIChatProvider.GPTTools,
                stream: true,
                reasoning: {effort: effort as any, summary: 'auto' },

                ...(previousTurnID && { previous_response_id: previousTurnID })
            });

            for await (const event of stream) {
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
                        toolCallsContext.push({
                            itemId: item.id,
                            id: item.call_id,
                            name: item.name,
                            arguments: ""
                        });
                    }
                }

                else if (event.type === 'response.function_call_arguments.delta') {
                    const deltaEvent = event as any;

                    // Match using itemId
                    const currentTool = toolCallsContext.find(t => t.itemId === deltaEvent.item_id)
                        || toolCallsContext[toolCallsContext.length - 1];

                    if (currentTool && deltaEvent.delta) {
                        currentTool.arguments += deltaEvent.delta;
                    }
                }
            }

            if (toolCallsContext.length > 0 || fullText.length > 0) {
                const items: ChatItem[] = [];
                
                if (fullText) {
                    items.push({ type: 'message', role: 'assistant', content: fullText, turnID: responseID! });
                }
                for (const call of toolCallsContext) {
                    items.push({ type: 'function_call', id: call.id, name: call.name, arguments: call.arguments ? JSON.parse(call.arguments) : {}, turnID: responseID! });
                }
                return { items, turnID: responseID! };
            }

        } catch (e) {
            console.log(e);
        }
        return { items: [] };
    }

    // UNUSED
    // async fetch(model: string, messages: ChatItem[]): Promise<ChatResponse> {
    //     const response = await this.client.responses.create({
    //         model: model,
    //         input: this.formatMessages(messages) as any,
    //         tools: this.GPTTools
    //     });

    //     const toolCalls = response.output.filter((item: any) => item.type === "function_call");

    //     if (toolCalls && toolCalls.length > 0) {
    //         const parsedCalls = toolCalls.map((call: any) => ({
    //             id: call.call_id,
    //             name: call.name,
    //             arguments: typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments
    //         }));

    //         return {
    //             text: response.output_text || null,
    //             tool_calls: parsedCalls
    //         };
    //     }

    //     return { text: response.output_text || null, tool_calls: null };
    // }
}
