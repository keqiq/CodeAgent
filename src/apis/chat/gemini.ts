import { GoogleGenAI } from '@google/genai';
import { ChatItem, ChatProvider, ChatResponse } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';

export class GeminiChatProvider extends ChatProvider {
    private client: GoogleGenAI;
    private geminiTools: any;

    constructor(apiKey: string) {
        super();
        this.client = new GoogleGenAI({ apiKey });
        this.geminiTools = allToolSchemas;
    }

    async getModels(): Promise<string[]> {
        const response = await this.client.models.list();
        const modelNames: string[] = [];

        for await (const m of response) {
            if (m.supportedActions && m.supportedActions.includes('generateContent')) {
                if (m.name) {
                    const cleanName = m.name.replace('models/', '');
    
                    modelNames.push(cleanName);
                }
            }
        }

        return modelNames.sort();
    }

    // Not needed for Interactions api
    // private parseTools() {}

    private formatMessages(items: ChatItem[]): any[] {
        // Filter out developer messages so we can pass them as system_instructions instead
        return items
            .filter(item => !(item.type === 'message' && item.role === 'developer'))
            .map(item => {
                if (item.type === 'message') {
                    return { 
                        type: item.role === 'user' ? 'user_input' : 'model_output',
                        content: [{ type: "text", text: item.content }]
                    };
                } else if (item.type === 'function_call') {
                    return { 
                        type: "function_call", 
                        id: item.id, 
                        name: item.name, 
                        arguments: typeof item.arguments === "string" 
                            ? (item.arguments ? JSON.parse(item.arguments) : {}) 
                            : (item.arguments || {})
                    };
                } else if (item.type === 'function_result') {
                    return { 
                        type: "function_result", 
                        call_id: item.id, 
                        name: item.name || "", 
                        result: [{ 
                            type: "text", 
                            text: JSON.stringify({ response: item.result }) 
                        }] 
                    };
                }
        });
    }

    async *fetchStream(model: string, history: ChatItem[], previousTurnID: string | undefined): AsyncGenerator<string, ChatResponse, unknown> {
        let fullText = '';
        try {
            const sysMsg = history.find(i => i.type === 'message' && i.role === 'developer');
            
            // OK if we are doing stateful multi turn conversation we need to send back only the previous tool result or the user's new prompt
            let currentInput;
            if (previousTurnID) {
                const newItemsToSubmit = history.filter(item => 
                    item.turnID === previousTurnID && (item.type === 'function_result' || (item.type === 'message' && item.role === 'user'))
                );

                currentInput = this.formatMessages(newItemsToSubmit);
            } else {
                currentInput = this.formatMessages(history);
            }

            const stream = await this.client.interactions.create({
                model: model,
                input: currentInput,
                tools: this.geminiTools,
                system_instruction: sysMsg && 'content' in sysMsg ? sysMsg.content : "You are an expert AI coding assistant...",
                stream: true,

                ...(previousTurnID && { previous_interaction_id: previousTurnID })
            });

            const currentCalls = new Map();
            let interactionId = null;

            for await (const event of stream) {
                const evType = event.event_type;

                // Gemini's streaming with tool calls needs multi turn conversation implementation
                // Grab the current call's interaction id which we will need to keep track of for the next turn
                if (evType === 'interaction.created') {
                    interactionId = event.interaction.id;
                }

                else if (evType === 'step.start') {
                    if (event.step.type === 'function_call') {
                        currentCalls.set(event.index, {
                            id: event.step.id,
                            name: event.step.name,
                            arguments: ''
                        });
                    }
                }

                else if (evType === 'step.delta') {
                    if (event.delta.type === 'arguments_delta') {
                        if (currentCalls.has(event.index)) {
                            currentCalls.get(event.index).arguments += event.delta.arguments;
                        }
                    }
                    else if (event.delta.type === 'text') {
                        fullText += event.delta.text;
                        yield event.delta.text;
                    }
                }
            }

           if (currentCalls.size > 0 || fullText.length > 0) {
                const items: ChatItem[] = [];
                
                if (fullText) {
                    items.push({ type: 'message', role: 'assistant', content: fullText, turnID: interactionId! });
                }
                for (const call of Array.from(currentCalls.values())) {
                    items.push({ type: 'function_call', id: call.id, name: call.name, arguments: call.arguments ? JSON.parse(call.arguments) : {}, turnID: interactionId! });
                }
                return { items, turnID: interactionId! };
            }
        } catch (e) {
            console.log(e);
        }

        return { items: [] };
    }

    // async *fetchStream(model: string, history: ChatMessage[]): AsyncGenerator<string, ChatResponse, unknown> {
    //     const stream = await this.client.models.generateContentStream({
    //         model: model,
    //         contents: this.parseMessages(history),
    //         config: {
    //             tools: this.geminiTools,
    //             systemInstruction: "You are an expert AI coding assistant inside VS Code."
    //         }
    //     });

        
    //     let fullText = "";
    //     let toolCallsBuffer: any[] = [];
        
    //     for await (const chunk of stream) {
    //         if (chunk.functionCalls) {
    //             for (const call of chunk.functionCalls) {
    //                 toolCallsBuffer.push({
    //                     name: call.name || "",
    //                     arguments: call.args
    //                 });
    //             }

    //             return { text: null, tool_calls: toolCallsBuffer };
    //         }

    //         if (chunk.text) {
    //             fullText += chunk.text;
    //             yield chunk.text;
    //         }
    //     }

    //     return {
    //         text: fullText,
    //         tool_calls: null
    //     };
    // }

    // async fetch(model: string, messages: ChatMessage[]): Promise<ChatResponse> {

    //     const response = await this.client.models.generateContent({
    //         model: model,
    //         contents: this.parseMessages(messages),
    //         config: {
    //             tools: this.geminiTools,
    //             systemInstruction: "You are an expert AI coding assistant inside VS Code."
    //         }
    //     });

    //     const calls = response.functionCalls;

    //     if (calls && calls.length > 0) {
    //         const parsedCalls = [];

    //         for (const call of calls) {
    //             parsedCalls.push({
    //                 name: call.name || "",
    //                 arguments: call.args
    //             });
    //         }

    //         return {
    //             text: null,
    //             tool_calls: parsedCalls
    //         };
    //     }

    //     return { text: response.text || "", tool_calls: null};
    // }
}