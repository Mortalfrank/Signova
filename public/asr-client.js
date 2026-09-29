function failure(code, message) { return Object.assign(new Error(message), { code }); }

export function startCloudMic({ onText = () => {}, onPartial = () => {}, onEnd = () => {},
  onError = () => {}, hotwords = [], signal } = {}) {
  if (!window.isSecureContext) return Promise.reject(failure('insecure', '手机麦克风需要 HTTPS；电脑请使用 localhost 打开。'));
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
    return Promise.reject(failure('unsupported', '当前浏览器不支持实时收音，请用新版 Chrome 或 Safari 打开。'));
  if (signal?.aborted) return Promise.reject(failure('aborted', '已取消开启麦克风。'));

  let stream, context, source, worklet, mute, socket, pendingTimer, finishTimer;
  let ready = false, settled = false, stopped = false, ended = false, seen = new Set();
  let resolveStart, rejectStart;
  const started = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  const stopAudio = () => {
    stream?.getTracks().forEach(track => track.stop());
    try { source?.disconnect(); worklet?.disconnect(); mute?.disconnect(); } catch { /* Already disconnected. */ }
    if (context && context.state !== 'closed') context.close().catch(() => {});
  };
  const complete = error => {
    if (ended) return;
    ended = true;
    clearTimeout(pendingTimer);
    clearTimeout(finishTimer);
    signal?.removeEventListener('abort', cancel);
    window.removeEventListener('pagehide', cancel);
    stopAudio();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (!settled) {
      settled = true;
      rejectStart(error || failure('aborted', '已取消开启麦克风。'));
    } else {
      if (error && error.code !== 'aborted') onError(error);
      onEnd();
    }
  };
  const cancel = () => complete(failure('aborted', '已取消开启麦克风。'));
  const sendStop = () => {
    if (ended) return;
    stopAudio();
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
    finishTimer = setTimeout(() => complete(failure('timeout', '语音识别结束超时，请重新开启。')), 12000);
  };
  const stop = () => {
    if (stopped || ended) return;
    stopped = true;
    stream?.getTracks().forEach(track => track.stop());
    if (!ready || !worklet) return cancel();
    // Flush the final short frame before sending finish-task.
    worklet.port.postMessage({ type: 'stop' });
    finishTimer = setTimeout(sendStop, 250);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  window.addEventListener('pagehide', cancel, { once: true });
  pendingTimer = setTimeout(() => complete(failure('timeout', '开启麦克风超时，请确认权限后重试。')), 45000);

  // Create/resume the audio context immediately in the caller's click gesture.
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    context = new AudioContext();
    context.resume().catch(() => complete(failure('audio', '无法开启音频设备，请再次点击麦克风。')));
  } catch { complete(failure('audio', '无法开启音频设备，请检查系统麦克风设置。')); return started; }

  navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
    .then(async acquired => {
      stream = acquired;
      if (ended) { stream.getTracks().forEach(track => track.stop()); return; }
      await context.audioWorklet.addModule('/pcm-worklet.js');
      if (ended) return;
      source = context.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(context, 'signova-pcm');
      mute = context.createGain();
      mute.gain.value = 0;
      worklet.connect(mute).connect(context.destination);
      const url = new URL('/api/asr', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onopen = () => {
        if (ended) return socket.close();
        socket.send(JSON.stringify({ type: 'start', hotwords: Array.isArray(hotwords) ? hotwords.slice(0, 50) : [] }));
      };
      socket.onerror = () => complete(failure('network', '无法连接语音服务，请检查电脑服务和网络。'));
      socket.onclose = () => { if (!ended) complete(failure('network', '语音连接已中断，请重新开启。')); };
      socket.onmessage = event => {
        if (ended) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return complete(failure('protocol', '语音服务返回异常，请重试。')); }
        if (message.type === 'error') return complete(failure(message.code || 'service', message.message || '语音服务暂不可用。'));
        if (message.type === 'end') return complete();
        if (message.type === 'ready' && !ready && !stopped) {
          ready = true;
          clearTimeout(pendingTimer);
          source.connect(worklet);
          settled = true;
          resolveStart({ stop });
        }
        if (message.type === 'text' && typeof message.text === 'string') {
          if (message.final) {
            const id = message.sentenceId;
            if (id !== null && id !== undefined && seen.has(id)) return;
            if (id !== null && id !== undefined) seen.add(id);
            onText(message.text);
            onPartial('');
          } else onPartial(message.text);
        }
      };
      worklet.port.onmessage = event => {
        if (ended) return;
        if (event.data?.type === 'flushed') { clearTimeout(finishTimer); return sendStop(); }
        if (event.data?.type !== 'audio' || !ready || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 256000) return complete(failure('backpressure', '网络发送速度不足，收音已停止，请重试。'));
        socket.send(event.data.buffer);
      };
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (!stopped && !ended) complete(failure('audio', '麦克风已断开，请检查设备后重新开启。'));
      }, { once: true }));
    }).catch(error => {
      if (ended) return;
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        return complete(failure('permission', '麦克风权限被拒绝。请在浏览器的网站设置和系统设置中允许麦克风。'));
      if (error.name === 'NotFoundError') return complete(failure('device', '没有找到麦克风，请连接或启用设备。'));
      if (error.name === 'NotReadableError') return complete(failure('device', '麦克风被占用或无法读取，请关闭其他录音应用后重试。'));
      complete(failure('audio', '无法初始化音频采集，请刷新页面后重试。'));
    });
  return started;
}
