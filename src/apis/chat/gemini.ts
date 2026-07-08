import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { ChatItem, ChatProvider, ChatResponse, ModelInfo, StreamYield } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';

export class GeminiChatProvider extends ChatProvider {
    private client: GoogleGenAI;
    private static geminiTools: any = allToolSchemas;
    private static cachedModelInfos: ModelInfo[] | null = null;

    constructor(apiKey: string) {
        super();
        this.client = new GoogleGenAI({ apiKey });
    }

    async getModels(fetchAll?: boolean): Promise<ModelInfo[]> {
        if (!GeminiChatProvider.cachedModelInfos) await this.getModelInfos();
        if(!GeminiChatProvider.cachedModelInfos) return [];

        if (fetchAll) return GeminiChatProvider.cachedModelInfos;

        // Non deprecated models
        const featuredModels: string[] = [
            'gemini-3.5-flash', 
            'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite',
            'gemini-3-pro-preview', 'gemini-3-flash-preview',
            'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'
        ];

        return GeminiChatProvider.cachedModelInfos.filter(info => featuredModels.includes(info.id));
    }

    private async getModelInfos(): Promise<void> {
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
                const effortLevels = id.includes('gemini-3.1-pro') ? ['low', 'medium', 'high'] : ['minimal', 'low', 'medium', 'high'];
                infos.push({
                    id: id,
                    reason: reasonCapable,
                    efforts: reasonCapable ? effortLevels: [],
                    defaultEffort: reasonCapable ? 'medium' : null
                });
            }
        }
        GeminiChatProvider.cachedModelInfos = infos;
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

    async *fetchStream(model: string, effort: string, history: ChatItem[], previousTurnID: string | undefined): AsyncGenerator<StreamYield, ChatResponse, unknown> {
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
                tools: GeminiChatProvider.geminiTools,
                system_instruction: sysMsg && 'content' in sysMsg ? sysMsg.content : "You are an expert AI coding assistant...",
                stream: true,
                generation_config: {thinking_level: effort as any, thinking_summaries: 'auto'},
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
                        yield { type: 'text', content: event.delta.text };
                    }

                    else if (event.delta.type === 'thought_summary') {
                        // SHUT UP COMPILER
                        const deltaAny = event.delta as any;
                        const summaryText = deltaAny.content?.text || "";
                        if(summaryText) yield { type: 'thought', content: summaryText };
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