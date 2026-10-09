export class SessionEpoch {
    private controller = new AbortController();
    value = 0;

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    advance(): void {
        ++this.value;
        this.controller.abort();
        this.controller = new AbortController();
    }
}
