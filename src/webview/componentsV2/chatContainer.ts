
import { WebviewApi } from "../frontend";
import { ChatItem } from "../../contextManager";
import { ExecuteContainer } from "./containers/execute";
import { ThoughtContainer } from "./containers/thought";
import { ToolsContainer } from "./containers/tools";
import { PatchContainer } from "./containers/patch";
import { MessageContainer } from "./containers/message";
import { RunContainer } from "./containers/run";

export class ChatContainer {
    private container: HTMLElement;
    private scrollToBottomBtn: HTMLButtonElement;

    private runContainer: RunContainer | null = null;
    private messageContainer: MessageContainer | null = null;
    private thoughtContainer: ThoughtContainer | null = null;
    private toolsContainer: ToolsContainer | null = null;
    private patchContainer: PatchContainer | null = null;
    private executeContainer: ExecuteContainer | null = null;

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
                        this.addMessage(m);
                        this.startRun();
                        this.removeTypingIndicator();
                    }
                    
                    else if (m.role === 'assistant') this.addMessage(m);
                }
                
                else if (m.type === 'run_summary') {
                    if (m.tokenUsage) this.updateRun(m.tokenUsage);
                    this.endRun(m.status, m.message);
                }
            });
            
            if (this.runContainer) this.endRun('ok'); // In case a run_summary wasn't saved due to crash
        }
    }

    // -----------------------------------------------------------------------------
    // -------------------------- RUN CONTAINER SECTION ----------------------------
    // -----------------------------------------------------------------------------

    public startRun(): void {
        this.endMessage();
        this.runContainer = new RunContainer(this.container);
        this.showTypingIndicator();
    }

    public updateRun(usage: any): void {
        if (this.runContainer) this.runContainer.update(usage);
    }

    public endRun(status: 'ok' | 'aborted' | 'error', message?: string): void {
        this.endThought();
        this.endMessage();
        if (this.runContainer) this.runContainer.end(status, message);
        this.runContainer = null;
    }

    // -----------------------------------------------------------------------------
    // ------------------------------ MESSAGE SECTION ------------------------------
    // -----------------------------------------------------------------------------

    public addMessage(msg: any): void {
        if (this.patchContainer) this.patchContainer.end();
        if (!this.messageContainer) this.messageContainer = new MessageContainer(this.runContainer?.activeRunContent || this.container);
        this.messageContainer.add(msg);
    }

    public updateMessage(chunk: string): void {
        if (this.thoughtContainer) this.thoughtContainer.pauseThoughtTimer();
        if (!this.messageContainer) this.messageContainer = new MessageContainer(this.runContainer?.activeRunContent || this.container);
        this.messageContainer.streamUpdate(chunk);
    }

    public endMessage(): void {
        if (this.messageContainer) this.messageContainer.end();
        this.messageContainer = null;
    }

    // -----------------------------------------------------------------------------
    // ------------------------------ THOUGHT SECTION ------------------------------
    // -----------------------------------------------------------------------------

    public updateThought(chunk: string): void {
        this.removeTypingIndicator();
        if (!this.thoughtContainer) this.thoughtContainer = new ThoughtContainer(this.runContainer?.activeRunContent || this.container);
        this.thoughtContainer.streamUpdate(chunk);
    }

    private endThought(): void {
        if (this.thoughtContainer) this.thoughtContainer.end();
        this.thoughtContainer = null;
    }

    // -----------------------------------------------------------------------------
    // ------------------------------- TOOLS SECTION -------------------------------
    // -----------------------------------------------------------------------------

    public updateTools(msg: any): void {
        this.removeTypingIndicator();
        if (!this.toolsContainer) this.toolsContainer = new ToolsContainer(this.runContainer?.activeRunContent || this.container);
        this.toolsContainer.update(msg);
    }

    public endTools(msg: any): void {
        if (this.toolsContainer) this.toolsContainer.end(msg);
        this.toolsContainer = null;
    }

    // -----------------------------------------------------------------------------
    // ------------------------------- PATCH SECTION -------------------------------
    // -----------------------------------------------------------------------------
    public makePatch(patch: string) {
        this.patchContainer = new PatchContainer(this.runContainer?.activeRunContent || this.container, patch, this.vscodeAPI);
    }

    public updatePatch(status: any) {
        if (this.patchContainer) this.patchContainer.update(status);
    }

    // -----------------------------------------------------------------------------
    // ------------------------------ EXECUTION SECTION ----------------------------
    // -----------------------------------------------------------------------------
    public updateExecute(msg: any) {
        this.removeTypingIndicator();
        if (!this.executeContainer) this.executeContainer = new ExecuteContainer(this.runContainer?.activeRunContent || this.container, this.vscodeAPI);
        this.executeContainer.update(msg);
    }

    public endExecute(msg: any) {
        if (this.executeContainer) this.executeContainer.end(msg);
        this.executeContainer = null;
    }

    // -----------------------------------------------------------------------------
    // ------------------------------- UTILS SECTION -------------------------------
    // -----------------------------------------------------------------------------

    public clearChatUI(): void {
        this.container.innerHTML = '';
        this.scrollToBottom();
    }
    
    public showTypingIndicator(): void {
        if (!this.runContainer) return;
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'agent');
        msgDiv.id = 'typingIndicator';
        msgDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        this.runContainer.activeRunContent.appendChild(msgDiv);
        this.scrollToBottom();
    }

    private scrollToBottom(): void {
        this.container.scrollTo({ top: this.container.scrollHeight, behavior: 'smooth' });
    }

    private removeTypingIndicator(): void {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }

    public cancelActiveUI(): void {
        this.removeTypingIndicator();
        this.endMessage();
        this.endThought();
        this.endTools({ customCount: 0, serverCount: 0, interrupted: true });
        this.endExecute({ interrupted: true });
        this.scrollToBottom();
    }

}