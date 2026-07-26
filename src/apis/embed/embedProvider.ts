export abstract class EmbedProvider {

    abstract embed(model: string, text: string[], abortSignal?: AbortSignal): Promise<number[][]>;
    abstract getModels(): Promise<string[]>;
}