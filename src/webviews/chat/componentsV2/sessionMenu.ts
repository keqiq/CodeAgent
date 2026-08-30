import { WebviewApi } from "../../Webview";
import type { SessionMetadata } from "../../../session/agentSession";

export type SessionIndicatorStatus = 'unloaded' | 'ready' | 'running' | 'pending' | 'error';

interface SessionItemDOM {
    element: HTMLElement;
    titleSpan: HTMLElement;
    indicator: HTMLElement;
    metaSpan: HTMLElement;
    renameBtn: HTMLButtonElement;
    unloadBtn: HTMLButtonElement,
    actionGroup: HTMLElement,
    menuBtn: HTMLButtonElement,
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

    private activeSessionID: string | undefined = undefined;
    private loadedSessionIDs: Set<string> = new Set();
    private itemDomMap: Map<string, SessionItemDOM> = new Map();
    private groups: Map<SessionIndicatorStatus, StatusGroupConfig> = new Map();

    private triggerIndicator: HTMLElement;

    private groupCounts: Record<SessionIndicatorStatus, number> = {
        pending: 0,
        error: 0,
        running: 0,
        ready: 0,
        unloaded: 0
    };

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

        // Hidden typing indicator for when the active session is under going name generation
        this.triggerIndicator = document.createElement('div');
        this.triggerIndicator.className = 'typing-indicator hidden';
        this.triggerIndicator.innerHTML = '<span></span><span></span><span></span>';
        this.selectedText.after(this.triggerIndicator);

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

        this.initListeners();
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

    // Called whenever the manifest is updated
    public refreshSessions(sessions: SessionMetadata[], activeSessionID: string) {
        const incomingIDs = new Set(sessions.map(s => s.id));

        // Remove deleted sessions
        for (const [id] of this.itemDomMap.entries()) {
            if (!incomingIDs.has(id)) this.removeSession(id);
        }

        // Add new sessions or update existing ones
        sessions.forEach(session => {
            const isTargetActive = session.id === activeSessionID;
            if (!this.itemDomMap.has(session.id)) this.addSession(session, isTargetActive);
            else this.updateSession(session);
        });

        this.emptyItem.classList.toggle('hidden', sessions.length > 0);

        if (activeSessionID && this.itemDomMap.has(activeSessionID)) {
            this.setActiveSession(activeSessionID);
        }
    }

    // Add a session and make it the active session
    private addSession(session: SessionMetadata, isActive: boolean = false): void {
        if (this.itemDomMap.has(session.id)) return;

        const dom = this.createSessionElement(session);
        this.itemDomMap.set(session.id, dom);

        const status: SessionIndicatorStatus = isActive ? 'ready' : 'unloaded';
        dom.element.dataset.status = status;

        this.groupCounts[status]++;
        const group = this.groups.get(status);
        group?.itemsWrapper.prepend(dom.element);
        group?.container.classList.remove('hidden');

        if (isActive) this.setActiveSession(session.id);
    }  

    // Remove a session, free resources and update badge counts if needed
    private removeSession(sessionID: string): void {
        const dom = this.itemDomMap.get(sessionID);
        if (!dom) return;

        // Decrement status count
        const status = dom.element.dataset.status as SessionIndicatorStatus;
        if (this.groupCounts[status] > 0) {
            this.groupCounts[status]--;
            const group = this.groups.get(status);
            group?.container.classList.toggle('hidden', this.groupCounts[status] === 0);
        }
        this.updateBadge(status);

        // Clean up doms and references
        dom.element.remove();
        this.itemDomMap.delete(sessionID);
        this.loadedSessionIDs.delete(sessionID);
    }

    // Called when a run is completed or title is generated
    private updateSession(session: SessionMetadata): void {
        const dom = this.itemDomMap.get(session.id);
        if (!dom) return;

        // Update the session name
        dom.titleSpan.textContent = session.title;

        if (session.id === this.activeSessionID) this.selectedText.textContent = session.title;

        dom.metaSpan.textContent = `Updated ${this.formatTimestamp(session.updatedAt)}`;
    }

