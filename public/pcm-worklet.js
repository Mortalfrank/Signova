// Mono Float32 microphone samples -> 16 kHz little-endian PCM16, in 100 ms frames.
// Fractional sample weights carry across worklet blocks, including at 44.1 kHz.
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.weight = 0;
    this.sum = 0;
    this.frame = new ArrayBuffer(3200);
    this.view = new DataView(this.frame);
    this.position = 0;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data?.type === 'stop') {
        this.flush();
        this.stopped = true;
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  flush() {
    if (!this.position) return;
    const frame = this.frame.slice(0, this.position * 2);
    this.port.postMessage({ type: 'audio', buffer: frame }, [frame]);
    this.position = 0;
  }
  sample(value) {
    value = Math.max(-1, Math.min(1, value));
    this.view.setInt16(this.position++ * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    if (this.position === 1600) this.flush();
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let value = 0;
      for (const channel of channels) value += channel[index] || 0;
      value /= channels.length;
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          this.sample(this.sum / this.weight);
          this.weight = 0;
          this.sum = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('signova-pcm', PcmProcessor);
