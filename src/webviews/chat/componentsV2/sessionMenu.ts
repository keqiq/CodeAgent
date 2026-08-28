import { WebviewApi } from "../../Webview";
import type { SessionMetadata } from "../../../session/agentSession";

export type SessionIndicatorStatus = 'unloaded' | 'ready' | 'running' | 'pending' | 'error';

interface SessionItemDOM {
    element: HTMLElement;
    titleSpan: HTMLElement;
    metaSpan: HTMLElement;
    renameInput?: HTMLInputElement;
}

interface StatusGroupConfig {
    key: SessionIndicatorStatus;
    label: string;
    container: HTMLElement;
    itemsWrapper: HTMLElement;
}

const STATUS_PRIORITY: { key: SessionIndicatorStatus; label: string }[] = [
    { key: 'pending', label: 'Action Required' },
    { key: 'error', label: 'Errors' },
    { key: 'running', label: 'Running' },
    { key: 'ready', label: 'Ready' },
    { key: 'unloaded', label: 'Inactive' }
];

export class SessionSelector {
    private container: HTMLElement;
    private trigger: HTMLButtonElement;
    private selectedText: HTMLElement;
    private list: HTMLElement;
    private itemsContainer!: HTMLElement;
    private emptyItem!: HTMLElement;

    // Badges
    private badgePending: HTMLElement | null;
    private badgeRunning: HTMLElement | null;
    private badgeError: HTMLElement | null;
    private countPending: HTMLElement | null;
    private countRunning: HTMLElement | null;
    private countError: HTMLElement | null;

    private sessions: SessionMetadata[] = [];
    private activeSessionID: string | null = null;
    private loadedSessionIDs: Set<string> = new Set();
    private sessionStatusMap: Map<string, SessionIndicatorStatus> = new Map();
    private itemDomMap: Map<string, SessionItemDOM> = new Map();
    private groups: Map<SessionIndicatorStatus, StatusGroupConfig> = new Map();

    constructor(private vscodeAPI: WebviewApi) {
        this.container = document.getElementById('sessionDropdown') as HTMLElement;
        this.trigger = document.getElementById('sessionTrigger') as HTMLButtonElement;
        this.selectedText = document.getElementById('sessionSelectedText') as HTMLElement;
        this.list = document.getElementById('sessionList') as HTMLElement;

        this.badgePending = document.getElementById('badgePending');
        this.badgeRunning = document.getElementById('badgeRunning');
        this.badgeError = document.getElementById('badgeError');
        this.countPending = document.getElementById('countPending');
        this.countRunning = document.getElementById('countRunning');
        this.countError = document.getElementById('countError');

        this.initStaticDropdownLayout();
        this.initListeners();
    }