    public setActiveSession(sessionID: string): void {

        const nextDom = this.itemDomMap.get(sessionID);
        if (!nextDom) return;
        
        // Remove .selected from the previous active session
        if (this.activeSessionID && this.activeSessionID !== sessionID) {
            const prevDom = this.itemDomMap.get(this.activeSessionID);
            prevDom?.element.classList.remove('selected');
        }

        // Add .selected to the new active session
        nextDom.element.classList.add('selected');
        if (nextDom.element.dataset.status === 'unloaded') this.setSessionStatus(sessionID, 'ready');

        // Sync header indicator visibility with the active session's generation state
        const isGenerating = !nextDom.indicator.classList.contains('hidden');
        this.selectedText.classList.toggle('hidden', isGenerating);
        this.triggerIndicator.classList.toggle('hidden', !isGenerating);

        this.loadedSessionIDs.add(sessionID);
        this.activeSessionID = sessionID;
        this.selectedText.textContent = nextDom.titleSpan.textContent;
    }

    // Called when a session's status changes
    public setSessionStatus(sessionID: string, targetStatus: SessionIndicatorStatus): void {
        const dom = this.itemDomMap.get(sessionID);
        if (!dom) return;

        const prevStatus = dom.element.dataset.status as SessionIndicatorStatus;
        if (prevStatus === targetStatus) return;

        // Decrement previous category
        if (this.groupCounts[prevStatus] > 0) {
            this.groupCounts[prevStatus]--;
            const prevGroup = this.groups.get(prevStatus);
            // If previous group is now empty hide it
            if (prevGroup) prevGroup.container.classList.toggle('hidden', this.groupCounts[prevStatus] === 0);
        }

        // Increment updated target category and move dom element into that group container
        this.groupCounts[targetStatus]++;
        const targetGroup = this.groups.get(targetStatus);
        if (targetGroup) {
            targetGroup.itemsWrapper.prepend(dom.element);
            targetGroup.container.classList.remove('hidden');
        }
        dom.element.dataset.status = targetStatus;

        // Update badge counter
        this.updateBadge(prevStatus);
        this.updateBadge(targetStatus);
    }

    // Called when an inactive chat is selected from dropdown
    // Change the session to the active state
    public markSessionLoaded(sessionID: string): void {
        this.loadedSessionIDs.add(sessionID);
        const dom = this.itemDomMap.get(sessionID);
        if (dom && dom.element.dataset.status === 'unloaded') {
            this.setSessionStatus(sessionID, 'ready');
        }

    }

    // Called when an active non running or pending session is unloaded
    // Change the session to the unloaded state
    public markSessionUnloaded(sessionID: string): void {
        this.loadedSessionIDs.delete(sessionID);
        this.setSessionStatus(sessionID, 'unloaded');
    }

