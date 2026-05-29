import OpenAI from 'openai';
import { ChatMessage, LLMProvider, LLMResponse } from './provider';


export class OpenAIProvider extends LLMProvider {
    private client: OpenAI;

    constructor(apiKey: string) {
        super();
        this.client = new OpenAI({ apiKey });
    }

    async getModels(): Promise<string[]> {
        const response = await this.client.models.list();

        return response.data.map(m => m.id).filter(id => id.startsWith('gpt')).sort();
    }

    async fetch(model: string, messages: ChatMessage[], toolSchemas: any[]): Promise<LLMResponse> {
        const formattedTools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolSchemas.map(schema => ({
            type: "function" as const,
            function: {
                name: schema.name,
                description: schema.description,
                parameters: schema.parameters
            }
        }));

        const response = await this.client.chat.completions.create({
            model: model,
            messages: messages as any,
            tools: formattedTools
        })

        const action = response.choices[0];
        const reason = action.finish_reason;
        const msg    = action.message;
        const tools  = msg.tool_calls;

        if (reason == "tool_calls" && tools && tools.length > 0) {
            const parsedCalls = [];
            
            for (const tool of tools) {
                if (tool.type === "function") {
                    const call = tool as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
                    parsedCalls.push({
                        id: call.id,
                        name: call.function.name,
                        arguments: JSON.parse(call.function.arguments)
                    })
                }
            }

            return {
                text: null,
                tool_calls: parsedCalls.length > 0 ? parsedCalls : null
            }
        }
        
        return { text: msg.content, tool_calls: null};
    }
}
