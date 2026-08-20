import { ChatItem, ChatResponse, TokenUsage } from "../../managers/contextManager";
import { inspectOllamaModel } from "../ollamaUtils";
import { ChatProvider, ModelInfo, StreamYield, WebSearchMode } from "./chatProvider";
import { OpenAICompatibleProvider } from "./openai";

export class OllamaChatProvider extends OpenAICompatibleProvider {
    private ollamaUrl: string;
    protected featuredModels: string[] = [];

    constructor(apiKey: string, webSearchMode: WebSearchMode) {
        const url = `http://127.0.0.1:${apiKey}`;
        super('ollama', `${url}/v1`, webSearchMode);
        this.ollamaUrl = url;
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        try {
            const response = await this.client.models.list();
            const infos: ModelInfo[] = [];

            const inspectedModels = await Promise.all(
                response.data.map(async (m) => ({
                    id: m.id,
                    meta: await inspectOllamaModel(this.ollamaUrl, m.id)
                }))
            );

            for (const { id, meta } of inspectedModels) {
                if (!meta.isTextGeneration) continue;

                infos.push({
                    id: id,
                    reason: meta.isReasoning,
                    efforts: meta.efforts,
                    defaultEffort: meta.defaultEffort,
                    ...(meta.contextWindow && { contextWindow: meta.contextWindow })
                });
            }
            this.featuredModels = infos.map(info => info.id);
            return infos;

        } catch (error) {
            console.error("Failed to fetch local models. Is Ollama running?", error);
            return [];
        }
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
        let fullThought = '';
        const currentCalls = new Map();
        let tokenUsage: TokenUsage | undefined = undefined;
        const tagParser = new ThinkTagStreamParser();

        const formattedMessages = this.formatMessages(history);

        const stream = await this.client.chat.completions.create({
            model: model,
            messages: formattedMessages,
            tools: this.tools,
            stream: true,
            stream_options: { include_usage: true },
            ...(effort && effort !== 'none' && { reasoning_effort: effort as any })
        }, { signal: abortSignal });

        for await (const event of stream) {
            if (abortSignal?.aborted) throw new Error('AbortError');
            const delta = event.choices[0]?.delta as any;

            if (event.usage) {
                const usage = event.usage;
                const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
                tokenUsage = {
                    totalTokens: usage.total_tokens,
                    inputTokens: usage.prompt_tokens,
                    outputTokens: usage.completion_tokens - reasoningTokens,
                    thoughtTokens: reasoningTokens
                };
            }

            if (!delta) continue;

            // Ollama may actually emit thoughts throught <think> tags so this might not work
            const reasoningDelta = delta.reasoning_content || delta.reasoning || delta.thinking;
            if (reasoningDelta) {
                fullThought += reasoningDelta;
                yield { type: 'thought', content: reasoningDelta };
            }

            // Dedicated check for think tags
            if (delta.content) {
                for (const yieldItem of tagParser.processDelta(delta.content)) {
                    if (yieldItem.type === 'thought') {
                        fullThought += yieldItem.content;
                    } else if (yieldItem.type === 'text') {
                        fullText += yieldItem.content;
                    }
                    yield yieldItem;
                }
            }

            // Tool calls
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
                    if (toolCall.function?.name) yield { type: 'tool', content: toolCall.function.name };
                    const existing = currentCalls.get(index);
                    if (toolCall.id) existing.id = toolCall.id;
                    if (toolCall.function?.name) existing.name = toolCall.function.name;
                    if (toolCall.function?.arguments) {
                        existing.arguments += toolCall.function.arguments;
                        yield { type: 'tool', content: toolCall.function.arguments };
                    }
                }
            }
        }

        for (const yieldItem of tagParser.flush()) {
            if (yieldItem.type === 'thought') fullThought += yieldItem.content;
            else if (yieldItem.type === 'text') fullText += yieldItem.content;
            yield yieldItem;
        }

        if (currentCalls.size > 0 || fullText.length > 0) {
            return ChatProvider.formatResponse(fullText, currentCalls, tokenUsage!);
        }

        return { items: [], tokenUsage };
    }
}

export class ThinkTagStreamParser {
    private inThink: boolean = false;
    private buffer: string = '';

    *processDelta(chunk: string): Generator<StreamYield, void, unknown> {
        this.buffer += chunk;

        while (this.buffer.length > 0) {
            if (!this.inThink) {
                const thinkStart = this.buffer.indexOf('<think>');
                
                if (thinkStart === -1) {
                    // Check for partial '<think' match at the end of the buffer
                    const partialMatch = this.buffer.match(/<t?(h?(i?(n?(k)?)?)?)?$/);
                    const safeLength = partialMatch ? partialMatch.index! : this.buffer.length;
                    
                    if (safeLength > 0) {
                        const text = this.buffer.slice(0, safeLength);
                        this.buffer = this.buffer.slice(safeLength);
                        yield { type: 'text', content: text };
                    }
                    break;
                }

                // Yield text preceding <think>
                if (thinkStart > 0) {
                    yield { type: 'text', content: this.buffer.slice(0, thinkStart) };
                }
                
                this.buffer = this.buffer.slice(thinkStart + '<think>'.length);
                this.inThink = true;
            } else {
                const thinkEnd = this.buffer.indexOf('</think>');

                if (thinkEnd === -1) {
                    // Check for partial '</think' match at the end of the buffer
                    const partialMatch = this.buffer.match(/<\/t?(h?(i?(n?(k)?)?)?)?$/);
                    const safeLength = partialMatch ? partialMatch.index! : this.buffer.length;

                    if (safeLength > 0) {
                        const thought = this.buffer.slice(0, safeLength);
                        this.buffer = this.buffer.slice(safeLength);
                        yield { type: 'thought', content: thought };
                    }
                    break;
                }

                // Yield thought preceding </think>
                if (thinkEnd > 0) {
                    yield { type: 'thought', content: this.buffer.slice(0, thinkEnd) };
                }

                this.buffer = this.buffer.slice(thinkEnd + '</think>'.length);
                this.inThink = false;
            }
        }
    }

    *flush(): Generator<StreamYield, void, unknown> {
        if (this.buffer.length > 0) {
            yield { type: this.inThink ? 'thought' : 'text', content: this.buffer };
            this.buffer = '';
        }
    }
}