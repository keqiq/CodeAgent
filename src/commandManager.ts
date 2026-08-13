import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ToolResult } from './tools/toolIndex';
import * as path from 'path';
import { parse } from 'shell-quote';

export interface CommandConfig {
    allowedCommands: Record<string, string[]>;
    promptForUnlistedCommands: boolean;
    unsafeFullAutonomous: boolean;
}

export class CommandManager {
    public static readonly DEFAULT_CONFIG: CommandConfig = {
        "allowedCommands": {
            "git": [
                "^status(?:\\s+--short)?$",
                "^log(?:\\s+--oneline)?(?:\\s+-[0-9]+)?$",
                "^diff(?:\\s+--(?:cached|staged))?$",
                "^diff\\s+--stat$",
                "^branch(?:\\s+--show-current)?$",
                "^remote(?:\\s+-v)?$",
                "^show\\s+--stat(?:\\s+HEAD)?$",
                "^rev-parse\\s+--show-toplevel$",
                "^rev-parse\\s+--abbrev-ref\\s+HEAD$",
                "^ls-files$"
            ],
            "npm": [
                "^test$",
                "^run\\s+(?:lint|build|typecheck|check|test)(?:\\s+--\\s+.*)?$",
                "^run$",
                "^list(?:\\s+--depth=0)?$",
                "^outdated$",
                "^audit(?:\\s+--(?:json|omit=dev))?$",
                "^view\\s+[^\\s]+(?:\\s+[^\\s]+)?$",
                "^config\\s+get\\s+[^\\s]+$",
                "^version$"
            ],
            "pnpm": [
                "^test$",
                "^run\\s+(?:lint|build|typecheck|check|test)(?:\\s+--\\s+.*)?$",
                "^run$",
                "^list(?:\\s+--depth=0)?$",
                "^outdated$",
                "^audit(?:\\s+--(?:json|prod))?$",
                "^why\\s+[^\\s]+$",
                "^version$"
            ],
            "yarn": [
                "^test$",
                "^run\\s+(?:lint|build|typecheck|check|test)(?:\\s+--\\s+.*)?$",
                "^run$",
                "^list(?:\\s+--depth=0)?$",
                "^outdated$",
                "^audit(?:\\s+--json)?$",
                "^why\\s+[^\\s]+$",
                "^version$"
            ],
            "cargo": [
                "^check(?:\\s+--(?:all|all-targets|workspace|all-features|no-default-features|features\\s+[^\\s]+))*$",
                "^test(?:\\s+--(?:lib|bins|tests|doc|workspace|all-features|no-default-features|features\\s+[^\\s]+))*$",
                "^clippy(?:\\s+--(?:all-targets|workspace|all-features|no-default-features|features\\s+[^\\s]+))*$",
                "^fmt\\s+--check$",
                "^tree(?:\\s+--(?:depth\\s+[0-9]+|duplicates|invert\\s+[^\\s]+))*$",
                "^metadata(?:\\s+--(?:format-version\\s+1|no-deps))?$",
                "^version$"
            ],
            "go": [
                "^test(?:\\s+(?:\\./\\.\\.\\.|\\./[^\\s]*|[^\\s]+))*$",
                "^vet(?:\\s+(?:\\./\\.\\.\\.|\\./[^\\s]*|[^\\s]+))*$",
                "^fmt(?:\\s+(?:\\./\\.\\.\\.|\\./[^\\s]*|[^\\s]+))*$",
                "^list(?:\\s+(?:-m|-json|\\.\\.\\.|\\./\\.\\.\\.|\\./[^\\s]*|[^\\s]+))*$",
                "^version$"
            ],
            "python": [
                "^--version$",
                "^-m\\s+pytest(?:\\s+[^;&|`$()]*)?$",
                "^-m\\s+unittest(?:\\s+[^;&|`$()]*)?$",
                "^-m\\s+compileall(?:\\s+[^;&|`$()]*)?$",
                "^-m\\s+ruff\\s+check(?:\\s+[^;&|`$()]*)?$",
                "^-m\\s+mypy(?:\\s+[^;&|`$()]*)?$"
            ],
            "node": [
                "^--version$",
                "^--check\\s+[^;&|`$()]+$"
            ],
            "rg": [
                "^(?:--files|--glob\\s+[^;&|`$()]+|[^;&|`$()]+)(?:\\s+[^;&|`$()]+)*$"
            ],
            "grep": [
                "^(?:-[A-Za-z]+\\s+)*[^;&|`$()]+(?:\\s+[^;&|`$()]+)*$"
            ],
            "find": [
                "^\\.(?:\\s+-maxdepth\\s+[0-9]+)?(?:\\s+-type\\s+[fd])?(?:\\s+-name\\s+[^;&|`$()]+)?$"
            ],
            "ls": [
                "^(?:-[A-Za-z]+\\s+)?(?:[^;&|`$()]+)?$"
            ],
            "pwd": [
                "^$"
            ],
            "which": [
                "^[A-Za-z0-9._+-]+$"
            ],
            "cat": [
                "^[^;&|`$()]+$"
            ],
            "head": [
                "^(?:-n\\s+[0-9]+\\s+)?[^;&|`$()]+$"
            ],
            "tail": [
                "^(?:-n\\s+[0-9]+\\s+)?[^;&|`$()]+$"
            ],
            "wc": [
                "^(?:-[A-Za-z]+\\s+)?[^;&|`$()]+$"
            ],
            "file": [
                "^[^;&|`$()]+$"
            ],
            "diff": [
                "^(?:-[A-Za-z]+\\s+)?[^;&|`$()]+\\s+[^;&|`$()]+$"
            ]
        },
        "promptForUnlistedCommands": true,
        "unsafeFullAutonomous": false,
    };

