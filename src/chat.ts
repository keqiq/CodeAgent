import * as vscode from 'vscode';
import * as fs from 'fs';
import path from 'path';
import { Indexer } from './indexing/indexer';
import { APIManager } from './managers/apiManager';
import { CommandManager } from './managers/commandManager';
import { SessionManager } from './session/sessionManager';
import { MCPManager } from './managers/mcpManager';
import { ChatFactory } from './apis/chat/chatFactory';
import { EmbedFactory } from './apis/embed/embedFactory';
import { AgentSession } from './session/agentSession';

export class ChatApp implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private workspaceRoot: string;

    private apiManager: APIManager;
    private commandManager: CommandManager;
    private sessionManager: SessionManager;

    private indexer?: Indexer;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly mcpManager: MCPManager
    ) {
        this.apiManager = new APIManager(context);
        this.apiManager.onDidUpdateStatus(event => this.post(event));

        this.commandManager = new CommandManager(context);
        this.commandManager.onDidUpdateStatus(event => this.post(event));

        // Don't even activate the extension outside of an active workspace there is no point
        // This is set in package.json in activationEvents
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath!;

        this.sessionManager = new SessionManager({
            context: this.context,
            apiManager: this.apiManager,
            commandManager: this.commandManager,
            mcpManager: this.mcpManager,
            workspaceRoot: this.workspaceRoot,
            getIndexer: () => this.indexer
        });
        this.sessionManager.onDidUpdateStatus(event => this.post(event));
    }

    // No session required
    private readonly globalHandlers: Record<string, (data: any) => Promise<void> | void> = {
        // Restore on reload
        webviewReady: async () => {
            try {
                
                // Global chat and embed provider lists
                this.post({ type: 'setChatProviders', providers: ChatFactory.getAvailableProviders() });
                this.post({ type: 'setEmbedProviders', providers: EmbedFactory.getAvailableProviders() });
                
                // Global workspace index settings
                const indexEnabled = this.context.globalState.get<boolean>('indexEnabled') ?? true;
                this.post({
                    type: 'restoreIndexSettings',
                    retrievalCount: this.context.globalState.get<number>('retrievalCount') ?? 10,
                    debounceTime: this.context.globalState.get<number>('debounceTime') ?? 10,
                    enabled: indexEnabled,
                    ollamaPort: this.context.globalState.get<number>('ollamaEmbedPort') ?? 11434
                });
                if (indexEnabled) {
                    const embedProvider = this.context.globalState.get<string>('embedProvider');
                    this.post({ type: 'updateEmbedProvider', provider: embedProvider });
                }
                
                // Global agent mode settings
                await this.commandManager.loadConfig();
                const currentConfig = this.commandManager.getConfig();
                this.post({
                    type: 'updateUnsafeFlag',
                    isUnsafe: currentConfig?.unsafeFullAutonomous ?? false
                });
                
                // Session specific settings
                await this.sessionManager.initialize();
                let activeSession = this.sessionManager.getActiveSession();

                this.post({ type: 'sessionSwitched', sessionID: activeSession!.metadata.id });

            } catch (e) {
                vscode.window.showErrorMessage(`Failed to restore state ${e}`);
            }
        },

        createSession: async () => {
            await this.sessionManager.createSession();
        },

        renameSession: async (data) => {
            if (data.sessionID && data.title) {
                await this.sessionManager.renameSession(data.sessionID, data.title);
            }
        },

        switchSession: async (data) => {
            await this.sessionManager.switchSession(data.sessionID);
        },

        deleteSession: async (data) => {
            await this.sessionManager.deleteSession(data.sessionID);
        },

        unloadSession: async (data) => {
            await this.sessionManager.unloadSession(data.sessionID);
        },

        // Called when selecting a new provider in embedding provider dropdown
        saveEmbedProvider: async (data) => {
            await this.apiManager.saveEmbedProvider(data.provider);
        },

        // Called after saveEmbedProvider and having a valid API key
        // Respond with a list of embedding models from the provider
        fetchEmbedModels: async (data) => {
            await this.apiManager.getEmbedModels(data.provider);
        },

        // Called when selecting a new embedding model from the dropdown
        saveEmbedModel: async (data) => {
            await this.apiManager.saveEmbedModel(data.provider, data.model);
        },

        // Called after selecting a new embedding model from the dropdown
        // Get a new indexer for the current model
        loadVectorDB: async (data) => {
            if (this.indexer) this.indexer.dispose();

            this.indexer = await Indexer.create(this.context, data.model, this.apiManager);
            this.indexer.onDidUpdateStatus(event => this.post(event));
            await this.indexer.broadcastCurrentState();
        },

        // Saves embedding key and refresh embedding models
        saveEmbedAPIKey: async (data) => {
            await this.apiManager.saveEmbedAPIKey(data.provider, data.key);
            await this.apiManager.getEmbedModels(data.provider);
        },

        // Saves ollama port (for embedding) and refresh embedding models
        saveEmbedPort: async (data) => {
            await this.apiManager.saveEmbedAPIKey('ollama', data.port);
            await this.apiManager.getEmbedModels('ollama');
        },

        // Disabling indexing will prevent any database queries, all calls to semantic search will fail
        updateIndexEnabled: async (data) => {
            await this.context.globalState.update('indexEnabled', data.enabled);
        },

        // Number of vectors that will be return by semantic search tool
        updateVectorCount: async (data) => {
            await this.context.globalState.update('retrievalCount', data.value);
        },

        // Timer for flushing dirty files queue for re-embedding
        updateDebounceTime: async (data) => {
            await this.context.globalState.update('debounceTime', data.value);
        },

        // Request to re-embed the entire workspace, or for initial indexing
        indexWorkspace: async () => {
            if (this.indexer) await this.indexer.indexWorkspace();
        },

        // Deleting the index means clearing all queues and deleting the database
        deleteIndex: async () => {
            if (this.indexer) await this.indexer.deleteIndex();
        },

        // Open agent permission file
        openAgentConfig: async () => {
            await this.commandManager.openConfigFile();
        },

    };

    private readonly sessionHandlers: Record<string, (session: AgentSession, data: any) => Promise<void> | void> = {

        syncSessionUI: async (session) => {
            await this.sessionManager.syncSessionUI(session);
        },

        // Start agent loop with user prompt
        askAgent: (session, data) => {
            try {
                if (data.value) session.runAgentTurn(data.value);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to run agent turn: ${e}`);
            }
        },

        // Cancelling *should* end the stream, kill all execution processes and tool processes
        cancelGeneration: (session) => {
            session.abort();
        },

        // Compaction and update token usage afterwards
        compactHistory: async (session) => {
            try {
                await session.runCompaction();
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to compact history: ${e}`);
            } finally {
                session.contextManager.estimateCategorizedTokens();
            }
        },

        // Called when selecting a new chat provider from dropdown
        // Saves provider preference for current and future session
        saveChatProvider: async (session, data) => {
            await session.saveChatProvider(data.provider);

            const [provider, model, effort] = session.getAPIConfig();

            // Update context window usage as they differ by provider for the same input
            session.contextManager.changeProvider(provider);
            session.contextManager.estimateCategorizedTokens();
        },

        // Called when selected a new chat model from dropdown
        // Save preference for provider model choice for current and future new session
        saveChatModel: async (session, data) => {
            await session.saveChatModel(data.model);
        },

        // Called when selecting a new model effort from dropdown
        // Saves preference for model effort level for current and future new session 
        saveChatEffort: async (session, data) => {
            await session.saveChatModelEffort(data.effort);
        },

        // Called when updating chat provider API key, saved in secrets
        // Refresh the models
        saveChatAPIKey: async (session, data) => {
            const [provider, model, effort] = session.getAPIConfig();
            if (provider) {
                await this.apiManager.saveChatAPIKey(provider, data.key);
                await this.apiManager.getChatModels(provider, model, session.preferences.showAll, data.sessionID);
            }
        },

        // Called after saveChatProvider with valid API key
        // Fetches available models from provider
        fetchChatModels: async (session, data) => {
            const [provider, model, effort] = session.getAPIConfig();
            if (provider) {
                await this.apiManager.getChatModels(provider, model, session.preferences.showAll, data.sessionID);
            }
        },

        // Called after saveChatModel
        // Fetches model information
        fetchChatModelInfo: async (session, data) => {
            const [provider, model, effort] = session.getAPIConfig();
            if (provider && model) {
                this.apiManager.getChatModelInfo(provider, model, effort, data.sessionID);
            }
        },

        // Show currated list of models or all available models from providers
        // Saves preference for current session and future new sessions
        setShowAllModels: async (session, data) => {
            await this.context.globalState.update('showAllChatModels', data.showAll);
            session.preferences.showAll = data.showAll;
            await session.saveConfig();
            const [provider, model, effort] = session.getAPIConfig();
            if (provider) {
                await this.apiManager.getChatModels(provider, model, session.preferences.showAll, data.sessionID);
            }
        },

        // Set stateful or stateless conversation mode (only affects providers which support stateful)
        // Save preference for current session and future new sessions
        setStateManagement: async (session, data) => {
            await this.context.globalState.update('serverStateManagement', data.stateful);
            session.preferences.stateful = data.stateful;
            await session.saveConfig();
        },

        // Set agent loop execution limit
        // Save preference for current session and future new sessions
        updateTurnLimit: async (session, data) => {
            await this.context.globalState.update('turnLimit', data.limit);
            session.preferences.turnLimit = data.limit;
            await session.saveConfig();
        },

        // Set web search mode, either tavily or server, server is only allowed for providers which support it
        // Save preference for current session and future sessions
        setWebSearchMode: async (session, data) => {
            await this.context.globalState.update('webSearchEnabled', data.enabled);
            await this.context.globalState.update('webSearchMode', data.mode);
            session.preferences.webSearchEnabled = data.enabled;
            session.preferences.webSearchMode = data.mode;
            await session.saveConfig();

            // If using tavily, verify the tavily API key
            if (data.enabled && data.mode === 'tavily') this.apiManager.verifyTavilyAPIKey();
        },

        // Set prune mode, either prune by turn intervals or task intervals
        // Save preference for current session and future sessions
        setPruneMode: async (session, data) => {
            await this.context.globalState.update('pruneMode', data.mode);
            session.preferences.pruneMode = data.mode;
            await session.saveConfig();
        },

        // Set prune interval for task/turn mode
        // Save preference for current session and future sessions
        setPruneInterval: async (session, data) => {
            if (data.turn) {
                await this.context.globalState.update('pruneTurnInterval', data.turn);
                session.preferences.pruneTurnInterval = data.turn;
            }

            else if (data.run) {
                await this.context.globalState.update('pruneRunInterval', data.run);
                session.preferences.pruneRunInterval = data.run;
            }

            await session.saveConfig();
        },

        // Set agent mode, either fully manual or semi-autonomous (fully autonomous is set by editting the config file)
        // Save preference for current session and future sessions in the same workspace
        setAgentMode: async (session, data) => {
            await this.context.workspaceState.update('agentMode', data.mode);
            session.preferences.agentMode = data.mode;
            await session.saveConfig();

            // One time warning per workspace when enabling auto mode
            // Also open the configuration file
            if (data.mode === 'auto') {
                const hasSeenWarning = this.context.workspaceState.get<boolean>('hasSeenAutoWarning');

                if (!hasSeenWarning) {
                    await this.context.workspaceState.update('hasSeenAutoWarning', true);

                    vscode.window.showWarningMessage(
                        'Auto Mode enabled. The agent can now execute terminal commands without confirmation. Review the list of allowed commands.',
                        'Understood'
                    );

                    await this.commandManager.openConfigFile();
                }
            }
        },

        commandApprovalResponse: async (session, data) => {
            await this.commandManager.receiveApproval(data.requestId, data.approved, data.save);
        },

        // Applies worktree changes, merge conflicts are resolved with merge editor
        applyChanges: async (session) => {
            try {
                await session.worktreeManager.applyPatch();
                session.contextManager.addSystemMessage('The user applied your proposed changes to the workspace');
                await session.contextManager.save();
            } catch (e: any) {
                if (e.message !== 'MERGE_CONFLICT') {
                    vscode.window.showErrorMessage(`Failed to apply patch: ${e.message || String(e)}`);
                }
            }
        },

        // Discard worktree changes
        discardChanges: async (session) => {
            await session.worktreeManager.rejectPatch();
            session.contextManager.addSystemMessage('The user discarded your proposed changes. Workspace is reverted.');
            await session.contextManager.save();
        },

        // Applies changes after user resolves merge conflicts
        markResolved: async (session) => {
            await session.worktreeManager.resolveConflicts();
            session.contextManager.addSystemMessage('The user force-applied your changes, overwriting their local edits.');
            await session.contextManager.save();
        },

        // Force apply by replacing original files with worktree edits
        forceApply: async (session) => {
            await session.worktreeManager.forceApply();
            session.contextManager.addSystemMessage('The user force-applied your changes, overwriting their local edits.');
            await session.contextManager.save();
        },

        // Show changes between agent worktree and user file
        openDiffView: async (session, data) => {
            const originalUri = vscode.Uri.file(path.join(this.workspaceRoot, data.file));
            const worktreeUri = vscode.Uri.file(path.join(session.worktreeManager.worktreePath, data.file));

            if (data.isNew) {
                // File doesn't exist in original workspace, just open the new proposed file
                vscode.commands.executeCommand('vscode.open', worktreeUri, { preview: true });
            } else if (data.isDeleted) {
                // File doesn't exist in the worktree, just open the original file so they can see what is being removed
                vscode.commands.executeCommand('vscode.open', originalUri, { preview: true });
                vscode.window.showInformationMessage(`${data.file} is marked for deletion.`);
            } else {
                // Normal diff for modified files
                const title = `${data.file} (Agent Proposal)`;
                vscode.commands.executeCommand('vscode.diff', originalUri, worktreeUri, title);
            }
        },
    };

    private post(message: any) { this.view?.webview.postMessage(message); }

    private getHTML(): string {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'chat.html');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'chat.bundle.js');
        const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'chat.bundle.css');

        try {
            let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');

            const scriptUri = this.view!.webview.asWebviewUri(scriptPath);
            const styleUri = this.view!.webview.asWebviewUri(cssPath);

            html = html.replace('{{styleUri}}', styleUri.toString());
            html = html.replace('{{scriptUri}}', scriptUri.toString());

            return html;
        } catch (e) {
            vscode.window.showErrorMessage(`Error loading frontend html: ${e}`);
            return `<!DOCTYPE html><html><body>Error loading UI</body></html>`;
        }
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, ctx: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHTML();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            try {
                // Check Global Handlers
                const globalHandler = this.globalHandlers[data.type];
                if (globalHandler) {
                    await globalHandler(data);
                    return;
                }

                // Check Session Handlers
                const sessionHandler = this.sessionHandlers[data.type];
                if (sessionHandler && data.sessionID) {
                    const session = await this.sessionManager.getOrLoadSession(data.sessionID);
                    if (session) await sessionHandler(session, data);
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Error handling '${data.type}': ${e}`);
            }
        });
    }
}