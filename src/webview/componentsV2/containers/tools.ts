export class ToolsContainer {
    private toolGroup: HTMLDetailsElement;
    private toolSummary: HTMLElement;
    private toolLogs: HTMLElement;
    private activeTools: Map<string, HTMLElement> = new Map();
    private toolErrorCount: number = 0;

    private readonly iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M11.5672 9.91603L3.68064 17.8026C2.65578 18.8275 2.45813 20.2915 3.23918 21.0725C4.02023 21.8535 5.48421 21.6559 6.50906 20.631L14.3956 12.7445" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M18.1588 3.32443L15.2376 6.24562C14.9168 6.56645 15.5113 7.23834 16.2923 8.01938C17.0734 8.80043 17.7452 9.39487 18.0661 9.07404L20.9873 6.15285" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M18.1474 3.33589C17.6014 3.13128 17.0102 3.01938 16.3928 3.01938C13.6314 3.01938 11.3928 5.25796 11.3928 8.01938C11.3928 8.63676 11.5047 9.22801 11.7093 9.77394M21.0763 6.26483C21.2809 6.81076 21.3928 7.40201 21.3928 8.01938C21.3928 10.7808 19.1542 13.0194 16.3928 13.0194C15.7754 13.0194 15.1842 12.9075 14.6382 12.7029" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>`;
    
    constructor(private container: HTMLElement) {
        this.toolGroup = document.createElement('details');
        this.toolGroup.classList.add('tool-group');

        this.toolSummary = document.createElement('summary');
        this.toolSummary.innerHTML = `
            <div class="tool-summary-content">
                ${this.iconSVG}
                <span>Initializing tools...</span>
                <div class="vscode-spinner" style="margin-left: auto;"></div>
            </div>`;

        this.toolLogs = document.createElement('div');
        this.toolLogs.classList.add('tool-logs');

        this.toolGroup.appendChild(this.toolSummary);
        this.toolGroup.appendChild(this.toolLogs);
        this.container.appendChild(this.toolGroup);
    }

    // Called when the agent executes a tool and on tool completion or error
    public update(msg: { status: string, toolID: string, toolName: string, args: any, error?: string }): void {

        // Tool running
        let targetTool = this.activeTools.get(msg.toolID);
        if (msg.status === 'running') {
            this.toolSummary.innerHTML = `
                <div class="tool-summary-content">
                    ${this.iconSVG}
                    <span>Running <b>${msg.toolName}</b>...</span>
                    <div class="vscode-spinner" style="margin-left: auto;"></div>
                </div>`;

            if (!targetTool) {
                targetTool = document.createElement('div');
                targetTool.classList.add('tool-log-entry');

                const displayArgs = this.formatToolArgs(msg.args);
                targetTool.innerHTML = `
                    <div class="tool-name-badge-container">
                        <span class="status-highlight tool-name-badge tool-badge-running">
                            <div class="vscode-spinner"></div>
                            ${msg.toolName}
                        </span>
                    </div>
                    <div class="tool-args-container">
                        ${displayArgs}
                    </div>
                `;

                this.toolLogs!.appendChild(targetTool);
                this.activeTools.set(msg.toolID, targetTool);
            }
        }

        // For web searches and other server tools
        else if (msg.status === 'server') {
            if (targetTool) {
                const badge = targetTool.querySelector('.status-highlight') as HTMLElement;
                if (badge) {
                    badge.className = 'status-highlight tool-name-badge tool-badge-server';

                    const spinner = badge.querySelector('.vscode-spinner');
                    if (spinner) spinner.remove();
                }

                // Update the Arguments with the final parsed JSON
                const argsContainer = targetTool.querySelector('.tool-args-container');
                if (argsContainer) {
                    argsContainer.innerHTML = this.formatToolArgs(msg.args);
                }
            }
        }

        // Tool completion
        else if (msg.status === 'success') {
            if (targetTool) {
                const badge = targetTool.querySelector('.status-highlight') as HTMLElement;
                if (badge) {
                    badge.className = 'status-highlight tool-name-badge status-ok'; // Turns it green
                    const spinner = badge.querySelector('.vscode-spinner');
                    if (spinner) spinner.remove(); // Remove spinner
                }
            }
        }
        // Tool error
        else if (msg.status === 'error') {
            this.toolErrorCount++;
            if (targetTool) {
                const badge = targetTool.querySelector('.status-highlight') as HTMLElement;
                if (badge) {
                    badge.className = 'status-highlight tool-name-badge status-error'; // Turns it red
                    const spinner = badge.querySelector('.vscode-spinner');
                    if (spinner) spinner.remove();
                }

                const argsContainer = targetTool.querySelector('.tool-args-container');
                if (argsContainer) {
                    argsContainer.innerHTML += `<div class="tool-error-text">${msg.error}</div>`;
                }
            }
        }
    }

    public end(msg: { customCount: number, serverCount: number, interrupted?: boolean }): void {
        if (!this.toolGroup || !this.toolSummary) return;

        // Clean up leftover running tools
        this.activeTools.forEach((toolDiv) => {
            const badge = toolDiv.querySelector('.status-highlight') as HTMLElement;
            if (badge && badge.classList.contains('tool-badge-running')) {
                badge.className = 'status-highlight tool-name-badge status-error';
                const spinner = badge.querySelector('.vscode-spinner');
                if (spinner) spinner.remove();

                // If this cleanup is due to an interrupt, add the specific error text
                if (msg.interrupted) {
                    const argsContainer = toolDiv.querySelector('.tool-args-container');
                    if (argsContainer) {
                        argsContainer.innerHTML += `<div class="tool-error-text">Halted manually</div>`;
                    }
                }
            }
        });

        // If tool calls were interrupted by user
        if (msg.interrupted) {
            this.toolSummary.innerHTML = `
                <div class="tool-summary-content">
                    ${this.iconSVG}
                    <span>Execution Halted</span>
                    <div class="tool-summary-badges" style="margin-left: auto;">
                        <span class="status-highlight status-error">Halted</span>
                    </div>
                </div>`;
        }

        // Tool calls all completed
        else {
            const serverCount = msg.serverCount || 0;
            const successCount = msg.customCount - this.toolErrorCount;
            const totalCount = msg.customCount + serverCount;

            let summaryHTML = `
                <div class="tool-summary-content">
                    ${this.iconSVG}
                    <span>Executed ${totalCount} tool${totalCount === 1 ? '' : 's'}</span>
                    <div class="tool-summary-badges">`;

            if (serverCount > 0) {
                summaryHTML += `<span class="status-highlight tool-badge-server">${serverCount} Server</span>`;
            }
            if (successCount > 0) {
                summaryHTML += `<span class="status-highlight status-ok">${successCount} Success</span>`;
            }
            if (this.toolErrorCount > 0) {
                summaryHTML += `<span class="status-highlight status-error">${this.toolErrorCount} Failed</span>`;
            }

            summaryHTML += `</div></div>`;
            this.toolSummary.innerHTML = summaryHTML;
        }
    }

    private formatToolArgs(args: any): string {
        try {
            const parsed = typeof args === 'string' ? JSON.parse(args) : args;

            if (!parsed || Object.keys(parsed).length === 0) return '<span style="opacity: 0.5; padding-top: 1px; display: inline-block;">(No arguments)</span>';

            let html = '<div class="arg-block">';
            for (const [key, value] of Object.entries(parsed)) {
                let displayValue = '';

                if (typeof value === 'string' && value.includes('\n')) {
                    const safeValue = value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    displayValue = `<div class="arg-multiline">${safeValue}</div>`;
                } else {
                    displayValue = `<span class="arg-string">"${value}"</span>`;
                }
                html += `<div class="arg-row"><span class="arg-key">${key}:</span> ${displayValue}</div>`;
            }
            html += '</div>';
            return html;
        } catch (e) {
            return `<span style="opacity: 0.8; margin-left: 6px;">(${JSON.stringify(args)})</span>`;
        }
    }
}