import './styles/mcp.css';
import { WebviewApi } from '../Webview';
import { MCPHeader } from './components/mcpHeader';
import { MCPServerList } from './components/mcpServerList';

declare function acquireVsCodeApi<StateType = any>(): WebviewApi<StateType>;
const vscodeAPI: WebviewApi = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    const mcpHeader = new MCPHeader(vscodeAPI);
    const mcpServerList = new MCPServerList(vscodeAPI);

    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.type) {
            case 'restoreState':
                // Initial load: parse the saved states from mcpManager and render them
                const savedStates = message.states || {};
                for (const [name, state] of Object.entries(savedStates)) {
                    mcpServerList.addServerItem(name, (state as any).config, (state as any).status);
                }
                
                break;

            case 'addServer':
                mcpServerList.addServerItem(message.serverName, message.config, message.status);
                break;

            case 'updateServerState':
                // Could be 'connected', 'disconnected', 'connecting', 'error'
                mcpServerList.updateServerStatus(message.serverName, message.status);
                break;

            case 'updateServerTools':
                // Once connected, tools are passed back here
                mcpServerList.updateServerTools(message.serverName, message.tools);
                break;

            case 'removeMCPServer':
                mcpServerList.removeServerEntry(message.name);
                break;

            case 'updateHeaderStats':
                mcpHeader.updateStats(
                    message.serversActive, 
                    message.serversTotal, 
                    message.toolsActive, 
                    message.toolsTotal
                );
                break;
        }
    });
});

window.addEventListener('load', () => {
    vscodeAPI.postMessage({ type: 'mcpViewReady' });
});