    private config: CommandConfig = CommandManager.DEFAULT_CONFIG;
    private watcher?: vscode.FileSystemWatcher;
    private onConfigChangeCallback?: (isUnsafe: boolean) => void;

    private getConfigUri = (): vscode.Uri | undefined => {
        if (!this.context.storageUri) return undefined;
        return vscode.Uri.joinPath(this.context.storageUri, 'agent-rules.json');
    };

    constructor(private context: vscode.ExtensionContext) {
        this.initWatcher();
    }

    private initWatcher() {
        if (!this.context.storageUri) return;

        const pattern = new vscode.RelativePattern(this.context.storageUri, 'agent-rules.json');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.watcher.onDidChange(async () => {
            await this.loadConfig();
            if (this.onConfigChangeCallback) {
                this.onConfigChangeCallback(this.config.unsafeFullAutonomous);
            }
        });
    }

    public onConfigChange(callback: (isUnsafe: boolean) => void) {
        this.onConfigChangeCallback = callback;
    }

    public getConfig(): CommandConfig {
        return this.config;
    }

    private async ensureConfigExists(): Promise<void> {
        const uri = this.getConfigUri();
        if (!uri) return;

        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            // Create the config file in new workspaces or if missing
            await vscode.workspace.fs.createDirectory(this.context.storageUri!);
            await vscode.workspace.fs.writeFile(
                uri,
                Buffer.from(JSON.stringify(CommandManager.DEFAULT_CONFIG, null, 4))
            );
        }
    }

    public async openConfigFile(): Promise<void> {
        const uri = this.getConfigUri();
        if (!uri) {
            vscode.window.showErrorMessage('No active workspace');
            return;
        }
        await this.ensureConfigExists();
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
    }

    public async loadConfig(): Promise<void> {
        const uri = this.getConfigUri();
        if (!uri) {
            this.config = CommandManager.DEFAULT_CONFIG;
            return;
        }

        await this.ensureConfigExists();

        try {
            const fileData = await vscode.workspace.fs.readFile(uri);
            this.config = JSON.parse(Buffer.from(fileData).toString('utf-8')) as CommandConfig;
        } catch (error) {
            // If the json file is broken, fallback to default
            this.config = CommandManager.DEFAULT_CONFIG;
        }
    }

    public async addCommandToAllowList(bin: string, args: string): Promise<void> {
        const uri = this.getConfigUri();
        if (!uri) {
            vscode.window.showErrorMessage('Unable to open configuration file.');
            return;
        }

        await this.loadConfig();

        const escapedArgs = args.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = `^${escapedArgs}$`;

        if (!this.config.allowedCommands[bin]) {
            this.config.allowedCommands[bin] = [];
        }

        if (!this.config.allowedCommands[bin].includes(regexPattern)) {
            this.config.allowedCommands[bin].push(regexPattern);

            try {
                await vscode.workspace.fs.writeFile(
                    uri,
                    Buffer.from(JSON.stringify(this.config, null, 4))
                );
                vscode.window.showInformationMessage(`Added '${bin} ${args}' to your allowed commands.`);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to save allowed command: ${e}`);
            }
        }
    }

    public async execute(
        commandStr: string,
        requestedCwd: string = '.',
        workspaceRoot: string,
        signal: AbortSignal,
        requestConfirmation: (bin: string, args: string) => Promise<boolean>,
        onOutput: (chunk: string) => void
    ): Promise<ToolResult> {

        const resolvedCwd = path.resolve(workspaceRoot, requestedCwd);
        const relativePath = path.relative(workspaceRoot, resolvedCwd);

        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new Error(`You cannot access directories outside of the workspace: ${requestedCwd}.`);
        }

        const parsed = parse(commandStr);

        if (parsed.length === 0) throw new Error('No command provided.');

        const hasOperators = parsed.some(part => typeof part !== 'string');
        if (hasOperators) throw new Error(`Command chaining is not allowed: ${commandStr}`);

        const argsArray = parsed as string[];
        const bin = argsArray[0]; // the executable binary
        const args = argsArray.slice(1); // the arguments

        if (!this.config.unsafeFullAutonomous) {
            const allowedPatterns = this.config!.allowedCommands[bin] || [];
            const argsString = args.join(' ');
    
            const isAllowed = allowedPatterns.some(pattern => {
                try {
                    const regex = new RegExp(pattern);
                    return regex.test(argsString);
                } catch {
                    return false;
                }
            });
    
            // If outside of allowedCommands, ask for confirmation
            if (!isAllowed) {
                if (!this.config.promptForUnlistedCommands) {
                    throw new Error(`Command blocked. '${bin} ${argsString}' is not in allowedCommands.`);
                }
                const userApproved = await requestConfirmation(bin, argsString);
                if (!userApproved) throw new Error(`User denied execution of command: ${commandStr}`);
            }
        }

        // Finally execute the command
        return new Promise((resolve, reject) => {
            if (signal.aborted) return reject(new Error('AbortError'));

            let stdoutData = '';
            let stderrData = '';
            let isDone = false;

            const child = spawn(bin, args, {
                cwd: resolvedCwd,
                // timeout: 30_000, // not working
                shell: false,
                windowsHide: true,
                env: {
                    PATH: process.env.PATH,
                    FORCE_COLOR: '0',
                    CI: 'true'
                }
            });

            const timeoutTimer = setTimeout(() => {
                if (isDone) return;
                isDone = true;

                child.kill('SIGKILL');

                let output = '';
                if (stdoutData) output += `STDOUT:\n${this.truncateOutput(stdoutData)}\n`;
                if (stderrData) output += `STDERR:\n${this.truncateOutput(stderrData)}\n`;
                
                reject(new Error(`[Process killed: Exceeded 60-second timeout]\n${output}`.trim()));
            }, 60_000);

            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdoutData += chunk;
                onOutput(chunk);
            });

            child.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderrData += chunk;
                onOutput(chunk);
            });

            child.on('error', (error) => {
                signal.removeEventListener('abort', abortListener);
                reject(new Error(`[Process Error]: ${error.message}`));
            });

            child.on('close', (code) => {
                signal.removeEventListener('abort', abortListener);

                let output = '';
                if (stdoutData) output += `STDOUT:\n${this.truncateOutput(stdoutData)}\n`;
                if (stderrData) output += `STDERR:\n${this.truncateOutput(stderrData)}\n`;

                if (child.killed) return reject(new Error(`[Process killed: Exceeded timeout or buffer limit]\n${output}`.trim()));
                if (code !== 0) return reject(new Error(`[Exit Code: ${code}]\n${output}`.trim()));

                resolve({ message: output.trim() || "Command executed successfully with no output." });
            });

            const abortListener = () => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timeoutTimer);
                child.kill('SIGKILL');
                reject(new Error('AbortError'));
            };

            signal.addEventListener('abort', abortListener);
        });
    }

    private truncateOutput(text: string, maxLen = 1000): string {
        if (text.length <= maxLen) return text;
        const half = Math.floor(maxLen / 2);
        return `${text.slice(0, half)}\n\n...[TRUNCATED]...\n\n${text.slice(-half)}`;
    }
}   