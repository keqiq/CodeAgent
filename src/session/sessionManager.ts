import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { AgentSession, SessionConfigFile, SessionMetadata, SharedSessionDeps } from "./agentSession";
import { ChatFactory } from '../apis/chat/chatFactory';

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
            await this.switchSession(this.activeSessionID!);
        }
    }

    private attachSessionListeners(session: AgentSession): void {
        session.onDidUpdateStatus(async (event) => {
            // Intercept internal manifest updates
            if (event.type === 'updateManifest') {
                const meta = this.metadataMap.get(session.metadata.id);
                if (meta) {
                    if (event.title !== undefined) meta.title = event.title;
                    if (event.customTitle !== undefined) meta.customTitle = event.customTitle;
                    meta.updatedAt = Date.now();
                    await this.saveManifest();
                }
                return; // Prevent forwarding internal backend event to webview
            }

            // Forward session-scoped UI events with sessionID attached
            this.emitter.fire({
                ...event,
                sessionID: session.metadata.id
            });
        });
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

        const metadata: SessionMetadata = {
            id,
            title: title || `Chat ${this.metadataMap.size + 1}`,
            createdAt: now,
            updatedAt: now,
            customTitle: false
        };

        const config = this.getDefaultConfig();

        const session = new AgentSession(metadata, config.apiConfig, config.preferences, this.shared);
        this.attachSessionListeners(session);

        await session.initialize();
        await session.saveConfig();

        this.sessions.set(id, session);
        this.metadataMap.set(id, metadata);
        this.activeSessionID = id;

        await this.saveManifest();
        
        this.emitter.fire({
            type: 'sessionSwitched',
            sessionID: id
        });

        return session;
    }

    public async getOrLoadSession(sessionID: string): Promise<AgentSession | undefined> {
        if (this.sessions.has(sessionID)) {
            return this.sessions.get(sessionID);
        }

        const metadata = this.metadataMap.get(sessionID);
        if (!metadata) return undefined;

        const config = await this.loadSessionConfig(sessionID);

        const session = new AgentSession(metadata, config.apiConfig, config.preferences, this.shared);
        this.attachSessionListeners(session);
        
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
            sessionID
        });

        return session;
    }

    public async renameSession(sessionID: string, newTitle: string): Promise<void> {
        const metadata = this.metadataMap.get(sessionID);
        if (!metadata) return;

        metadata.title = newTitle;
        metadata.updatedAt = Date.now();
        metadata.customTitle = true;
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

    private async loadSessionConfig(sessionID: string): Promise<SessionConfigFile> {
        const configUri = vscode.Uri.joinPath(this.shared.context.storageUri!, 'sessions', sessionID, 'config.json');

        try {
            const data = await vscode.workspace.fs.readFile(configUri);
            const saved = JSON.parse(new TextDecoder().decode(data)) as Partial<SessionConfigFile>;
            const defaults = this.getDefaultConfig();
            return {
                apiConfig: {
                    provider: saved.apiConfig?.provider ?? defaults.apiConfig.provider,
                    providerModelConfig: saved.apiConfig?.providerModelConfig ?? defaults.apiConfig.providerModelConfig,
                    modelEffortConfig: saved.apiConfig?.modelEffortConfig ?? defaults.apiConfig.modelEffortConfig,
                },
                preferences: {
                    ...defaults.preferences,
                    ...(saved.preferences ?? {})
                }
            };
        } catch {
            return this.getDefaultConfig();
        }
    }

    private getDefaultConfig(): SessionConfigFile {
        return {
            apiConfig: {
                provider: this.shared.context.globalState.get<string>('chatProvider') || '',
                providerModelConfig: this.shared.context.globalState.get<Record<string, string>>('providerModelConfig') || {},
                modelEffortConfig: this.shared.context.globalState.get<Record<string, string>>('modelEffortConfig') || {}
            },
            preferences: {
                showAll: this.shared.context.globalState.get<boolean>('showAllChatModels') ?? false,
                stateful: this.shared.context.globalState.get<boolean>('serverStateManagement') ?? true,
                turnLimit: this.shared.context.globalState.get<number>('turnLimit') ?? 0,
                webSearchEnabled: this.shared.context.globalState.get<boolean>('webSearchEnabled') ?? false,
                webSearchMode: this.shared.context.globalState.get<string>('webSearchMode') ?? 'tavily',
                pruneMode: this.shared.context.globalState.get<string>('pruneMode') ?? 'run',
                pruneTurnInterval: this.shared.context.globalState.get<number>('pruneTurnInterval') ?? 3,
                pruneRunInterval: this.shared.context.globalState.get<number>('pruneRunInterval') ?? 1,
                agentMode: this.shared.context.workspaceState.get<string>('agentMode') ?? 'manual'
            }
        };
    }

    public async syncSessionUI(session: AgentSession): Promise<void> {
        const sid = session.metadata.id;
        const apiConfig = session.apiConfig;
        const prefs = session.preferences;
        const ollamaChatPort = this.shared.context.globalState.get<number>('ollamaChatPort') ?? 11434;

        this.emitter.fire({ type: 'sessionSwitched', sessionID: sid });

        // Restore session chat history
        this.emitter.fire({
            type: 'restoreChatHistory',
            sessionID: sid,
            history: session.contextManager.getHistory()
        });

        // Restore session chat settings
        this.emitter.fire({
            type: 'restoreChatSettings',
            sessionID: sid,
            showAll: prefs.showAll,
            stateful: prefs.stateful,
            turnLimit: prefs.turnLimit,
            webSearch: prefs.webSearchEnabled,
            searchMode: prefs.webSearchMode,
            ollamaPort: ollamaChatPort
        });

        // Restore session Context management setting
        this.emitter.fire({
            type: 'restorePruneSettings',
            sessionID: sid,
            mode: prefs.pruneMode,
            turnInterval: prefs.pruneTurnInterval,
            runInterval: prefs.pruneRunInterval
        });

        // Restore session agent mode setting
        this.emitter.fire({
            type: 'restoreAgentMode',
            sessionID: sid,
            mode: prefs.agentMode
        });

        // Restore session provider choice
        if (apiConfig.provider) {
            this.emitter.fire({
                type: 'updateChatProvider',
                sessionID: sid,
                provider: apiConfig.provider,
                stateful: ChatFactory.supportsStateManagement(apiConfig.provider),
                serverSearch: ChatFactory.supportsServerWebSearch(apiConfig.provider)
            });

            session.contextManager.estimateCategorizedTokens();
        }

        await session.worktreeManager.displayPatch();
    }
}
