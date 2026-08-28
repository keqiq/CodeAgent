import { getEncoding, Tiktoken } from 'js-tiktoken';

export const tiktokenEncoder: Tiktoken = getEncoding('o200k_base');

export function countTokens(text: string): number {
    try {
        return tiktokenEncoder.encode(text).length;
    } catch {
        return Math.max(1, Math.round(text.length / 3.8));
    }
}