    private initStaticDropdownLayout(): void {
        this.list.innerHTML = '';

        // New chat button
        const newSessionItem = document.createElement('div');
        newSessionItem.className = 'dropdown-item session-new-btn';
        newSessionItem.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
            </svg>
            <span>New Chat</span>
        `;
        newSessionItem.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.close();
            this.vscodeAPI.postMessage({ type: 'createSession' });
        });
        this.list.appendChild(newSessionItem);

        // Session container
        this.itemsContainer = document.createElement('div');
        this.itemsContainer.className = 'session-items-container';
        this.list.appendChild(this.itemsContainer);

        // Categorized Section Containers
        STATUS_PRIORITY.forEach(({ key, label }) => {
            const groupContainer = document.createElement('div');
            groupContainer.className = `session-group session-group-${key} hidden`;

            // Group divider between sections
            const groupDivider = document.createElement('div');
            groupDivider.className = 'menu-divider group-divider';

            const header = document.createElement('div');
            header.className = 'session-group-header';
            header.textContent = label;

            const itemsWrapper = document.createElement('div');
            itemsWrapper.className = 'session-group-items';

            groupContainer.appendChild(groupDivider);
            groupContainer.appendChild(header);
            groupContainer.appendChild(itemsWrapper);
            this.itemsContainer.appendChild(groupContainer);

            this.groups.set(key, {
                key,
                label,
                container: groupContainer,
                itemsWrapper
            });
        });

        // Empty state placeholder
        this.emptyItem = document.createElement('div');
        this.emptyItem.className = 'dropdown-item disabled hidden';
        this.emptyItem.textContent = 'No active chats';
        this.itemsContainer.appendChild(this.emptyItem);
    }

    private initListeners(): void {
        this.trigger.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.toggle();
        });

        document.addEventListener('click', (e: MouseEvent) => {
            if (e.target instanceof Node && !this.container.contains(e.target)) {
                this.close();
            }
        });

        document.addEventListener('closeAllMenus', (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.source !== this) {
                this.close();
            }
        });
    }

    public updateSessions(sessions: SessionMetadata[], activeSessionID?: string | null): void {
        this.sessions = sessions;
        if (activeSessionID !== undefined) {
            this.activeSessionID = activeSessionID;
        }

        const incomingIDs = new Set(sessions.map(s => s.id));

        // Remove deleted sessions from DOM and map
        for (const [id, dom] of this.itemDomMap.entries()) {
            if (!incomingIDs.has(id)) {
                dom.element.remove();
                this.itemDomMap.delete(id);
                this.sessionStatusMap.delete(id);
                this.loadedSessionIDs.delete(id);
            }
        }

        // Update or create items and reconcile DOM order
        if (sessions.length === 0) {
            this.emptyItem.classList.remove('hidden');
            this.groups.forEach(g => g.container.classList.add('hidden'));
        } else {
            this.emptyItem.classList.add('hidden');

            sessions.forEach(session => {
                let dom = this.itemDomMap.get(session.id);

                if (!dom) {
                    dom = this.createSessionElement(session);
                    this.itemDomMap.set(session.id, dom);
                } else {
                    this.updateSessionElement(dom, session);
                }
            });
        }

        this.updateActiveTriggerText();
        this.updateSelectionState();
        this.rebuildGroupedLayout();
    }

    public setActiveSession(sessionID: string): void {
        this.activeSessionID = sessionID;
        this.markSessionLoaded(sessionID);
        this.updateActiveTriggerText();
        this.updateSelectionState();
    }

    public markSessionLoaded(sessionID: string): void {
        this.loadedSessionIDs.add(sessionID);
        if (!this.sessionStatusMap.has(sessionID)) {
            this.setSessionStatus(sessionID, 'ready');
        } else {
            this.rebuildGroupedLayout();
        }
    }

    public setSessionStatus(sessionID: string, status: SessionIndicatorStatus): void {
        this.sessionStatusMap.set(sessionID, status);
        this.rebuildGroupedLayout();
    }

    private getSessionEffectiveStatus(sessionID: string): SessionIndicatorStatus {
        const isLoaded = this.loadedSessionIDs.has(sessionID);
        return isLoaded ? (this.sessionStatusMap.get(sessionID) || 'ready') : 'unloaded';
    }

    private rebuildGroupedLayout(): void {
        const groupCounts: Record<SessionIndicatorStatus, number> = {
            pending: 0,
            error: 0,
            running: 0,
            ready: 0,
            unloaded: 0
        };

        this.sessions.forEach(session => {
            const dom = this.itemDomMap.get(session.id);
            if (!dom) return;

            const status = this.getSessionEffectiveStatus(session.id);
            dom.element.dataset.status = status;

            const group = this.groups.get(status);
            if (group) {
                group.itemsWrapper.appendChild(dom.element);
                groupCounts[status]++;
            }
        });

        // Toggle category containers
        this.groups.forEach((group, status) => {
            group.container.classList.toggle('hidden', groupCounts[status] === 0);
        });

        // Update badge counts and visibility
        this.updateStatusBadges(groupCounts);
    }

    private updateStatusBadges(counts: Record<SessionIndicatorStatus, number>): void {
        // Pending
        if (this.badgePending && this.countPending) {
            this.countPending.textContent = String(counts.pending);
            this.badgePending.classList.toggle('hidden', counts.pending === 0);
        }

        // Running
        if (this.badgeRunning && this.countRunning) {
            this.countRunning.textContent = String(counts.running);
            this.badgeRunning.classList.toggle('hidden', counts.running === 0);
        }

        // Error
        if (this.badgeError && this.countError) {
            this.countError.textContent = String(counts.error);
            this.badgeError.classList.toggle('hidden', counts.error === 0);
        }
    }

    private updateActiveTriggerText(): void {
        const current = this.sessions.find(s => s.id === this.activeSessionID);
        this.selectedText.textContent = current ? current.title : (this.sessions.length > 0 ? this.sessions[0].title : 'New Chat');
    }

    private updateSelectionState(): void {
        for (const [id, dom] of this.itemDomMap.entries()) {
            dom.element.classList.toggle('selected', id === this.activeSessionID);
        }
    }

    private formatTimestamp(ts: number): string {
        const date = new Date(ts);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    private updateSessionElement(dom: SessionItemDOM, session: SessionMetadata): void {
        if (!dom.renameInput) {
            dom.titleSpan.textContent = session.title || 'Untitled Chat';
        }
        dom.metaSpan.textContent = session.updatedAt ? `Updated ${this.formatTimestamp(session.updatedAt)}` : '';
    }

    private createSessionElement(session: SessionMetadata): SessionItemDOM {
        const item = document.createElement('div');
        item.className = 'dropdown-item session-item';
        item.dataset.sessionId = session.id;

        // Info Column
        const infoContainer = document.createElement('div');
        infoContainer.className = 'session-info';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'session-item-title';
        titleSpan.textContent = session.title || 'Untitled Chat';

        const metaSpan = document.createElement('span');
        metaSpan.className = 'session-item-meta';
        metaSpan.textContent = session.updatedAt ? `Updated ${this.formatTimestamp(session.updatedAt)}` : '';

        infoContainer.appendChild(titleSpan);
        infoContainer.appendChild(metaSpan);

        // Actions Column
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'session-item-actions';

        const renameBtn = document.createElement('button');
        renameBtn.className = 'icon-btn session-action-btn';
        renameBtn.title = 'Rename Chat';
        renameBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.49 1.49-3 1.51zM6.14 11.28l-.42-.42L12.5 4.08l.42.42-6.78 6.78zM13.64 3.79l-.42-.42.71-.71.42.42-.71.71z"/>
            </svg>
        `;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn session-action-btn delete';
        deleteBtn.title = 'Delete Chat';
        deleteBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9z"/>
            </svg>
        `;

        actionsContainer.appendChild(renameBtn);
        actionsContainer.appendChild(deleteBtn);

        item.appendChild(infoContainer);
        item.appendChild(actionsContainer);

        const domRef: SessionItemDOM = { element: item, titleSpan, metaSpan };

        // Switch Session Event
        item.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            if (session.id !== this.activeSessionID) {
                this.close();
                this.vscodeAPI.postMessage({ type: 'switchSession', sessionID: session.id });
            }
        });

        // Inline Rename Event
        renameBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'session-rename-input';
            input.value = titleSpan.textContent || '';
            domRef.renameInput = input;

            let isCommitted = false;
            const commitRename = () => {
                if (isCommitted) return;
                isCommitted = true;

                const sid = item.dataset.sessionId!;
                const newTitle = input.value.trim();
                domRef.renameInput = undefined;

                if (newTitle && newTitle !== titleSpan.textContent) {
                    titleSpan.textContent = newTitle;
                    this.vscodeAPI.postMessage({
                        type: 'renameSession',
                        sessionID: sid,
                        title: newTitle
                    });
                }
                if (infoContainer.contains(input)) {
                    infoContainer.replaceChild(titleSpan, input);
                }
            };

            input.addEventListener('click', (ev) => ev.stopPropagation());
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    commitRename();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    isCommitted = true;
                    domRef.renameInput = undefined;
                    if (infoContainer.contains(input)) {
                        infoContainer.replaceChild(titleSpan, input);
                    }
                }
            });
            input.addEventListener('blur', commitRename);

            infoContainer.replaceChild(input, titleSpan);
            input.focus();
            input.select();
        });

        // Delete Event
        deleteBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'deleteSession', sessionID: session.id });
        });

        return domRef;
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