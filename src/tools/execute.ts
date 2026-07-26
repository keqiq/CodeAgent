import * as cp from 'child_process';
import { ToolResult, ToolSchema } from "./toolIndex";

export const commandSchemas: ToolSchema[] = [
    {
        type: "function",
        name: "run",
        description: "Execute a terminal/shell command inside the isolated worktree workspace. " +
                     "Use this for running tests, build tasks, linters, or checking tool versions. " +
                     "IMPORTANT: Commands MUST be non-interactive (e.g., use '-y' or '--force' flags). " +
                     "Do NOT run long-running servers or watch commands (e.g., 'npm start', 'npm run dev', '--watch') as they will time out.",
        parameters: {
            type: "object",
            properties: {
                command: { 
                    type: "string", 
                    description: "The shell command to execute (e.g., 'npm test', 'cargo check', 'git status')." 
                }
            },
            required: ["command"]
        }
    }
];

export async function executeRun(command: string, cwd: string, singal: AbortSignal): Promise<ToolResult> {
    return new Promise((resolve) => {
        if (singal.aborted) resolve({ message: 'Execution aborted.' });
        
        const child = cp.exec(command, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
            singal.removeEventListener('abort', abortListener);
            
            let output = '';
            if (stdout) output += `STDOUT:\n${truncateOutput(stdout)}\n`;
            if (stderr) output += `STDERR:\n${truncateOutput(stderr)}\n`;
            
            if (error) {
                // If killed by timeout option
                if (error.killed) output += `\n[Process kill: Exceeded timeout]`;
                else output += `\n[Exit Code: ${error.code}]`;
            }
            
            resolve({ message: output.trim() || "Command executed successfully with no output."});
        });
        
        const abortListener = () => {
            child.kill();
            resolve({ message: 'Process killed by user abort' });
        };

        singal.addEventListener('abort', abortListener);
    });
}

function truncateOutput(text: string, maxLen = 3000): string {
    if (text.length <= maxLen) return text;
    const half = Math.floor(maxLen / 2);
    return `${text.slice(0, half)}\n\n...[TRUNCATED]...\n\n${text.slice(-half)}`;
}