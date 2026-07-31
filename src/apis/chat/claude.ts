import Anthropic from '@anthropic-ai/sdk';
import { ChatItem, ChatProvider, ChatResponse, ModelInfo, StreamYield, TokenUsage, WebSearchMode } from './chatProvider';
import { requiredSchemas, webSchema, ToolSchema } from '../../tools/toolIndex';

export class ClaudeChatProvider extends ChatProvider {
    public static stateManagementSupport: boolean = true;
    public static serverWebSearchSupport: boolean = true;
    private client: Anthropic;
    // private static claudeTools: Anthropic.Tool[] = ClaudeChatProvider.parseTool(allToolSchemas);
    
    protected featuredModels: string[] = [
        'claude-opus-5',
        'claude-fable-5',
        'claude-sonnet-5',
        'claude-haiku-4-5-20251001'
    ];

    constructor(apiKey: string, webSearchMode: WebSearchMode) {
        super();
        this.client = new Anthropic({ apiKey: apiKey });
        
        const runTools: ToolSchema[] = [...requiredSchemas];
        if (webSearchMode === 'tavily') runTools.push(...webSchema);

        const parsedTools: any[] = ClaudeChatProvider.parseTool(runTools);
        if (webSearchMode === 'server') parsedTools.push({ type: "web_search_20260318", name: "web_search" });

        this.tools = parsedTools;
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        const infos: ModelInfo[] = [];
        const response = await this.client.models.list();

        for (const m of response.data) {

            const reasonCapable = m.capabilities?.thinking.supported;
            const efforts: string[] = [];
            const effortCapability = (m as any).capabilities?.effort;

            if (effortCapability && effortCapability.supported === true) {

                for (const [key, value] of Object.entries(effortCapability)) {

                    if (key !== 'supported' && (value as any)?.supported === true) {
                        efforts.push(key);
                    }
                }
            }

            infos.push({
                id: m.id,
                reason: reasonCapable,
                efforts: reasonCapable? efforts : [],
                defaultEffort: reasonCapable? 'high' : null
            });
        }

        return infos;
    }

    private static parseTool(flatTools: ToolSchema[]): Anthropic.Tool[] {
        return flatTools.map(tool => {
            return {
                name: tool.name,
                description: tool.description,
                input_schema: {
                    type: 'object' as const, 
                    properties: tool.parameters?.properties || {},
                    required: tool.parameters?.required || []
                }
            };
        });
    }

    private formatMessages(items: ChatItem[]): Anthropic.MessageParam[] {
        const messages: Anthropic.MessageParam[] = [];

        for (const item of items) {
            if (item.type === 'message') {
                messages.push({ role: item.role as 'user' | 'assistant', content: item.content });
            }  
            else if (item.type === 'function_call') {
                messages.push({
                    role: 'assistant',
                    content: [{
                        type: 'tool_use',
                        id: item.id,
                        name: item.name,
                        input: typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
                    }]
                });
            }
            else if (item.type === 'function_result') {
                messages.push({
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: item.id,
                        content: item.result
                    }]
                });
            }
        }
        return messages ;
    }

    // claude does not need an explicit turnID for caching
    async *fetchStream(
        model: string,
        effort: string,
        history: ChatItem[],
        previousTurnID: string | undefined,
        useCache: boolean,
        abortSignal: AbortSignal
    ): AsyncGenerator<StreamYield, ChatResponse, unknown> {

        let fullText = '';
        const currentCalls = new Map();
   
        let tokenUsage: TokenUsage = {
            totalTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            thoughtTokens: 0
        };
        
        const stream = await this.client.messages.create({
            model: model as any,
            system: ChatProvider.systemPrompt,
            messages: this.formatMessages(history),
            tools: this.tools,
            stream: true,
            max_tokens: 100000,
            thinking: {
                type: 'adaptive'
            },
            output_config: {
                effort: effort as any
            },
            ...(useCache && { cache_control: { type: 'ephemeral' } })

        }, { signal: abortSignal });

        for await (const event of stream) {
            if (abortSignal?.aborted) throw new Error('AbortError');
            // console.log(JSON.stringify(event));

            // Listen for start signal
            if (event.type === 'content_block_start') {
                if (event.content_block.type === 'tool_use') {
                    currentCalls.set(event.index, {
                        id: event.content_block.id,
                        name: event.content_block.name,
                        arguments: ''
                    });
                }

                // Purely for web search atm
                else if (event.content_block.type === 'server_tool_use') {

                    // Super confusing, when the server runs web search, it first sends this event
                    // Need to capture the content_block.id as subsequent 'web_search' calls will reference this
                    if (event.content_block.name === 'code_execution') {
                        currentCalls.set(event.content_block.id, {
                            id: event.content_block.id,
                            name: event.content_block.name,
                            arguments: '',
                            server: true
                        });

                        yield {
                            type: 'server_action',
                            content: 'Searching the web',
                            actionId: event.content_block.id,
                            actionName: 'web',
                            actionQuery: 'Searching the web...'
                        };
                    }

                    // Follow ups to the previous code_execution
                    // This actually has the query, and we can match it with caller.tool_id
                    else if (event.content_block.name === 'web_search') {
                        const callerId = ((event.content_block.caller) as any).tool_id;
                        const parentCall = currentCalls.get(callerId);

                        if (parentCall) {
                            const newQuery = ((event.content_block.input) as any).query;
                            
                            // Append with a newline if we already have previous queries
                            if (parentCall.arguments) {
                                parentCall.arguments += '\n' + newQuery;
                            } else {
                                parentCall.arguments = newQuery;
                            }
                        }
                    }
                }
            }

            else if (event.type === 'content_block_delta') {

                // This is for tool call arguments
                if (event.delta.type === 'input_json_delta') {
                    if (currentCalls.has(event.index) && !currentCalls.get(event.index).server) {
                        currentCalls.get(event.index).arguments += event.delta.partial_json;
                    }
                }

                // This is for messages
                else if (event.delta.type === 'text_delta') {
                    fullText += event.delta.text;
                    yield { type: 'text', content: event.delta.text };
                }

                // This is for reasoning outputs
                else if (event.delta.type === 'thinking_delta') {
                    yield { type: 'thought', content: event.delta.thinking };
                }
            }

            // Apparently input tokens are accessible only in this message
            else if (event.type === 'message_start') {
                if (event.message.usage) {
                    const usage = event.message.usage;
                    const totalInput = usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
                    tokenUsage.inputTokens = totalInput;
                } 
            }
            // Similarly for output tokens, though it is cumulative everytime we receive delta
            else if (event.type === 'message_delta') {
                if (event.usage) {
                    const usage = event.usage;
                    const thinkingTokens = usage.output_tokens_details?.thinking_tokens || 0;
                    
                    // looking at the events, the input tokens are updated every delta
                    const totalInput = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
                    tokenUsage.inputTokens = totalInput;
                    tokenUsage.outputTokens = usage.output_tokens - thinkingTokens;
                    tokenUsage.thoughtTokens = thinkingTokens;
                }
            }

            else if (event.type === 'content_block_stop') {
            }

        }

        tokenUsage.totalTokens = tokenUsage.inputTokens! + tokenUsage.outputTokens!;
        if (currentCalls.size > 0 || fullText.length > 0) {
            return ChatProvider.formatResponse(fullText, currentCalls, tokenUsage);
        }

        return { items: [], tokenUsage };
    }

    async abortStream(): Promise<void> {
        return;
    }
}