import './styles/chat.css';
import { IndexContainer } from "./componentsV2/indexContainer";
import { WebviewApi } from '../Webview';
import { SessionView } from './sessionView';
import { SessionSelector } from './componentsV2/sessionMenu';

declare function acquireVsCodeApi<StateType = any>(): WebviewApi<StateType>;
const vscodeAPI: WebviewApi = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    // DOM Element and templates
    const sessionsViewport = document.getElementById('sessionsViewport') as HTMLElement;
    const sessionTemplate = document.getElementById('sessionViewTemplate') as HTMLTemplateElement;

    // Global components
    const indexContainer = new IndexContainer(vscodeAPI);
    const sessionMenu = new SessionSelector(vscodeAPI);

    // Session view 
    const sessionViews = new Map<string, SessionView>();
    let activeSessionID: string | null = null;

    let availableChatProviders: string[] = [];
 
    function getOrCreateSessionView(sessionID: string): SessionView {
        let view = sessionViews.get(sessionID);
        if (!view) {
            view = new SessionView(sessionID, sessionTemplate, vscodeAPI);
            sessionsViewport.appendChild(view.rootElement);
            sessionViews.set(sessionID, view);

            // Mark the session as loaded from unloaded state and make active
            sessionMenu.markSessionLoaded(sessionID);

            view.chatInput.populateChatProviders(availableChatProviders);
            vscodeAPI.postMessage({ type: 'syncSessionUI', sessionID: sessionID });
        }

        return view;
    }

    function switchActiveSession(sessionID: string): void {
        if (activeSessionID && sessionViews.has(activeSessionID)) {
            sessionViews.get(activeSessionID)!.hide();
        }

        activeSessionID = sessionID;
        const currentView = getOrCreateSessionView(sessionID);
        sessionMenu.setActiveSession(sessionID);
        currentView.show();
    }

    const globalHandlers: Record<string, (msg: any) => void> = {

        // Store chat providers
        setChatProviders: (msg) => {
            availableChatProviders = msg.providers;
        },
        
        // Restore index settings from saved values
        restoreIndexSettings: (msg) => {
            indexContainer.restoreSettings(msg);
        },

        // Store embed providers
        setEmbedProviders: (msg) => {
            indexContainer.populateEmbedProviders(msg.providers);
        },

        // Change embed provider in indexing menu
        updateEmbedProvider: (msg) => {
            indexContainer.updateEmbedProviders(msg.provider);
        },

        // Disable indexing controls whilset fetching models
        setEmbedModelsLoading: (msg) => {
            indexContainer.setEmbedModelsLoading(msg.provider);
        },

        // Store models for the current embed provider
        setEmbedModels: (msg) => {
            indexContainer.populateEmbedModels(msg.models);
        },

        // Change embed model in indexing menu
        updateEmbedModel: (msg) => {
            indexContainer.updateEmbedModel(msg.model);
        },

        // Change the status dot and other indexing component display based on status
        updateIndexStatus: (msg) => {
            indexContainer.updateIndexStatus(msg);
        },

        // Open the embedding API key input container
        requestEmbedAPIKey: (msg) => {
            indexContainer.requestEmbedAPIKey(msg.provider);
        },

        // Update agent unsafe visual indicator for all sessions
        updateUnsafeFlag: (msg) => {
            sessionViews.forEach(v => v.agentMode.setUnsafe(msg.isUnsafe));
        },

        refreshSessions: (msg) => {
            sessionMenu.refreshSessions(msg.sessions, msg.activeSessionID);
        },

        sessionSwitched: (msg) => {
            sessionMenu.setActiveSession(msg.sessionID);
            switchActiveSession(msg.sessionID);
        },

        sessionDeleted: (msg) => {
            const view = sessionViews.get(msg.sessionID);
            if (view) {
                view.destroy();
                sessionViews.delete(msg.sessionID);
            }
        },

        sessionUnloaded: (msg) => {
            const view = sessionViews.get(msg.sessionID);
            if (view) {
                view.destroy();
                sessionViews.delete(msg.sessionID);
            }
            sessionMenu.markSessionUnloaded(msg.sessionID);
        },

        titleGenerating: (msg) => {
            sessionMenu.setTitleGenerating(msg.sessionID, msg.isGenerating);
        }
    };

    const sessionHandlers: Record<string, (view: SessionView, msg: any) => void> = {
        // Restore session perferences into chat settings menu
        restoreChatSettings: (view, msg) => {
            view.chatSettings.restoreSettings(msg);
        },

        // Restore session preferences into chat context window menu
        restorePruneSettings: (view, msg) => {
            view.contextWindow.restorePruneSettings(msg);
        },

        // Restore session preferences into agent mode toggle
        restoreAgentMode: (view, msg) => {
            view.agentMode.setAgentMode(msg.mode);
        },

        // Restore session chat history
        restoreChatHistory: (view, msg) => {
            view.chatContainer.restoreChatHistory(msg.history);
        },

        // Change chat provider in the dropdown and in settings menu
        updateChatProvider: (view, msg) => {
            view.chatInput.updateChatProvider(msg.provider);
            view.chatSettings.setProvider(msg);
        },

        // Disable chat controls whilset fetching models
        setChatModelsLoading: (view, msg) => {
            view.chatInput.setChatModelsLoading();
        },

        // Store the chat models from current chat provider in dropdown
        setChatModels: (view, msg) => {
            view.chatInput.populateChatModels(msg.models);
        },

        // Change the chat model in the dropdown
        updateChatModel: (view, msg) => {
            view.chatInput.updateChatModel(msg.model);
        },

        // Store the model effort values and update max context length
        updateChatModelInfo: (view, msg) => {
            view.chatInput.updateChatModelInfo(msg);
            view.contextWindow.updateContextWindow(msg.contextWindow);
        },

        // Open chat API key input container
        requestChatAPIKey: (view, msg) => {
            view.chatInput.waitForChatAPIKey(msg.provider);
            view.chatSettings.showChatAPIKeyInput(msg.provider);
        },

        // Open tavily API key input container
        requestTavilyAPIKey: (view) => {
            view.chatSettings.showTavilyAPIKeyInput();
        },

        // Disable/Enable all chat controls
        toggleChatControls: (view, msg) => {
            view.chatInput.setDisabled(msg.disabled);
            view.chatSettings.setDisabled(msg.disabled);
            view.contextWindow.setDisabled(msg.disabled);
        },

        // Begin agent loop
        startRun: (view, msg) => {
            sessionMenu.setSessionStatus(view.sessionID, 'running');
            view.chatContainer.startRun(msg);
        },

        // Update agent loop turn progress
        updateTurnProgress: (view, msg) => {
            view.chatContainer.updateTurn(msg);
        },

        // Update token usage per turn
        updateTokenUsage: (view, msg) => {
            view.chatContainer.updateUsage(msg.usage);
        },
        
        // update context window visualization per turn
        updateContextWindowUsage: (view, msg) => {
            view.contextWindow.updateTokenUsage(msg.usage);
        },

        // Auxiliary add message
        receiveMessage: (view, msg) => {
            view.chatContainer.addMessage({ type: 'message', role: 'assistant', content: msg.text, style: msg.style });
        },

        // Receive stream text output delta
        streamChunk: (view, msg) => {
            view.chatContainer.updateMessage(msg.chunk);
        },

        // Receive stream thought delta
        streamThought: (view, msg) => {
            view.chatContainer.updateThought(msg.chunk);
        },

        // Receive live token generation speed
        streamSpeed: (view, msg) => {
            view.chatContainer.updateSpeed(msg.speed);
        },

        // End streaming 
        streamEnd: (view) => {
            view.chatContainer.endMessage();
        },

        // Update tool container with tool status
        updateTool: (view, msg) => {
            view.chatContainer.updateTools(msg);
        },

        // Mark tool execute as finished with statistics
        endTools: (view, msg) => {
            view.chatContainer.endTools(msg);
        },

        // Update execute container with execution status
        updateExecute: (view, msg) => {
            sessionMenu.setSessionStatus(view.sessionID, 'running');
            view.chatContainer.updateExecute(msg);
        },

        // Show the unlisted command issued by agent
        // Allow user to decide whether to allow or disallow before it is executed
        requestCommandApproval: (view, msg) => {
            sessionMenu.setSessionStatus(view.sessionID, 'pending');
            view.chatInput.showCommandApproval(msg);
        },

        // Makr execution as finished with statistics
        endExecute: (view, msg) => {
            sessionMenu.setSessionStatus(view.sessionID, 'running');
            view.chatContainer.endExecute(msg);
        },

        // Mark agent loop as finished with statistics
        endRun: (view, msg) => {
            const nextStatus = msg.status === 'error' ? 'error' : 'ready';
            sessionMenu.setSessionStatus(view.sessionID, nextStatus);

            view.chatContainer.endRun(msg.status, msg.text);
            view.chatContainer.cancelActiveUI(); // any unfinished items will marked as halted
        },

        // Display any modifications during the run
        reviewPatch: (view, msg) => {
            view.chatContainer.makePatch(msg.patch);
        },

        // Update the patch status ie accepted, rejected or conflict
        updatePatchStatus: (view, msg) => {
            view.chatContainer.updatePatch(msg.status);
        },

    };

    window.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data;
        if (!msg?.type) return;

        // Route to Global Handler
        const globalHandler = globalHandlers[msg.type];
        if (globalHandler) {
            globalHandler(msg);
            return;
        }

        // Route to Session-Scoped Handler
        const sessionHandler = sessionHandlers[msg.type];
        if (sessionHandler && msg.sessionID) {
            const view = getOrCreateSessionView(msg.sessionID);
            sessionHandler(view, msg);
        }
    });

    vscodeAPI.postMessage({ type: 'webviewReady' });
});


