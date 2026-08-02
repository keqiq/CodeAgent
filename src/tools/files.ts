import * as vscode from 'vscode';
import { resolveUri, getFileContent } from '../utils/workspace';
import { ToolResult, ToolSchema } from './toolIndex';

export const fileSchemas: ToolSchema[] = [
    {
        type: "function",
        name: "read",
        description: "Read the exact contents of a file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "The relative path to the file in the worksapce." },
                offset: { type: "number", description: "Line number to start reading from (1-indexed)." },
                limit: { type: "number", description: "Maximum number of lines to read." }
            },
            required: ["filePath"]
        }
    },
    {
        type: "function",
        name: "write",
        description: "Create a new file or completely overwrite an existing file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file."},
                content:  { type: "string", description: "The complete text content to write to the file."}
            },
            required: ["filePath", "content"]
        }
    },
    {
        type: "function",
        name: "edit",
        description: "Edit a file by replacing exact oldText with newText. Use read first if you are not certain oldText exactly matches the current file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file."},
                oldText:  { type: "string", description: "The EXACT existing text to be replaced. Must match indentation perfectly."},
                newText:  { type: "string", description: "The new text that will replace the old text."}
            },
            required: ["filePath", "oldText", "newText"]
        }
    }
];

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

export async function executeRead(filePath: string, cwd: string, offset = 1, limit = 2000): Promise<ToolResult> {
    const fileUri = resolveUri(cwd, filePath);
    const uint8Array = await vscode.workspace.fs.readFile(fileUri);
    const lines = textDecoder.decode(uint8Array).split('\n');

    const sliced = lines.slice(offset - 1, offset - 1 + limit).join('\n');
    let message = sliced;

    if (lines.length > offset - 1 + limit) {
        message += `\n\n...[TRUNCATED: Showing lines ${offset}-${offset + limit - 1} of ${lines.length}. Use 'offset' parameter to read further.]...`;
    }

    return { message };
}

export async function executeWrite(filePath: string, content: string, cwd: string): Promise<ToolResult> {
    const fileUri = resolveUri(cwd, filePath);
    const uint8Array = textEncoder.encode(content);
    await vscode.workspace.fs.writeFile(fileUri, uint8Array);
    return {
        message: `Successfully wrote to ${filePath}`,
        changedFiles: [filePath]
    };
}

const normalize = (str: string) => str.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
export async function executeEdit(filePath: string, oldText: string, newText: string, cwd: string): Promise<ToolResult> {
    const fileUri = resolveUri(cwd, filePath);
    const rawFileContent = await getFileContent(fileUri);

    const hasCRLF = rawFileContent.includes('\r\n');

    const fileContent = rawFileContent.replace(/\r\n/g, '\n');
    const searchOldText = oldText.replace(/\r\n/g, '\n');
    const applyNewText = newText.replace(/\r\n/g, '\n');

    // Try stict matching first
    if (fileContent.includes(searchOldText)) {
        let updatedContent = fileContent.replace(searchOldText, applyNewText);
        if (hasCRLF) updatedContent = updatedContent.replace(/\n/g, '\r\n');

        await vscode.workspace.fs.writeFile(fileUri, textEncoder.encode(updatedContent));

        return {
            message: `Successfully edited ${filePath} with strict matching.`,
            changedFiles: [filePath]
        };
    }

    // Whitespace agnostic matching fallback
    const normalizedFile = normalize(fileContent);
    const normalizedOldText = normalize(oldText);

    if (normalizedFile.includes(normalizedOldText)) {
        throw new Error("oldText was found, but the indentation or line breaks did not match the file perfectly. Please use readFile to check the exact whitespace and try again.");
    }
    throw new Error("oldText was not found in the file at all. Ensure you are targeting the right code.");

}