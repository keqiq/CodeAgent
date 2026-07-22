export abstract class EmbedProvider {

    abstract embed(model: string, text: string[]): Promise<number[][]>;
    abstract getModels(): Promise<string[]>;
}