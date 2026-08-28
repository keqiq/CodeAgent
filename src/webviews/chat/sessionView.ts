import { WebviewApi } from "../Webview";
import { AgentMode } from "./componentsV2/agentMode";
import { ChatContainer } from "./componentsV2/chatContainer";
import { ChatInput } from "./componentsV2/chatInput";
import { ChatSettings } from "./componentsV2/chatSettings";
import { ContextWindow } from "./componentsV2/contextWindow";

export class SessionView {
    public readonly sessionID: string;
    public readonly rootElement: HTMLElement;

    public readonly chatContainer: ChatContainer;
    public readonly chatInput: ChatInput;
    public readonly chatSettings: ChatSettings;
    public readonly contextWindow: ContextWindow;
    public readonly agentMode: AgentMode;

    constructor(sessionID: string, template: HTMLTemplateElement, vscodeAPI: WebviewApi) {
        this.sessionID = sessionID;

        // Clone DOM
        const fragment = template.content.cloneNode(true) as DocumentFragment;
        const rootDiv = fragment.firstElementChild as HTMLElement;
        if (!rootDiv) throw new Error('sessionViewTemplate must contain a root element.');
        this.rootElement = rootDiv;
        this.rootElement.dataset.sessionId = sessionID;

        // Automatically tags all outbound messages with this sessionID
        const scopedAPI: WebviewApi = {
            postMessage: (msg: any) => vscodeAPI.postMessage({ ...msg, sessionID: this.sessionID }),
            getState: () => vscodeAPI.getState(),
            setState: (state: any) => vscodeAPI.setState(state)
        };

        this.chatContainer = new ChatContainer(this.rootElement, scopedAPI);
        this.chatSettings = new ChatSettings(this.rootElement, scopedAPI);
        this.contextWindow = new ContextWindow(this.rootElement, scopedAPI);
        this.agentMode = new AgentMode(this.rootElement, scopedAPI);
        this.chatInput = new ChatInput(this.rootElement, scopedAPI, this.chatContainer, this.chatSettings);
    }

    public show(): void { this.rootElement.classList.remove('hidden'); }
    public hide(): void { this.rootElement.classList.add('hidden'); }
    public destroy(): void { this.rootElement.remove(); }
    
}