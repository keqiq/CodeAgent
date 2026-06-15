export abstract class EmbedProvider {
    abstract readonly providerId: string;

    abstract embed(model: string, text: string[]): Promise<number[][]>;
    abstract getModels(): Promise<string[]>;
}