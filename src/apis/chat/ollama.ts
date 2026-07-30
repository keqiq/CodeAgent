import { ModelInfo, WebSearchMode } from "./chatProvider";
import { OpenAICompatibleProvider } from "./openai";

export class OllamaChatProvider extends OpenAICompatibleProvider {
    
    protected featuredModels: string[] = [];

    constructor(apiKey: string, webSearchMode: WebSearchMode) {
        super(apiKey, 'http://127.0.0.1:11434/v1', webSearchMode); // Ollama default port
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        try {
            const response = await this.client.models.list();
            const infos: ModelInfo[] = [];

            for (const m of response.data) {
                const id = m.id;

                infos.push({
                    id: id,
                    reason: false,
                    efforts: [],
                    defaultEffort: null
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