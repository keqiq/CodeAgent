import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { AgentSession, SessionMetadata, SessionPreferences, SharedSessionDeps } from "./agentSession";

export interface SessionManifest {
    activeSessionID: string | null;
    sessions: SessionMetadata[];
}

export class SessionManager {
    private sessions: Map<string, AgentSession> = new Map();
    private metadataMap: Map<string, SessionMetadata> = new Map();
    private activeSessionID: string | null = null;
    private manifestUri: vscode.Uri;

    private emitter = new vscode.EventEmitter<any>();
    public readonly onDidUpdateStatus = this.emitter.event;

    constructor(private readonly shared: SharedSessionDeps) {
        this.manifestUri = vscode.Uri.joinPath(this.shared.context.storageUri!, 'sessions.json');
    }

    public async initialize(): Promise<void> {
        await this.loadManifest();

        if (this.metadataMap.size === 0) {
            await this.createSession();
        } else {
            const targetID = (this.activeSessionID && this.metadataMap.has(this.activeSessionID))
                ? this.activeSessionID
                : this.metadataMap.keys().next().value!;
            await this.switchSession(targetID);
        }
    }

    private async loadManifest(): Promise<void> {
        try {
            const data = await vscode.workspace.fs.readFile(this.manifestUri);
            const parsed = JSON.parse(new TextDecoder().decode(data)) as SessionManifest;

            this.activeSessionID = parsed.activeSessionID || null;
            this.metadataMap.clear();

            if (Array.isArray(parsed.sessions)) {
                for (const meta of parsed.sessions) this.metadataMap.set(meta.id, meta);
            }

        } catch {
            this.activeSessionID = null;
            this.metadataMap.clear();
        }
    }

    public async saveManifest(): Promise<void> {
        const manifestData: SessionManifest = {
            activeSessionID: this.activeSessionID,
            // Maintain newest-first sorting by updatedAt
            sessions: Array.from(this.metadataMap.values()).sort((a, b) => b.updatedAt - a.updatedAt)
        };

        const data = new TextEncoder().encode(JSON.stringify(manifestData, null, 2));
        await vscode.workspace.fs.writeFile(this.manifestUri, data);

        this.emitter.fire({
            type: 'updateSessionList',
            activeSessionID: this.activeSessionID,
            sessions: manifestData.sessions
        });
    }

    public async createSession(title?: string): Promise<AgentSession> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const defaultProvider = this.shared.context.globalState.get<string>('chatProvider');
        const defaultModel = this.shared.context.globalState.get<string>(`${defaultProvider}_chatModel`);

        const metadata: SessionMetadata = {
            id,
            title: title || `Chat ${this.metadataMap.size + 1}`,
            createdAt: now,
            updatedAt: now,
        };

        const preferences = this.getDefaultPreferences();

        const session = new AgentSession(metadata, preferences, this.shared);
        session.onDidUpdateStatus(event => this.emitter.fire(event));
        await session.initialize();

        this.sessions.set(id, session);
        this.metadataMap.set(id, metadata);
        this.activeSessionID = id;

        await this.saveManifest();
        
        this.emitter.fire({
            type: 'sessionSwitched',
            sessionID: id,
            metadata,
            history: []
        });

        return session;
    }

    public async getOrLoadSession(sessionID: string): Promise<AgentSession | undefined> {
        if (this.sessions.has(sessionID)) {
            return this.sessions.get(sessionID);
        }

        const metadata = this.metadataMap.get(sessionID);
        const preferences = await this.loadSessionPreferences(sessionID);
        if (!metadata) return undefined;

        const session = new AgentSession(metadata, preferences, this.shared);
        session.onDidUpdateStatus(event => this.emitter.fire(event));
        await session.initialize();

        this.sessions.set(sessionID, session);
        return session;
    }

    public getActiveSession(): AgentSession | undefined {
        if (!this.activeSessionID) return undefined;
        return this.sessions.get(this.activeSessionID);
    }

    public getActiveSessionID(): string | null {
        return this.activeSessionID;
    }

    public getAllSessions(): SessionMetadata[] {
        return Array.from(this.metadataMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    public async switchSession(sessionID: string): Promise<AgentSession | undefined> {
        const session = await this.getOrLoadSession(sessionID);
        if (!session) return undefined;

        this.activeSessionID = sessionID;
        await this.saveManifest();

        this.emitter.fire({
            type: 'sessionSwitched',
            sessionID,
            metadata: session.metadata,
            history: session.contextManager.getHistory()
        });

        if (!session.isRunning()) {
            session.contextManager.estimateCategorizedTokens();
            await session.worktreeManager.displayPatch();
        }

        return session;
    }

    public async renameSession(sessionID: string, newTitle: string): Promise<void> {
        const metadata = this.metadataMap.get(sessionID);
        if (!metadata) return;

        metadata.title = newTitle;
        metadata.updatedAt = Date.now();
        await this.saveManifest();
    }

    public async deleteSession(sessionID: string): Promise<void> {
        if (!this.metadataMap.has(sessionID)) return;

        // Cleanup session resources
        const session = this.sessions.get(sessionID);
        if (session) {
            await session.cleanup();
            this.sessions.delete(sessionID);
        }

        // Delete session directory, history and artifacts
        const sessionDir = vscode.Uri.joinPath(this.shared.context.storageUri!, 'sessions', sessionID);
        try {
            await vscode.workspace.fs.delete(sessionDir, { recursive: true, useTrash: false });
        } catch {
            // Ignore if directory missing
        }

        this.metadataMap.delete(sessionID);

        // If we deleted the active session, create a new one
        if (this.activeSessionID === sessionID) {
            await this.createSession();
        } else {
            await this.saveManifest();
        }
    }

    private async loadSessionPreferences(sessionID: string): Promise<SessionPreferences> {
        const configUri = vscode.Uri.joinPath(this.shared.context.storageUri!, 'sessions', sessionID, 'config.json');

        try {
            const data = await vscode.workspace.fs.readFile(configUri);
            const saved = JSON.parse(new TextDecoder().decode(data)) as SessionPreferences;
            return saved;
        } catch {
            return this.getDefaultPreferences();
        }
    }

    private getDefaultPreferences(): SessionPreferences {
        const defaultProvider = this.shared.context.globalState.get<string>('chatProvider');
        const defaultModel = this.shared.context.globalState.get<string>(`${defaultProvider}_chatModel`);
        const defaultEffort = (defaultProvider && defaultModel)
            ? this.shared.context.globalState.get<string>(`${defaultProvider}_${defaultModel}_Effort`) || 'none'
            : 'none';

        return {
            provider: defaultProvider,
            model: defaultModel,
            effort: defaultEffort,
            showAll: this.shared.context.globalState.get<boolean>('showAllChatModels') ?? false,
            stateful: this.shared.context.globalState.get<boolean>('serverStateManagement') ?? true,
            turnLimit: this.shared.context.globalState.get<number>('turnLimit') ?? 0,
            webSearchEnabled: this.shared.context.globalState.get<boolean>('webSearchEnabled') ?? false,
            webSearchMode: this.shared.context.globalState.get<string>('webSearchMode') ?? 'tavily',
            pruneMode: this.shared.context.globalState.get<string>('pruneMode') ?? 'run',
            pruneTurnInterval: this.shared.context.globalState.get<number>('pruneTurnInterval') ?? 3,
            pruneRunInterval: this.shared.context.globalState.get<number>('pruneRunInterval') ?? 1,
            agentMode: this.shared.context.workspaceState.get<string>('agentMode') ?? 'manual'
        };
    }
}