    private createSessionElement(session: SessionMetadata): SessionItemDOM {
        const item = document.createElement('div');
        item.className = 'dropdown-item session-item';
        item.dataset.sessionId = session.id;
        item.dataset.status = 'unloaded';

        // Info Column
        const infoContainer = document.createElement('div');
        infoContainer.className = 'session-info';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'session-item-title';
        titleSpan.textContent = session.title || 'Untitled Chat';

        // Hidden typing indicator for when the session is under going name generation
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator hidden';
        indicator.innerHTML = '<span></span><span></span><span></span>';

        const metaSpan = document.createElement('span');
        metaSpan.className = 'session-item-meta';
        metaSpan.textContent = session.updatedAt ? `Updated ${this.formatTimestamp(session.updatedAt)}` : '';

        infoContainer.appendChild(titleSpan);
        infoContainer.appendChild(indicator);
        infoContainer.appendChild(metaSpan);

        // Actions Column
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'session-item-actions';

        // Menu trigger button (shown by default)
        const menuBtn = document.createElement('button');
        menuBtn.className = 'icon-btn session-action-btn session-menu-trigger';
        menuBtn.title = 'More Actions';
        menuBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
            </svg>
        `;

        // Action buttons Group (hidden by default)
        const actionGroup = document.createElement('div');
        actionGroup.className = 'session-action-group hidden';

        const renameBtn = document.createElement('button');
        renameBtn.className = 'icon-btn session-action-btn';
        renameBtn.title = 'Rename Chat';
        renameBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.49 1.49-3 1.51zM6.14 11.28l-.42-.42L12.5 4.08l.42.42-6.78 6.78zM13.64 3.79l-.42-.42.71-.71.42.42-.71.71z"/>
            </svg>
        `;

        const unloadBtn = document.createElement('button');
        unloadBtn.className = 'icon-btn session-action-btn unload';
        unloadBtn.title = 'Unload Session';
        unloadBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v4h2.5a.5.5 0 0 1 .354.854l-4 4a.5.5 0 0 1-.708 0l-4-4A.5.5 0 0 1 4.5 6.5H7v-4zM2 13.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
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

        actionGroup.appendChild(renameBtn);
        actionGroup.appendChild(unloadBtn);
        actionGroup.appendChild(deleteBtn);

        actionsContainer.appendChild(menuBtn);
        actionsContainer.appendChild(actionGroup);

        item.appendChild(infoContainer);
        item.appendChild(actionsContainer);

        const domRef: SessionItemDOM = {
            element: item,
            titleSpan,
            indicator,
            metaSpan,
            renameBtn,
            unloadBtn,
            actionGroup,
            menuBtn
        };

        // Switch session
        item.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            if (session.id !== this.activeSessionID) {
                this.close();
                this.vscodeAPI.postMessage({ type: 'switchSession', sessionID: session.id });
            }
        });

        //  Toggle the session's action group
        menuBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            menuBtn.classList.add('hidden');
            actionGroup.classList.remove('hidden');
        });

        // Reset menu on mouseleave
        item.addEventListener('mouseleave', () => {
            actionGroup.classList.add('hidden');
            menuBtn.classList.remove('hidden');
        });

        // Rename Event
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

        // Unload Event
        unloadBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'unloadSession', sessionID: session.id });
        });

        // Delete Event
        deleteBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'deleteSession', sessionID: session.id });
        });

        return domRef;
    }

    public setTitleGenerating(sessionID: string, isGenerating: boolean): void {
        const dom = this.itemDomMap.get(sessionID);
        if (!dom) return;
        
        // Disable rename during title generation
        dom.renameBtn.disabled = isGenerating;
        dom.renameBtn.classList.toggle('disabled', isGenerating);
        
        // Hide the title and show typing indicator inside session list
        dom.titleSpan.classList.toggle('hidden', isGenerating);
        dom.indicator.classList.toggle('hidden', !isGenerating);

        // Hide the title and show typing indicator in the header if the active session
        if (sessionID === this.activeSessionID) {
            this.selectedText.classList.toggle('hidden', isGenerating);
            this.triggerIndicator.classList.toggle('hidden', !isGenerating);
        }
    }

    // Change the overview status counts in the header
    private updateBadge(status: SessionIndicatorStatus): void {
        const count = this.groupCounts[status];

        if (status === 'pending' && this.badgePending && this.countPending) {
            this.countPending.textContent = String(count);
            this.badgePending.classList.toggle('hidden', count === 0);
        } else if (status === 'running' && this.badgeRunning && this.countRunning) {
            this.countRunning.textContent = String(count);
            this.badgeRunning.classList.toggle('hidden', count === 0);
        } else if (status === 'error' && this.badgeError && this.countError) {
            this.countError.textContent = String(count);
            this.badgeError.classList.toggle('hidden', count === 0);
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