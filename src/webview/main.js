import './styles/main.css';

import { initHeader, populateEmbedProviders, requestEmbedAPIKey, restoreIndexState, updateEmbedModels, updateIndexStatus } from './components/chat-header.js';
import { initInput, updateChatModels, requestChatAPIKey, updateChatProvider, populateChatProviders } from './components/chat-input.js';
import { initChat, appendMessage, clearChatUI, streamMessage, endStream, makeCurrentToolGroup, updateCurrentToolGroup, endCurrentToolGroup, restoreChatHistory } from './components/chat-container.js';

const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    initHeader(vscode);
    initChat(vscode);
    initInput(vscode);

    window.addEventListener('message', event => {
        const message = event.data;

        if (message.type === 'initProviders') {
            populateChatProviders(message.chatProviders);
            populateEmbedProviders(message.embedProviders);
        }

        if (message.type === 'restoreChatHistory') restoreChatHistory(message);

        else if (message.type === 'restoreChatState') {
            updateChatProvider(message);
            updateChatModels(message);
        }

        else if (message.type === 'requestChatAPIKey') requestChatAPIKey(message);

        else if (message.type === 'setChatModels') updateChatModels(message);

        // Agent text response UI updates
        else if (message.type === 'receiveMessage') appendMessage(message);

        else if (message.type === 'streamChunk') streamMessage(message);

        else if (message.type === 'streamEnd') endStream();

        // Agent tool Execution UI updates
        else if (message.type === 'startToolGroup') makeCurrentToolGroup(message);

        else if (message.type === 'updateTool') updateCurrentToolGroup(message);

        else if (message.type === 'endToolGroup') endCurrentToolGroup(message);

        // Indexing status UI updates
        else if (message.type === 'restoreIndexState') restoreIndexState(message);

        else if (message.type === 'requestEmbedAPIKey') requestEmbedAPIKey(message);

        else if (message.type === 'setEmbedModels') updateEmbedModels(message);

        else if (message.type === 'updateIndexStatus') updateIndexStatus(message);

    });

    vscode.postMessage({ type: 'webviewReady' });
});