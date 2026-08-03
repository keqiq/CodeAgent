import './styles/main.css';

import { ChatContainer } from "./componentsV2/chatContainer";
import { ChatInput } from "./componentsV2/chatInput";
import { ChatHeader } from "./componentsV2/chatHeader";
import { ChatSettings } from "./componentsV2/chatSettings";
import { ContextWindow } from './componentsV2/contextWindow';

export interface WebviewApi<StateType = any> {
    postMessage(message: unknown): void;
    getState(): StateType | undefined;
    setState(newState: StateType): void;
}
declare function acquireVsCodeApi<StateType = any>(): WebviewApi<StateType>;

const vscodeAPI: WebviewApi = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    const chatContainer = new ChatContainer(vscodeAPI);
    const chatSettings = new ChatSettings(vscodeAPI);
    const chatInput = new ChatInput(vscodeAPI, chatContainer, chatSettings);
    const chatHeader = new ChatHeader(vscodeAPI);
    const contextWindow = new ContextWindow(vscodeAPI);

    window.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data;

        switch (msg.type) {
            // --- INITIALIZATION & SETTINGS ---
            case 'restoreChatSettings':
                chatSettings.restoreSettings(msg);
                break;

            case 'initChatProviders':
                chatInput.populateChatProviders(msg.providers);
                break;

            case 'initEmbedProviders':
                chatHeader.populateEmbedProviders(msg.providers);
                break;

            case 'restoreChatHistory':
                chatContainer.restoreChatHistory(msg.history);
                const visibleMessages = msg.history.filter((m: any) => m.role !== 'developer');
                chatSettings.toggleClearChatBtn(visibleMessages.length > 0);
                break;

            // --- CHAT PROVIDER & MODELS ---
            case 'updateChatProvider':
                chatInput.updateChatProvider(msg.provider);
                chatSettings.setProvider(msg);
                break;
            
            case 'setChatModelsLoading':
                chatInput.setChatModelsLoading();
                break;

            case 'setChatModels':
                chatInput.populateChatModels(msg.models);
                break;

            case 'updateChatModel':
                chatInput.updateChatModel(msg.model);
                break;
            
            case 'updateChatModelInfo':
                chatInput.updateChatModelInfo(msg);
                contextWindow.updateContextWindow(msg.contextWindow);
                break;

            case 'requestChatAPIKey':
                chatInput.waitForChatAPIKey(msg.provider);
                chatSettings.showChatAPIKeyInput(msg.provider);
                break;

            case 'requestTavilyAPIKey':
                chatSettings.showTavilyAPIKeyInput();
                break;

            // --- CHAT STREAMING & TOOLS & PATCH & TOKEN ---
            case 'startRun':
                chatContainer.startRun();
                break;
                
            case 'receiveMessage':
                chatContainer.appendMessage({ type: 'message', role: 'assistant', content: msg.text, style: msg.style });
                break;
            
            case 'streamChunk':
                chatContainer.streamMessage(msg.chunk);
                break;
                
            case 'streamThought':
                chatContainer.streamThought(msg.chunk);
                break;
            
            case 'streamEnd':
                chatContainer.endStream();
                break;

            case 'startToolGroup':
                chatContainer.makeToolGroup();
                break;

            case 'updateTool':
                chatContainer.updateToolGroup(msg);
                break;

            case 'endToolGroup':
                chatContainer.endToolGroup(msg);
                break;

            case 'agentRunComplete':
                chatInput.setSendState();
                chatContainer.endRun(msg.status, msg.text);
                chatContainer.cancelActiveUI();
                chatSettings.toggleClearChatBtn(true);
                break;

            case 'reviewPatch':
                chatContainer.makePatchReview(msg.patch);
                break;

            case 'updatePatchStatus':
                chatContainer.updatePatchStatus(msg.status);
                break;

            case 'updateTokenUsage':
                chatContainer.updateTokenUsage(msg.usage);
                break;

            case 'updateContextWindowUsage':
                contextWindow.updateTokenUsage(msg.usage);
                break;

            // --- INDEXING & HEADER ---

            case 'restoreIndexSettings': 
                chatHeader.restoreSettings(msg);
                break;
                
            case 'updateEmbedProvider':
                chatHeader.updateEmbedProviders(msg.provider);
                break;

            case 'setEmbedModelsLoading':
                chatHeader.setEmbedModelsLoading(msg.provider);
                break;

            case 'setEmbedModels':
                chatHeader.populateEmbedModels(msg.models);
                break;

            case 'updateEmbedModel':
                chatHeader.updateEmbedModel(msg.model);
                break;

            case 'updateIndexStatus':
                chatHeader.updateIndexStatus(msg);
                break;

            case 'requestEmbedAPIKey':
                chatHeader.requestEmbedAPIKey(msg.provider);
                break;

            case 'clearChatContainer':
                chatContainer.clearChatUI();
                chatSettings.toggleClearChatBtn(false);
                contextWindow.clearTokenUsage();
                break;
            
            default:
                console.warn(`[Webview Router] Unknown message type: ${msg.type}`);
                break;
        }
    });

    vscodeAPI.postMessage({ type: 'webviewReady' });
});