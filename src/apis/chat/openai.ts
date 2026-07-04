import OpenAI from 'openai';
import { ChatItem, ChatProvider, ChatResponse } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';
declare const console: any;

export class OpenAIChatProvider extends ChatProvider {
    private client: OpenAI;
    private GPTTools: any;
    constructor(apiKey: string) {
        super();
        this.client = new OpenAI({ apiKey });
        this.GPTTools = allToolSchemas;
    }

    async getModels(): Promise<string[]> {
        const response = await this.client.models.list();

        return response.data
            .map(m => m.id)
            .filter(id => id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3'))
            .sort();
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

    async *fetchStream(model: string, history: ChatItem[], previousTurnID: string | undefined): AsyncGenerator<string, ChatResponse, unknown> {

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
                tools: this.GPTTools,
                stream: true,

                ...(previousTurnID && { previous_response_id: previousTurnID })
            });

            for await (const event of stream) {
                if (event.type === 'error') {
                    const errMsg = (event as any).error?.message || 'Unknown stream error';
                    throw new Error(`OpenAI API Error: ${errMsg}`);
                }

                if (event.type === 'response.created') {
                    responseID = event.response.id;
                }

                else if (event.type === 'response.output_text.delta') {
                    const text = (event as any).delta;
                    if (text) {
                        fullText += text;
                        yield text;
                    }
                }

                else if (event.type === 'response.output_item.added') {
                    const item = (event as any).item;
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
