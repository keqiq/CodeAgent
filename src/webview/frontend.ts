import './styles/main.css';

import { ChatContainer } from "./componentsV2/chatContainer";
import { ChatInput } from "./componentsV2/chatInput";
import { ChatHeader } from "./componentsV2/chatHeader";
import { ChatSettings } from "./componentsV2/chatSettings";

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
    const chatInput = new ChatInput(vscodeAPI, chatContainer);
    const chatHeader = new ChatHeader(vscodeAPI);

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
                break;

            case 'requestChatAPIKey':
                chatInput.waitForChatAPIKey(msg.provider);
                chatSettings.showChatAPIKeyInput(msg.provider);
                break;

            // --- CHAT STREAMING & TOOLS ---
            case 'receiveMessage':
                chatContainer.appendMessage({ type: 'message', role: 'assistant', content: msg.text });
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
                chatContainer.cancelActiveUI();

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
                break;
            
            default:
                console.warn(`[Webview Router] Unknown message type: ${msg.type}`);
                break;
        }
    });

    vscodeAPI.postMessage({ type: 'webviewReady' });
});