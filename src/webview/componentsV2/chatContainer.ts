
import { WebviewApi } from "../frontend";
import { marked } from 'marked';
import hljs from 'highlight.js';

import 'highlight.js/styles/vs2015.css';
import { ChatItem, TokenUsage } from "../../contextManager";

interface ParsedPatchFile {
    filename: string;
    additions: number;
    deletions: number;
    isNew: boolean;
    isDeleted: boolean;
}

interface ParsedPatchResult {
    files: ParsedPatchFile[];
    totalAdditions: number;
    totalDeletions: number;
}

const THOUGHT_PHRASES = [
    'Pondering...',
    'Refining ideas...',
    'Working on it...',
    'Connecting the dots...',
    'Mapping out next steps...',
    'Taking a closer look...',
    'Thinking extra hard...'
];

export class ChatContainer {
    private container: HTMLElement;
    private scrollToBottomBtn: HTMLButtonElement;

    private activeStreamDiv: HTMLElement | null = null;
    private activeStreamRawText: string = "";

    private activeToolGroup: HTMLDetailsElement | null = null;
    private activeToolSummary: HTMLElement | null = null;
    private activeToolLogs: HTMLElement | null = null;
    private activeTools: Map<string, HTMLElement> = new Map();
    private toolErrorCount: number = 0;

    private activeThoughtDetails: HTMLDetailsElement | null = null;
    private activeThoughtContent: HTMLElement | null = null;
    private activeThoughtRawText: string = '';
    private thoughtStartTime: number = 0;
    private thoughtTotalTime: number = 0;
    private isThinking: boolean = false;


    private activePatchContainer: HTMLElement | null = null;

    private activeRunContainer: HTMLElement | null = null;
    private activeRunContent: HTMLElement | null = null;
    private activeRunFooter: HTMLElement | null = null;
    private tokenUsageElement: HTMLElement | null = null;
    private runStatusElement: HTMLElement | null = null;

    constructor(private vscodeAPI: WebviewApi) {
        this.container = document.getElementById('chatContainer') as HTMLElement;
        this.scrollToBottomBtn = document.getElementById('scrollToBottomBtn') as HTMLButtonElement;

        this.initListeners();
    }

    private initListeners() {

        // Toggle scroll to bottom button based on container scroll distance to bottom
        this.container.addEventListener('scroll', () => {
            const distanceToBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight;
            if (distanceToBottom > 50) this.scrollToBottomBtn.classList.add('visible');
            else this.scrollToBottomBtn.classList.remove('visible');
        });

        this.scrollToBottomBtn.addEventListener('click', () => {
            this.scrollToBottom();
        });
    }
        
    // -----------------------------------------------------------------------------
    // -------------------------- RUN CONTAINER SECTION ----------------------------
    // -----------------------------------------------------------------------------

