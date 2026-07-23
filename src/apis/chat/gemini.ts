import { GoogleGenAI } from '@google/genai';
import { ChatItem, ChatProvider, ChatResponse, ModelInfo, StreamYield } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';

export class GeminiChatProvider extends ChatProvider {
    public static stateManagementSupport: boolean = true;
    private client: GoogleGenAI;
    private static geminiTools: any = allToolSchemas;

    protected featuredModels: string[] = [
            'gemini-3.6-flash',
            'gemini-3.5-flash', 'gemini-3.5-flash-lite',
            'gemini-3.1-pro', 'gemini-3.1-flash-lite'
    ];

    constructor(apiKey: string) {
        super();
        this.client = new GoogleGenAI({ apiKey: apiKey });
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
                    defaultEffort: reasonCapable ? defaultEffort : null
                });
            }
        }
        return infos;
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

    async *fetchStream(
        model: string, 
        effort: string, 
        history: ChatItem[], 
        previousTurnID: string | undefined,
        useCache: boolean,
        abortSignal: AbortSignal
    ): AsyncGenerator<StreamYield, ChatResponse, unknown> {
        
        let fullText = '';
        const sysMsg = history.find(i => i.type === 'message' && i.role === 'developer');
        
        // OK if we are doing stateful multi turn conversation we need to send back only the previous tool result or the user's new prompt
        // Gemini just updated their interactions API 
        // TODO: changes may be needed
        let currentInput;
        if (previousTurnID && useCache) {
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
        }, { signal: abortSignal });

        const currentCalls = new Map();
        let interactionId = null;
        
        for await (const event of stream) {
            if (abortSignal?.aborted) {
                if (interactionId) await this.client.interactions.cancel(interactionId);
                throw new Error('AbortError');
            }
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

            else if (evType === 'interaction.completed') {
                const usage = event.interaction.usage;
                if (usage) {


                }

            }
        }

        if (currentCalls.size > 0 || fullText.length > 0) {
            return ChatProvider.formatResponse(fullText, currentCalls, interactionId!);
        }

        return { items: [] };
    }
}