import * as vscode from 'vscode';
import * as path from 'path';
export function getWorkspaceUri(filePath: string): vscode.Uri {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) throw new Error("No workspace open");

    return vscode.Uri.joinPath(folders[0].uri, filePath);
}

const textDecoder = new TextDecoder('utf-8');
export async function getFileContent(uri: vscode.Uri): Promise<string> {
    const uint8Array = await vscode.workspace.fs.readFile(uri);

    return textDecoder.decode(uint8Array);
}

export function resolveUri(cwd: string, filePath: string): vscode.Uri {
    return vscode.Uri.file(path.join(cwd, filePath));
}