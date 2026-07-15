import { ChatItem } from "../../apis/chat/chatProvider";
import { WebviewApi } from "../frontend";
import { marked } from 'marked';
import hljs from 'highlight.js';

import 'highlight.js/styles/vs2015.css';

export class ChatContainer {
    private container: HTMLElement;
    private scrollToBottomBtn: HTMLButtonElement;

    private activeStreamDiv: HTMLElement | null = null;
    private activeStreamRawText: string = "";

    private activeToolGroup: HTMLDetailsElement | null = null;
    private activeToolSummary: HTMLElement | null = null;
    private activeToolLogs: HTMLElement | null = null;
    private activeTool: HTMLElement | null = null;
    private toolErrorCount: number = 0;

    private activeThoughtDetails: HTMLDetailsElement | null = null;
    private activeThoughtContent: HTMLElement | null = null;
    private activeThoughtRawText: string = '';
    private thoughtStartTime: number = 0;

    constructor(private vscodeAPI: WebviewApi) {
        this.container = document.getElementById('chatContainer') as HTMLElement;
        this.scrollToBottomBtn = document.getElementById('scrollToBottomBtn') as HTMLButtonElement;

        this.initListeners();
    }

    private initListeners() {

        // Toggle scroll to bottom button based on container scroll distance to bottom
        this.container.addEventListener('scroll', () => {
            const distanceToBottom = this.container.scrollHeight - this.container.scrollTop + this.container.clientHeight;
            if (distanceToBottom > 50) this.scrollToBottomBtn.classList.add('visible');
            else this.scrollToBottomBtn.classList.remove('visible');
        });

        this.scrollToBottomBtn.addEventListener('click', () => {
            this.scrollToBottom();
        });
    }

    // On extension reload, restore chat messages
    public restoreChatHistory(history: ChatItem[]): void {
        this.clearChatUI();

        if (history && history.length > 0) {
            history.forEach(m => {

                // I chose to only restore messages on extension reload to reduce clutter (and simpler)
                // So tool results and thought process will not persist on reload
                if (m.type === 'message') {
                    if (m.role === 'user' || m.role === 'assistant') this.appendMessage(m);
                }
            });
        }
    }

