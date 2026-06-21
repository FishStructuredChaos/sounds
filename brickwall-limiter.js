class BrickwallLimiterProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const params = options.parameterData || {};
        this.threshold = params.threshold !== undefined ? params.threshold : 0;

        this.lookaheadFrames = Math.max(4, Math.round(sampleRate * 0.005));
        this.bufSize = this.lookaheadFrames + 1;
        this.buffer = new Float32Array(this.bufSize * 2);
        this.wp = 0;

        this.gain = 1.0;
        this.attackCoeff = 0.9;
        this.releaseBase = Math.exp(-1.0 / (sampleRate * 0.05));

        this.bypass = false;

        this.port.onmessage = (e) => {
            if (e.data.threshold !== undefined) this.threshold = e.data.threshold;
            if (e.data.bypass !== undefined) {
                this.bypass = e.data.bypass;
                if (!this.bypass) {
                    this.buffer.fill(0);
                    this.wp = 0;
                    this.gain = 1.0;
                }
            }
        };
    }

    process(inputs, outputs) {
        const inp = inputs[0];
        const out = outputs[0];
        if (!inp || !inp[0] || !out || !out[0]) return true;

        const n = inp[0].length;
        const ch = Math.min(inp.length, out.length, 2);

        if (this.bypass) {
            for (let c = 0; c < ch; c++) {
                for (let i = 0; i < n; i++) {
                    out[c][i] = inp[c][i];
                }
            }
            return true;
        }

        const threshLin = Math.pow(10, this.threshold / 20);
        const releaseCoeff = 1 - this.releaseBase;

        for (let i = 0; i < n; i++) {
            for (let c = 0; c < ch; c++) {
                this.buffer[this.wp * 2 + c] = inp[c][i];
            }

            let rp = this.wp - this.lookaheadFrames;
            if (rp < 0) rp += this.bufSize;

            let peak = 0;
            let sp = rp;
            for (let j = 0; j < this.lookaheadFrames; j++) {
                sp = (sp + 1) % this.bufSize;
                const v = Math.abs(this.buffer[sp * 2]);
                if (v > peak) peak = v;
            }

            let target = 1.0;
            if (peak > threshLin && threshLin > 0) {
                target = threshLin / peak;
            }

            if (target < this.gain) {
                this.gain += (target - this.gain) * this.attackCoeff;
            } else {
                this.gain += (target - this.gain) * releaseCoeff;
            }

            for (let c = 0; c < ch; c++) {
                out[c][i] = this.buffer[rp * 2 + c] * this.gain;
            }

            this.wp = (this.wp + 1) % this.bufSize;
        }

        return true;
    }
}

registerProcessor('brickwall-limiter', BrickwallLimiterProcessor);
