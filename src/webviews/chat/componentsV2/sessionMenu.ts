import { WebviewApi } from "../../Webview";
import type { SessionMetadata } from "../../../session/agentSession";

export class SessionSelector {
    private container: HTMLElement;
    private trigger: HTMLButtonElement;
    private selectedText: HTMLElement;
    private list: HTMLElement;
    private newSessionBtn: HTMLButtonElement;

    private sessions: SessionMetadata[] = [];
    private activeSessionID: string | null = null;

    constructor(private vscodeAPI: WebviewApi) {
        this.container = document.getElementById('sessionDropdown') as HTMLElement;
        this.trigger = document.getElementById('sessionTrigger') as HTMLButtonElement;
        this.selectedText = document.getElementById('sessionSelectedText') as HTMLElement;
        this.list = document.getElementById('sessionList') as HTMLElement;
        this.newSessionBtn = document.getElementById('newSessionBtn') as HTMLButtonElement;

        this.initListeners();
    }

    private initListeners(): void {
        // Toggle session menu
        this.trigger.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.toggle();
        });

        // Create new session
        this.newSessionBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.close();
            this.vscodeAPI.postMessage({ type: 'createSession' });
        });

        // Close on clicking outside
        document.addEventListener('click', (e: MouseEvent) => {
            if (e.target instanceof Node && !this.container.contains(e.target)) {
                this.close();
            }
        });

        // Close when another menu opens
        document.addEventListener('closeAllMenus', (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.source !== this) {
                this.close();
            }
        });
    }

    public updateSessions(sessions: SessionMetadata[], activeSessionID?: string | null) {
        this.sessions = sessions;
        if (activeSessionID !== undefined) this.activeSessionID = activeSessionID;
        this.render();
    }

    public setActiveSession(sessionID: string): void {
        this.activeSessionID = sessionID;
        const current = this.sessions.find(s => s.id === sessionID);
        this.selectedText.textContent = current ? current.title : 'Select Chat...';
        this.renderListItems();
    }

    private render(): void {
        const current = this.sessions.find(s => s.id === this.activeSessionID);
        this.selectedText.textContent = current ? current.title : (this.sessions.length > 0 ? this.sessions[0].title : 'New Chat');
        this.renderListItems();
    }

    private renderListItems(): void {
        this.list.innerHTML = '';

        if (this.sessions.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'dropdown-item disabled';
            emptyItem.textContent = 'No active chats';
            this.list.appendChild(emptyItem);
            return;
        }

        this.sessions.forEach((session) => {
            const item = document.createElement('div');
            item.className = 'dropdown-item session-item';
            if (session.id === this.activeSessionID) {
                item.classList.add('selected');
            }

            const titleSpan = document.createElement('span');
            titleSpan.className = 'session-item-title';
            titleSpan.textContent = session.title || 'Untitled Chat';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'icon-btn session-delete-btn';
            deleteBtn.title = 'Delete Chat';
            deleteBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9z"/>
                </svg>
            `;

            // Switch session on item click
            item.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                if (session.id !== this.activeSessionID) {
                    this.close();
                    this.vscodeAPI.postMessage({ type: 'switchSession', sessionID: session.id });
                }
            });

            // Delete session
            deleteBtn.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                this.vscodeAPI.postMessage({ type: 'deleteSession', sessionID: session.id });
            });

            item.appendChild(titleSpan);
            item.appendChild(deleteBtn);
            this.list.appendChild(item);
        });
    }

    public toggle(): void {
        const willOpen = this.list.classList.contains('hidden');
        document.dispatchEvent(new CustomEvent('closeAllMenus', { detail: { source: this } }));
        if (willOpen) {
            this.list.classList.remove('hidden');
        } else {
            this.close();
        }
    }

    public close(): void {
        this.list.classList.add('hidden');
    }
}