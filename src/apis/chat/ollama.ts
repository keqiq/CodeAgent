import { inspectOllamaModel } from "../ollamaUtils";
import { ModelInfo, WebSearchMode } from "./chatProvider";
import { OpenAICompatibleProvider } from "./openai";

export class OllamaChatProvider extends OpenAICompatibleProvider {

    private static ollamaBaseUrl = 'http://127.0.0.1:11434';
    protected featuredModels: string[] = [];

    constructor(apiKey: string, webSearchMode: WebSearchMode) {
        super(apiKey, `${OllamaChatProvider.ollamaBaseUrl}/v1`, webSearchMode); // Ollama default port
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        try {
            const response = await this.client.models.list();
            const infos: ModelInfo[] = [];

            const inspectedModels = await Promise.all(
                response.data.map(async (m) => ({
                    id: m.id,
                    meta: await inspectOllamaModel(OllamaChatProvider.ollamaBaseUrl, m.id)
                }))
            );
            for (const { id, meta } of inspectedModels) {
                if (!meta.isTextGeneration) continue;


                infos.push({
                    id: id,
                    reason: false,
                    efforts: [],
                    defaultEffort: null,
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
}