    public startRun(): void {
        this.activeRunContainer = document.createElement('div');
        this.activeRunContainer.classList.add('run-container');

        // The content container has all the messages, thoughts, tools, patches
        this.activeRunContent = document.createElement('div');
        this.activeRunContent.classList.add('run-content');

        // The footer contains token usage and abort and error indicators
        this.activeRunFooter = document.createElement('div');
        this.activeRunFooter.classList.add('run-footer', 'footer-normal');

        // token usage display on the left
        this.tokenUsageElement = document.createElement('div');
        this.tokenUsageElement.classList.add('token-usage-container');
        this.tokenUsageElement.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 11a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm.5-7.5h-1v4h1v-4zm0 5h-1v1h1v-1z"/>
            </svg>
            <span class="token-total-text">0 Tokens</span>
        `;
        this.tokenUsageElement.style.display = 'none'; // hide on init until we have data

        // status like user interrupt or error
        this.runStatusElement = document.createElement('div');
        this.runStatusElement.classList.add('run-status');

        this.activeRunFooter.appendChild(this.tokenUsageElement);
        this.activeRunFooter.appendChild(this.runStatusElement);

        this.activeRunContainer.appendChild(this.activeRunContent);
        this.activeRunContainer.appendChild(this.activeRunFooter);

        this.container.appendChild(this.activeRunContainer);
        this.showTypingIndicator();
    }

    public updateTokenUsage(usage: TokenUsage): void {
        if (!this.tokenUsageElement || !usage) return;

        this.tokenUsageElement.style.display = 'flex';

        const textSpan = this.tokenUsageElement.querySelector('.token-total-text');
        if (textSpan) textSpan.textContent = `${usage.totalTokens || 0} Tokens`;

        this.tokenUsageElement.title = `Input: ${usage.inputTokens || 0}\nOutput: ${usage.outputTokens || 0}\nThought: ${usage.thoughtTokens || 0}`;
    }

    public endRun(status: 'ok' | 'aborted' | 'error', message?: string): void {
        this.endThought();
        if (!this.activeRunFooter || !this.runStatusElement) return;

        if (status === 'aborted') {
            this.activeRunFooter.classList.replace('footer-normal', 'footer-aborted');
            this.runStatusElement.textContent = message || 'Aborted';
        } 
        else if (status === 'error') {
            this.activeRunFooter.classList.replace('footer-normal', 'footer-error');
            this.runStatusElement.textContent = message || 'Error';
        } else {
            this.runStatusElement.textContent = '';
        }

        this.activeRunContainer = null;
        this.activeRunContent = null;
        this.activeRunFooter = null;
        this.tokenUsageElement = null;
        this.runStatusElement = null;
    }

    // On extension reload, restore chat messages
    public restoreChatHistory(history: ChatItem[]): void {
        this.clearChatUI();

        if (history && history.length > 0) {
            history.forEach(m => {

                // I chose to only restore messages on extension reload to reduce clutter (and simpler)
                // So tool results and thought process will not persist on reload
                if (m.type === 'message' && !m.isHidden) {
                    
                    // User messages are the start of a new interaction cycle
                    if (m.role === 'user') {
                        if (this.activeRunContainer) this.endRun('ok'); // this may be a redundant check
                        this.appendMessage(m);
                        this.startRun();
                    }

                    else if (m.role === 'assistant') this.appendMessage(m);

                    // if (m.role === 'user' || m.role === 'assistant') this.appendMessage(m);
                }

                else if (m.type === 'run_summary') {
                    if (m.tokenUsage) this.updateTokenUsage(m.tokenUsage);
                    this.endRun(m.status, m.message);
                }
            });

            if (this.activeRunContainer) this.endRun('ok'); // In case a run_summary wasn't saved due to crash
        }
    }

    // Used only during restoreChatHistory and for posting user messages
    // Also for error and abort messages!
    // Agent responses are streamed which uses streamMessage
    // Tool calls are contained inside tool groups so not here either
    public appendMessage(msg: Extract<ChatItem, { type: 'message' }> & { style?: string }): void {
        this.removeTypingIndicator();
        this.removeActivePatchUI();

        if (msg.isHidden) return;

        const text = msg.content || '';
        const role = msg.role;

        const msgDiv = document.createElement('div');
        
        // Map 'assistant' role to 'agent' class for CSS consistency
        const cssClass = role === 'assistant' ? 'agent' : role;
        msgDiv.classList.add('message', cssClass);

        // Apply optional style class for interrupt/error messages
        if (msg.style) {
            msgDiv.classList.add(msg.style);
        }

        // Agent messages, need markdown parsing and code highlight
        if (role === 'assistant') {
            msgDiv.innerHTML = this.parseMarkdown(text);
            msgDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block as HTMLElement);
            });
            (this.activeRunContent || this.container).appendChild(msgDiv);
        }

        // User messages need to be collapsable
        else if (role === 'user') {
            const textContainer = document.createElement('div');
            textContainer.classList.add('user-text-content');
            textContainer.textContent = text;
            msgDiv.appendChild(textContainer);

            const lineCount = text.split('\n').length;
            if (text.length > 250 || lineCount > 5) {
                textContainer.classList.add('clamped');
                const toggleBtn = document.createElement('button');
                toggleBtn.classList.add('toggle-text-btn');
                toggleBtn.textContent = 'Show More';

                toggleBtn.addEventListener('click', () => {
                    if (textContainer.classList.contains('clamped')) {
                        textContainer.classList.remove('clamped');
                        toggleBtn.textContent = 'Show Less';
                    }
                    else {
                        textContainer.classList.add('clamped');
                        toggleBtn.textContent = 'Show More';
                        msgDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                });
                msgDiv.appendChild(toggleBtn);
            }
            (this.activeRunContent || this.container).appendChild(msgDiv);
        }
        this.scrollToBottom();
    }

    public streamMessage(chunk: string): void {
        if (!this.activeRunContent) return;

        // All thoughts are now contained in 1 container
        // When a message is received, the thought is finished so pause the thinking timer
        this.pauseThoughtTimer();
        
        // Create new streaming div
        if (!this.activeStreamDiv) {
            this.removeTypingIndicator();
            this.activeStreamDiv = document.createElement('div');
            this.activeStreamDiv.classList.add('message', 'agent');
            this.activeRunContent.appendChild(this.activeStreamDiv);
        }

        this.activeStreamRawText += chunk;
        this.activeStreamDiv.innerHTML = this.parseMarkdown(this.activeStreamRawText);
        this.scrollToBottom();
    }

    public endStream(): void {
        if (!this.activeStreamDiv) return;

        // Highlight code blocks
        this.activeStreamDiv.querySelectorAll('pre code').forEach((block) =>  {
            hljs.highlightElement(block as HTMLElement);
        });

        // Remove references
        this.activeStreamDiv = null;
        this.activeStreamRawText = "";
    }

    // -----------------------------------------------------------------------------
    // ------------------------------ THOUGHT SECTION ------------------------------
    // -----------------------------------------------------------------------------

    public streamThought(chunk: string): void {
        if (!this.activeRunContent) return;
        this.removeTypingIndicator();

        // start or resume thought timer
        if (!this.isThinking) {
            this.thoughtStartTime = Date.now();
            this.isThinking = true;

            // Separate each thought
            if (this.activeThoughtRawText) this.activeThoughtRawText += '\n\n';
        }

        // Create new streaming details panel
        if (!this.activeThoughtDetails) {
            this.thoughtStartTime = Date.now();

            this.activeThoughtDetails = document.createElement('details');
            this.activeThoughtDetails.classList.add('thought-group');

            const summary = document.createElement('summary');

            // Bouncing dots thinking indicator
            summary.innerHTML = `
                <div class="typing-indicator" style="display:inline-flex; margin-right: 8px;">
                    <span></span><span></span><span></span>
                </div> 
                <span>Thinking...</span>
            `;

            this.activeThoughtContent = document.createElement('div');
            this.activeThoughtContent.classList.add('thought-content', 'message', 'agent');

            this.activeThoughtDetails.appendChild(summary);
            this.activeThoughtDetails.appendChild(this.activeThoughtContent);
            this.activeRunContent.appendChild(this.activeThoughtDetails);
        }

        this.activeThoughtRawText += chunk;
        this.activeThoughtContent!.innerHTML = this.parseMarkdown(this.activeThoughtRawText);
        this.scrollToBottom();
    }

    private endThought(): void {
        if (!this.activeThoughtDetails) return;
        this.pauseThoughtTimer();
        // Update summary with thought duration
        const duration = ((this.thoughtTotalTime) / 1000).toFixed(1);
        const summary = this.activeThoughtDetails.querySelector('summary');
        if (summary) summary.innerHTML = `<span>Thought for ${duration} seconds</span>`;

        // Highlight code blocks
        this.activeThoughtDetails.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block as HTMLElement);
        });

        // Remove references
        this.activeThoughtDetails = null;
        this.activeThoughtContent = null;
        this.activeThoughtRawText = "";
        this.thoughtTotalTime = 0;
    }

    private pauseThoughtTimer(): void {
        if (this.isThinking) {
            this.thoughtTotalTime += (Date.now() - this.thoughtStartTime);
            this.isThinking = false;

            // Update thought phrase
            if (this.activeThoughtDetails) {
                const summary = this.activeThoughtDetails.querySelector('summary');
                if (summary) {
                    summary.innerHTML = `
                        <div class="typing-indicator" style="display:inline-flex; margin-right: 8px;">
                            <span></span><span></span><span></span>
                        </div> 
                        <span>${this.getRandomThoughtPhrase()}</span>
                    `;
                }
            }
        }
    }

    private getRandomThoughtPhrase(): string {
        return THOUGHT_PHRASES[Math.floor(Math.random() * THOUGHT_PHRASES.length)];
    }

    // -----------------------------------------------------------------------------
    // ------------------------------- TOOLS SECTION -------------------------------
    // -----------------------------------------------------------------------------

    // Make new tool group, one tool group is assigned per response
    // All tool calls in a response will have 1 tool group
    public makeToolGroup(): void {
        if (!this.activeRunContent) return;
        this.removeTypingIndicator();
        // Maybe the agent thinks first then immediately uses tools
        // In this case the thought would have also ended
        this.pauseThoughtTimer();

        this.activeToolGroup = document.createElement('details');
        this.activeToolGroup.classList.add('tool-group');

        this.activeToolSummary = document.createElement('summary');
        this.activeToolSummary.innerHTML = `<div class="vscode-spinner"></div> Initializing tools...`;

        this.activeToolLogs = document.createElement('div');
        this.activeToolLogs.classList.add('tool-logs');

        this.activeToolGroup.appendChild(this.activeToolSummary);
        this.activeToolGroup.appendChild(this.activeToolLogs);
        this.activeRunContent.appendChild(this.activeToolGroup);
        this.scrollToBottom();
    }

    // Called when the agent executes a tool and on tool completion or error
    public updateToolGroup(msg: { status: string, toolId: string, toolName: string, args: any, error?: string }): void {
        if (!this.activeToolGroup) return;

        // Tool running
        let targetTool = this.activeTools.get(msg.toolId);
        if (msg.status === 'running') {
            if (this.activeToolSummary) {
                this.activeToolSummary.innerHTML = `<div class="tool-summary-content"><div class="vscode-spinner"></div> <span>Running <b>${msg.toolName}</b>...</span></div>`;
            }
            
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

                this.activeToolLogs!.appendChild(targetTool);
                this.activeTools.set(msg.toolId, targetTool);
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
        this.scrollToBottom();
    }

    public endToolGroup(msg: { customCount: number, serverCount: number, interrupted?: boolean }): void {
        if (!this.activeToolGroup || !this.activeToolSummary) return;

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
            this.activeToolSummary.innerHTML = `
                <div class="tool-summary-content">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M11.5672 9.91603L3.68064 17.8026C2.65578 18.8275 2.45813 20.2915 3.23918 21.0725C4.02023 21.8535 5.48421 21.6559 6.50906 20.631L14.3956 12.7445" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M18.1588 3.32443L15.2376 6.24562C14.9168 6.56645 15.5113 7.23834 16.2923 8.01938C17.0734 8.80043 17.7452 9.39487 18.0661 9.07404L20.9873 6.15285" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M18.1474 3.33589C17.6014 3.13128 17.0102 3.01938 16.3928 3.01938C13.6314 3.01938 11.3928 5.25796 11.3928 8.01938C11.3928 8.63676 11.5047 9.22801 11.7093 9.77394M21.0763 6.26483C21.2809 6.81076 21.3928 7.40201 21.3928 8.01938C21.3928 10.7808 19.1542 13.0194 16.3928 13.0194C15.7754 13.0194 15.1842 12.9075 14.6382 12.7029" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
                    <span>Execution Halted</span>
                    <div class="tool-summary-badges">
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M11.5672 9.91603L3.68064 17.8026C2.65578 18.8275 2.45813 20.2915 3.23918 21.0725C4.02023 21.8535 5.48421 21.6559 6.50906 20.631L14.3956 12.7445" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M18.1588 3.32443L15.2376 6.24562C14.9168 6.56645 15.5113 7.23834 16.2923 8.01938C17.0734 8.80043 17.7452 9.39487 18.0661 9.07404L20.9873 6.15285" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M18.1474 3.33589C17.6014 3.13128 17.0102 3.01938 16.3928 3.01938C13.6314 3.01938 11.3928 5.25796 11.3928 8.01938C11.3928 8.63676 11.5047 9.22801 11.7093 9.77394M21.0763 6.26483C21.2809 6.81076 21.3928 7.40201 21.3928 8.01938C21.3928 10.7808 19.1542 13.0194 16.3928 13.0194C15.7754 13.0194 15.1842 12.9075 14.6382 12.7029" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
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
            this.activeToolSummary.innerHTML = summaryHTML;
        }

