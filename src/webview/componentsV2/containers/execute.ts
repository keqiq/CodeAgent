import { WebviewApi } from "../../frontend";

export class ExecuteContainer {
    private execGroup: HTMLDetailsElement;
    private execSummary: HTMLElement;
    private execLogs: HTMLElement;
    private executions: Map<string, HTMLElement> = new Map();

    private execErrorCount: number = 0;
    private totalExecCount: number = 0;

    private readonly iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bdbdbdgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M12 19H21M3 5L11 12L3 19" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>`;

    constructor(private container: HTMLElement, private vscodeAPI: WebviewApi) {
        this.execGroup = document.createElement('details');
        this.execGroup.classList.add('tool-group', 'execution-group');

        this.execSummary = document.createElement('summary');
        this.execSummary.innerHTML = `
            <div class="tool-summary-content">
                ${this.iconSVG}
                <span>Preparing executions...</span>
                <div class="vscode-spinner" style="margin-left: auto;"></div>
            </div>`;

        this.execLogs = document.createElement('div');
        this.execLogs.classList.add('tool-logs');

        this.execGroup.appendChild(this.execSummary);
        this.execGroup.appendChild(this.execLogs);

        this.container.appendChild(this.execGroup);
    }

    public update(msg: { status: string, toolID: string, bin: string, argsString?: string, error?: string, chunk?: string }): void {

        let targetEntry = this.executions.get(msg.toolID);

        // Execution running
        if (msg.status === 'running') {
            // add a spinner
            this.execSummary.innerHTML = `
            <div class="tool-summary-content">
            ${this.iconSVG} 
            <span>Running <b>${msg.bin}</b>...</span>
            <div class="vscode-spinner" style="margin-left: auto;"></div>
            </div>`;
            
            // Auto open current running command output container
            this.execGroup.open = true;
            if (!targetEntry) {

                targetEntry = document.createElement('details');
                targetEntry.classList.add('exec-log-entry');
                (targetEntry as HTMLDetailsElement).open = true; // Keep open while streaming

                // clickable header showing bin + args
                const summary = document.createElement('summary');
                summary.classList.add('exec-log-summary');

                summary.innerHTML = `
                    <div class="tool-name-badge-container">
                        <span class="status-highlight tool-name-badge tool-badge-running">
                            <div class="vscode-spinner"></div>
                            ${msg.bin}
                        </span>
                    </div>
                    <div class="tool-args-container" style="overflow: hidden;">
                        <span class="arg-string" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">
                            ${msg.argsString}
                        </span>
                    </div>
                    <div class="exec-chevron">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/></svg>
                    </div>
                `;

                // container holding the streaming div for outputs
                const outputContainer = document.createElement('div');
                outputContainer.classList.add('exec-output-container');
                outputContainer.innerHTML = `<div class="exec-output-text"></div>`;

                targetEntry.appendChild(summary);
                targetEntry.appendChild(outputContainer);

                this.execLogs!.appendChild(targetEntry);
                this.executions.set(msg.toolID, targetEntry);
                this.totalExecCount++;
            }
        }

        // Execution completion
        else if (msg.status === 'success') {
            if (targetEntry) {
                const badge = targetEntry.querySelector('.status-highlight') as HTMLElement;
                if (badge) {
                    badge.className = 'status-highlight tool-name-badge status-ok';
                    const spinner = badge.querySelector('.vscode-spinner');
                    if (spinner) spinner.remove();
                }
                // Optional UX: close the details block automatically when it finishes successfully
                (targetEntry as HTMLDetailsElement).open = false;
            }
        }

        // Execution error
        else if (msg.status === 'error') {
            this.execErrorCount++; // Assuming you have this class property
            if (targetEntry) {
                const badge = targetEntry.querySelector('.status-highlight') as HTMLElement;
                if (badge) {
                    badge.className = 'status-highlight tool-name-badge status-error';
                    const spinner = badge.querySelector('.vscode-spinner');
                    if (spinner) spinner.remove();
                }

                (targetEntry as HTMLDetailsElement).open = true; // Ensure it stays open to read the error

                // Append the error to the stream div
                const outputText = targetEntry.querySelector('.exec-output-text');
                if (outputText && msg.error) {
                    outputText.innerHTML += `\n<span style="color: var(--vscode-testing-iconFailed);">[Process Failed]: ${msg.error}</span>`;
                }
            }
        }

        else if (msg.status === 'streaming') {
            if (targetEntry && msg.chunk) {
                const outputText = targetEntry.querySelector('.exec-output-text');
                const outputContainer = targetEntry.querySelector('.exec-output-container');
                
                if (outputText) {
                    // Use textNode appending to safely escape HTML and prevent reflow bugs
                    outputText.appendChild(document.createTextNode(msg.chunk));
                    
                    // Auto-scroll to the bottom as logs come in
                    if (outputContainer) {
                        outputContainer.scrollTop = outputContainer.scrollHeight;
                    }
                }
            }
        }
    }

    public end(msg?: { interrupted?: boolean }): void {
        if (!this.execGroup || !this.execSummary) return;

        // Clean up leftover running executions
        this.executions.forEach((logEntry) => {
            const badge = logEntry.querySelector('.status-highlight') as HTMLElement;
            if (badge && badge.classList.contains('tool-badge-running')) {
                badge.className = 'status-highlight tool-name-badge status-error';
                const spinner = badge.querySelector('.vscode-spinner');
                if (spinner) spinner.remove();

                // If this cleanup is due to an interrupt, append the error to the streaming text div
                if (msg?.interrupted) {
                    const outText = logEntry.querySelector('.exec-output-text');
                    if (outText) {
                        outText.innerHTML += `\n<span style="color: var(--vscode-testing-iconFailed);">[Process Failed]: Halted manually</span>`;
                    }
                }
            }
        });

        // If execution calls were interrupted by user
        if (msg?.interrupted) {
            this.execSummary.innerHTML = `
                <div class="tool-summary-content">
                    ${this.iconSVG}
                    <span>Execution Halted</span>
                    <div class="tool-summary-badges" style="margin-left: auto;">
                        <span class="status-highlight status-error">Halted</span>
                    </div>
                </div>`;
        }
        
        // Executions all completed normally
        else {
            const successCount = this.totalExecCount - this.execErrorCount;
            
            let summaryHTML = `
                <div class="tool-summary-content">
                    ${this.iconSVG}
                    <span>Executed ${this.totalExecCount} command${this.totalExecCount === 1 ? '' : 's'}</span>
                    <div class="tool-summary-badges">`;

            if (successCount > 0) {
                summaryHTML += `<span class="status-highlight status-ok">${successCount} Success</span>`;
            }
            if (this.execErrorCount > 0) {
                summaryHTML += `<span class="status-highlight status-error">${this.execErrorCount} Failed</span>`;
            }
            
            summaryHTML += `</div></div>`;
            this.execSummary.innerHTML = summaryHTML;
        }
    }
}