    // Used only during restoreChatHistory and for posting user messages
    // Also for error and abort messages!
    // Agent responses are streamed which uses streamMessage
    // Tool calls are contained inside tool groups so not here either
    public appendMessage(msg: Extract<ChatItem, { type: 'message' }>): void {
        this.removeTypingIndicator();
        const text = msg.content || '';
        const role = msg.role;

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', role);

        // Do not add system messages to the chat window
        if (role === 'developer') return;

        // Agent messages, need markdown parsing and code highlight
        if (role === 'assistant') {
            msgDiv.innerHTML = this.parseMarkdown(text);
            msgDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block as HTMLElement);
            });
            this.container.appendChild(msgDiv);
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
            this.container.appendChild(msgDiv);
        }
        this.scrollToBottom();
    }

    public streamMessage(chunk: string): void {
        // I believe thought ends before the model responds with messages
        this.endThought();
        
        // Create new streaming div
        if (!this.activeStreamDiv) {
            this.removeTypingIndicator();
            this.activeStreamDiv = document.createElement('div');
            this.activeStreamDiv.classList.add('message', 'agent');
            this.container.appendChild(this.activeStreamDiv);
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

    public streamThought(chunk: string): void {
        this.removeTypingIndicator();

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
            this.container.appendChild(this.activeThoughtDetails);
        }

        this.activeThoughtRawText += chunk;
        this.activeThoughtContent!.innerHTML = this.parseMarkdown(this.activeThoughtRawText);
        this.scrollToBottom();
    }

    private endThought(): void {
        if (!this.activeThoughtDetails) return;

        // Update summary with thought duration
        const duration = ((Date.now() - this.thoughtStartTime) / 1000).toFixed(1);
        const summary = this.activeThoughtDetails.querySelector('summary');
        if (summary) summary.innerHTML = `<span>Thought for ${duration} seconds</span>`;

        // Highlight code blocks
        this.activeThoughtDetails.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block as HTMLElement);
        });

        // Remove references
        this.activeThoughtDetails = null;
        this.activeThoughtContent = null;
        this.activeStreamRawText = "";
    }

    // Make new tool group, one tool group is assigned per response
    // All tool calls in a response will have 1 tool group
    public makeToolGroup(): void {
        this.removeTypingIndicator();
        this.activeToolGroup = document.createElement('details');
        this.activeToolGroup.classList.add('tool-group');

        this.activeToolSummary = document.createElement('summary');
        this.activeToolSummary.innerHTML = `<div class="vscode-spinner"></div> Initializing tools...`;

        this.activeToolLogs = document.createElement('div');
        this.activeToolLogs.classList.add('tool-logs');

        this.activeToolGroup.appendChild(this.activeToolSummary);
        this.activeToolGroup.appendChild(this.activeToolLogs);
        this.container.appendChild(this.activeToolGroup);
        this.scrollToBottom();
    }

    // Called when the agent executes a tool and on tool completion or error
    public updateToolGroup(msg: { status: string, toolName: string, args: any, error?: string }): void {
        if (!this.activeToolGroup) return;

        // Tool running
        if (msg.status === 'running') {
            if (this.activeToolSummary) this.activeToolSummary.innerHTML = `<div class="vscode-spinner"></div> Running <b>${msg.toolName}</b>...`;
            
            this.activeTool = document.createElement('div');
            this.activeTool.classList.add('tool-log-entry');

            const displayArgs = this.formatToolArgs(msg.args);

            this.activeTool.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <span class="tool-icon log-running" style="margin-right: 4px;">⏳</span> 
                    <b>${msg.toolName}</b>
                </div>
                ${displayArgs}
            `;
            this.activeToolLogs!.appendChild(this.activeTool);
        }
        // Tool completion
        else if (msg.status === 'success') {
            if (this.activeTool) {
                const icon = this.activeTool.querySelector('.tool-icon');
                if (icon) {
                    icon.classList.replace('log-running', 'log-success');
                    icon.textContent = '✔';
                }
            }
        }
        // Tool error
        else if (msg.status === 'error') {
            this.toolErrorCount++;
            if (this.activeTool) {
                this.activeTool.classList.add('log-error');
                const icon = this.activeTool.querySelector('.tool-icon');
                if (icon) {
                    icon.classList.replace('log-running', 'log-error');
                    icon.textContent = '✖';
                }
                this.activeTool.innerHTML += `<div style="margin-left: 18px; margin-top: 4px; opacity: 0.9;">${msg.error}</div>`;
            }
        }
        this.scrollToBottom();
    }

    public endToolGroup(msg: { totalCount: number, interrupted?: boolean }): void {
        if (!this.activeToolGroup || !this.activeToolSummary) return;

        // If tool calls were interrupted by user
        if (msg.interrupted) {
            // Handle the actively running tool that got cut off
            if (this.activeTool) {
                this.activeTool.classList.add('log-error');
                const icon = this.activeTool.querySelector('.tool-icon');
                if (icon) {
                    icon.classList.replace('log-running', 'log-error');
                    icon.textContent = '🛑';
                }
                this.activeTool.innerHTML += `<div style="margin-left: 18px; margin-top: 4px; opacity: 0.9;">Halted</div>`;
            }
            this.activeToolSummary.innerHTML = '⚠️ Execution halted';
        } 
        
        // Tool calls all completed
        else {
            if (this.toolErrorCount > 0) this.activeToolSummary.textContent = `⚠️ Completed with ${this.toolErrorCount} error(s)`;
            else this.activeToolSummary.textContent = `✅ ${msg.totalCount} tool(s) executed successfully`;
        }

        // clear tool references
        this.activeToolGroup = null;
        this.activeToolSummary = null;
        this.activeToolLogs = null;
        this.activeTool = null;
        this.toolErrorCount = 0;
    }

    public clearChatUI(): void {
        this.container.innerHTML = '';
        this.scrollToBottom();
    }
    
    public showTypingIndicator(): void {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'agent');
        msgDiv.id = 'typingIndicator';
        msgDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        this.container.appendChild(msgDiv);
        this.scrollToBottom();
    }

    private formatToolArgs(args: any): string {
        try {
            const parsed = typeof args === 'string' ? JSON.parse(args) : args;

            if (!parsed || Object.keys(parsed).length === 0) return '';

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
        this.endToolGroup({ totalCount: 0, interrupted: true });
        this.scrollToBottom();
    }

}