        // clear tool references
        this.activeToolGroup = null;
        this.activeToolSummary = null;
        this.activeToolLogs = null;
        this.activeTools.clear();
        this.toolErrorCount = 0;
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
    // -----------------------------------------------------------------------------
    // ------------------------------- PATCH SECTION -------------------------------
    // -----------------------------------------------------------------------------

    public makePatchReview(patchString: string): void {
        // if (!this.activeRunContent) return;
        this.removeTypingIndicator();

        const {files, totalAdditions, totalDeletions} = this.parsePatch(patchString);
        if (files.length === 0) return;

        this.activePatchContainer = document.createElement('div');
        this.activePatchContainer.classList.add('patch-review-container');

        // Header contains all line insertions, deletions, file creations, deletions 
        const summaryHeader = document.createElement('div');
        summaryHeader.classList.add('patch-summary-header');

        const summaryText = document.createElement('div');
        summaryText.classList.add('patch-summary-text');

        summaryText.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M9 6C9 7.65685 7.65685 9 6 9C4.34315 9 3 7.65685 3 6C3 4.34315 4.34315 3 6 3C7.65685 3 9 4.34315 9 6Z" stroke="#bdbdbd" stroke-width="2"></path> <path d="M9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.3431 4.34315 15 6 15C7.65685 15 9 16.3431 9 18Z" stroke="#bdbdbd" stroke-width="2"></path> <path d="M21 18C21 19.6569 19.6569 21 18 21C16.3431 21 15 19.6569 15 18C15 16.3431 16.3431 15 18 15C19.6569 15 21 16.3431 21 18Z" stroke="#bdbdbd" stroke-width="2"></path> <path d="M12 6C14.8284 6 16.2426 6 17.1213 6.87868C18 7.75736 18 9.17157 18 12V15" stroke="#bdbdbd" stroke-width="2"></path> <path d="M15 3L12.0605 5.93945V5.93945C12.0271 5.97289 12.0271 6.02711 12.0605 6.06055V6.06055L15 9" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M6 15V9" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
            <span><b>Staged Changes:</b> ${files.length} file${files.length > 1 ? 's' : ''} 
            <span class="patch-stat-add">+${totalAdditions}</span> 
            <span class="patch-stat-del">-${totalDeletions}</span></span>
        `;

        // apply or discard patch action
        const actionsContainer = document.createElement('div');
        actionsContainer.classList.add('patch-actions');

        const discardBtn = document.createElement('button');
        discardBtn.classList.add('patch-btn', 'discard-btn');
        discardBtn.textContent = 'Discard';
        discardBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'discardChanges' });
        };

        const applyBtn = document.createElement('button');
        applyBtn.classList.add('patch-btn', 'apply-btn');
        applyBtn.textContent = 'Apply';
        applyBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'applyChanges' });
        };

        actionsContainer.appendChild(discardBtn);
        actionsContainer.appendChild(applyBtn);

        summaryHeader.appendChild(summaryText);
        summaryHeader.appendChild(actionsContainer);

        // File list with details
        const fileList = document.createElement('div');
        fileList.classList.add('patch-file-list', 'hidden');

        files.forEach((file: ParsedPatchFile) => {
            const fileItem = document.createElement('div');
            fileItem.classList.add('patch-file-item');

            let statusIcon = '';
            if (file.isNew) statusIcon = `<span class="file-status-icon added">A</span>`;
            else if (file.isDeleted) statusIcon = `<span class="file-status-icon deleted">D</span>`;
            else statusIcon = `<span class="file-status-icon modified">M</span>`;

            fileItem.innerHTML = `
                <div class="file-item-left">
                    ${statusIcon}
                    <span class="file-name">${file.filename}</span>
                </div>
                <div class="file-item-right">
                    ${file.additions > 0 ? `<span class="patch-stat-add">+${file.additions}</span>` : ''}
                    ${file.deletions > 0 ? `<span class="patch-stat-del">-${file.deletions}</span>` : ''}
                </div>
            `;

            fileItem.onclick = () => {
                this.vscodeAPI.postMessage({ type: 'openDiffView', file: file.filename });
            };

            fileList.appendChild(fileItem);
        });

        // Open the file list when clicking the summary header
        summaryHeader.onclick = () => fileList.classList.toggle('hidden');

        this.activePatchContainer.appendChild(summaryHeader);
        this.activePatchContainer.appendChild(fileList);

        if (this.activeRunContent) this.activeRunContent.appendChild(this.activePatchContainer);
        // If we restart the extension without applying the patch, then we should persist it
        else this.container.appendChild(this.activePatchContainer);
        this.scrollToBottom();
    }

    private parsePatch(patchString: string): ParsedPatchResult {
        const lines = patchString.split('\n');
        const files: ParsedPatchFile[] = [];
        let currentFile: ParsedPatchFile | null = null;

        let totalAdditions = 0;
        let totalDeletions = 0;

        for (const line of lines) {

            // Begin parsing new file
            if (line.startsWith('diff --git')) {
                const match = line.match(/b\/(.+)$/);
                const filename = match ? match[1] : 'unknown';

                currentFile = { filename, additions: 0, deletions: 0, isNew: false, isDeleted: false };
                files.push(currentFile);
            }

            // Update current file
            else if (currentFile) {
                if (line.startsWith('new file mode')) currentFile.isNew = true;                     // added
                else if (line.startsWith('deleted file mode')) currentFile.isDeleted = true;        // deleted
                else if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentFile.additions++;  // insertion
                    totalAdditions++;
                }
                else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentFile.deletions++;  // deletion
                    totalDeletions++;
                }
            }
        }

        return {files, totalAdditions, totalDeletions};
    }

    public updatePatchStatus(status: 'accepted' | 'rejected' | 'conflict'): void {
        if (!this.activePatchContainer) return;

        const summaryHeader = this.activePatchContainer.querySelector('.patch-summary-header') as HTMLElement;
        const actionsContainer = this.activePatchContainer.querySelector('.patch-actions') as HTMLElement;

        if (summaryHeader && actionsContainer) {
            // We do not close the accordion for a conflict
            if (status === 'conflict') {
                this.renderConflictUI(actionsContainer);
                return; 
            }
            // Disable the patch container after decision
            actionsContainer.innerHTML = '';

            const badge = document.createElement('span');
            
            const cssStatus = status === 'accepted' ? 'status-ok' : 'status-error';
            badge.classList.add('status-highlight', cssStatus);
            badge.textContent = status === 'accepted' ? 'Applied' : 'Discarded';

            actionsContainer.appendChild(badge);
            summaryHeader.style.cursor = 'default';
            summaryHeader.onclick = null;
        }

        // close the file list
        const fileList = this.activePatchContainer.querySelector('.patch-file-list');
        if (fileList) fileList.remove();

        this.activePatchContainer = null;
    }

    private renderConflictUI(actionsContainer: HTMLElement): void {
        actionsContainer.innerHTML = '';

        const badge = document.createElement('span');
        badge.classList.add('status-highlight', 'status-warning');
        badge.textContent = 'Merge Conflict';
        
        const forceBtn = document.createElement('button');
        forceBtn.classList.add('patch-btn', 'discard-btn');
        forceBtn.textContent = 'Force Apply';
        forceBtn.title = 'Overwrite conflicts with agent changes';
        forceBtn.onclick = (e) => { e.stopPropagation(); this.vscodeAPI.postMessage({ type: 'forceApplyPatch' }); };

        const resolveBtn = document.createElement('button');
        resolveBtn.classList.add('patch-btn', 'apply-btn');
        resolveBtn.textContent = 'Mark Resolved';
        resolveBtn.title = 'Accept changes after manual resolution in VS Code';
        resolveBtn.onclick = (e) => { e.stopPropagation(); this.vscodeAPI.postMessage({ type: 'markResolved' }); };
        
        // Tiny discard 'X' just in case they decide to completely cancel the whole thing
        const discardBtn = document.createElement('button');
        discardBtn.classList.add('patch-btn', 'discard-btn');
        discardBtn.innerHTML = '&#10006;'; 
        discardBtn.title = 'Discard completely';
        discardBtn.style.padding = '4px 6px';
        discardBtn.onclick = (e) => { e.stopPropagation(); this.vscodeAPI.postMessage({ type: 'discardChanges' }); };

        actionsContainer.appendChild(badge);
        actionsContainer.appendChild(forceBtn);
        actionsContainer.appendChild(resolveBtn);
        actionsContainer.appendChild(discardBtn);
    }

    // -----------------------------------------------------------------------------
    // ------------------------------- UTILS SECTION -------------------------------
    // -----------------------------------------------------------------------------

    public clearChatUI(): void {
        this.container.innerHTML = '';
        this.scrollToBottom();
    }
    
    public showTypingIndicator(): void {
        if (!this.activeRunContent) return;
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'agent');
        msgDiv.id = 'typingIndicator';
        msgDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        this.activeRunContent.appendChild(msgDiv);
        this.scrollToBottom();
    }

    public removeActivePatchUI(): void {
        if (this.activePatchContainer) {
            this.activePatchContainer.remove();
            this.activePatchContainer = null;
        }
    }

    private scrollToBottom(): void {
        this.container.scrollTo({ top: this.container.scrollHeight, behavior: 'smooth' });
    }

    private removeTypingIndicator(): void {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }

    private parseMarkdown(text: string): string {
        return marked.parse(text, { 
            gfm: true, 
            breaks: false 
        }) as string;
    }

    public cancelActiveUI(): void {
        this.removeTypingIndicator();
        this.endStream();
        this.endThought();
        this.endToolGroup({ customCount: 0, serverCount: 0, interrupted: true });
        this.scrollToBottom();
    }

}