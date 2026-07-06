import OpenAI from 'openai';
import { ChatItem, ChatProvider, ChatResponse, ModelInfo } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';

export class DeepSeekChatProvider extends ChatProvider {
    private client: OpenAI;
    private static deepseekTools: any = DeepSeekChatProvider.parseTools(allToolSchemas);
    private static cachedModelInfos: ModelInfo[] | null = null;
    
    public stateManagementSupport: boolean = false;
    
    constructor(apiKey: string) {
        super();
        this.client = new OpenAI({
            baseURL: 'https://api.deepseek.com',
            apiKey: apiKey
        });
    }
    
    async getModels(fetchAll?: boolean): Promise<ModelInfo[]> {
        if (!DeepSeekChatProvider.cachedModelInfos) await this.getModelInfos();
        if (!DeepSeekChatProvider.cachedModelInfos) return [];
        
        if (fetchAll) return DeepSeekChatProvider.cachedModelInfos;

        // I think this is redundant since deepseek only provides these 2 models anyways
        // Just in case more are added i guess
        const featuredModels = ['deepseek-v4-flash', 'deepseek-v4-pro'];
        return DeepSeekChatProvider.cachedModelInfos.filter(info => featuredModels.includes(info.id));
    }

    async getModelInfos(): Promise<void> {
        const infos: ModelInfo[] = [];

        try {
            const response = await this.client.models.list();

            // DeepSeek only offers v4 models from their api docs and they have the same settings
            for (const m of response.data) {
                const id = m.id;
                infos.push({
                    id: id,
                    reason: true,
                    efforts: ['high', 'xhigh'],
                    defaultEffort: 'high'
                });
            }
            DeepSeekChatProvider.cachedModelInfos = infos;
        } catch (e) {
            console.log('Error fetching DeepSeek models', e);
        }
    }
    
    // Deepseek still uses the legacy chat completion style messages
    private formatMessages(items: ChatItem[]): any[] {
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

    private static parseTools(flatTools: any[]): any[] {
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

    // No provider state management available so send full chat history
    async *fetchStream(model: string, effort: string, history: ChatItem[], previousTurnID: string | undefined): AsyncGenerator<string, ChatResponse, unknown> {
        let fullText = '';

        try {
            const formattedMessages = this.formatMessages(history);

            const stream = await this.client.chat.completions.create({
                model: model,
                messages: formattedMessages,
                tools: DeepSeekChatProvider.deepseekTools,
                stream: true,
                
                reasoning_effort: effort as any,

                // This DOESNT WORK
                // thinking: {"type": "enabled"}
                // extra_body: {"thinking": {"type": "disabled"}}
            });

            const currentCalls = new Map();

            for await (const event of stream) {
                const delta = event.choices[0]?.delta;

                if (!delta) continue;

                if (delta.content) {
                    fullText += delta.content;
                    yield delta.content;
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
                const items: ChatItem[] = [];

                if (fullText) items.push({ type: 'message', role: 'assistant', content: fullText });

                for (const call of Array.from(currentCalls.values())) {
                    items.push({
                        type: 'function_call',
                        id: call.id,
                        name: call.name,
                        arguments: call.arguments ? JSON.parse(call.arguments) : {}
                    });
                }

                return { items };
            }
        } catch (e) {
            console.error(e);
        }

        return {items: [] };
    }
}