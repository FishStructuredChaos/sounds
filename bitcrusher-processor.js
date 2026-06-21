class BitcrusherProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.crush = 0;
        this.holdCounter = 0;
        this.heldSamples = [0, 0];

        this.port.onmessage = (e) => {
            if (e.data.crush !== undefined) this.crush = Math.max(0, Math.min(100, e.data.crush));
        };
    }

    process(inputs, outputs) {
        const inp = inputs[0];
        const out = outputs[0];
        if (!inp || !inp[0] || !out || !out[0]) return true;

        const n = inp[0].length;
        const ch = Math.min(inp.length, out.length, 2);

        if (this.crush <= 0) {
            for (let c = 0; c < ch; c++) {
                for (let i = 0; i < n; i++) {
                    out[c][i] = inp[c][i];
                }
            }
            return true;
        }

        var bits = Math.max(1, Math.round(16 - (this.crush / 100) * 14));
        var reduction = Math.max(1, Math.round(1 + (this.crush / 100) * 15));
        var steps = Math.pow(2, bits - 1);

        for (let i = 0; i < n; i++) {
            if (this.holdCounter <= 0) {
                for (let c = 0; c < ch; c++) {
                    this.heldSamples[c] = inp[c][i];
                }
                this.holdCounter = reduction - 1;
            } else {
                this.holdCounter--;
            }

            for (let c = 0; c < ch; c++) {
                out[c][i] = Math.round(this.heldSamples[c] * steps) / steps;
            }
        }

        return true;
    }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
