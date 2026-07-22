import { OpenAICompatibleEmbedProvider } from "./openai";

export class ollamaEmbedProvider extends OpenAICompatibleEmbedProvider {
    
    constructor(apiKey: string) {
        super(apiKey, 'http://127.0.0.1:11434/v1');
    }
}