import './styles/main.css';

import { initHeader, populateEmbedProviders, requestEmbedAPIKey, restoreIndexState, updateEmbedModels, updateIndexStatus } from './components/chat-header.js';
import { initInput, updateChatModel, requestChatAPIKey, updateChatProvider, populateChatProviders, updateChatModelInfo, populateChatModels, setChatModelsLoading } from './components/chat-input.js';
import { initChat, appendMessage, clearChatUI, streamMessage, endStream, makeCurrentToolGroup, updateCurrentToolGroup, endCurrentToolGroup, restoreChatHistory, streamThought } from './components/chat-container.js';
import { SettingsMenu } from './components/chat-settings-menu.js';

const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    initHeader(vscode);
    initChat(vscode);
    initInput(vscode);

    
    const settingsMenu = new SettingsMenu(vscode);

    window.addEventListener('message', event => {
        const message = event.data;

        if (message.type === 'initProviders') {
            populateChatProviders(message.chatProviders);
            populateEmbedProviders(message.embedProviders);
        }

        else if (message.type === 'restoreChatHistory') restoreChatHistory(message);

        else if (message.type === 'restoreChatSettings') settingsMenu.restoreSettings(message);

        // Provider and model selection UI updates
        else if (message.type === 'updateChatProvider') {
            updateChatProvider(message);
            settingsMenu.setProvider(message);
        }

        else if (message.type === 'setChatModels') populateChatModels(message);

        else if (message.type === 'setChatModelsLoading') setChatModelsLoading(message);

        else if (message.type === 'updateChatModel') updateChatModel(message);

        else if (message.type === 'updateChatModelInfo') updateChatModelInfo(message);

        else if (message.type === 'requestChatAPIKey') {
            requestChatAPIKey(message);
            settingsMenu.showChatAPIKeyInput(message);
        }

        // Agent text response UI updates
        else if (message.type === 'receiveMessage') appendMessage(message);

        else if (message.type === 'streamChunk') streamMessage(message);

        else if (message.type === 'streamThought') streamThought(message);

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