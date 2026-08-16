export interface WebviewApi<StateType = any> {
    postMessage(message: unknown): void;
    getState(): StateType | undefined;
    setState(newState: StateType): void;
}
