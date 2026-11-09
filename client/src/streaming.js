import { io } from 'socket.io-client';
import { api, getServerBase, getToken } from './api';
import { useApp } from './store';
import { getSocket } from './socket';

const ICE_SERVERS = [
  {
    urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  },
];

function isMissingDevice(err) {
  return err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError';
}

function socketUrl() {
  const base = getServerBase();
  return base ? `${base}/stream` : '/stream';
}

function mediaStreamError(err) {
  if (err?.name === 'NotAllowedError') return new Error('Доступ к камере или микрофону запрещён');
  if (err?.name === 'AbortError') return new Error('Захват отменён');
  if (err?.name === 'NotFoundError') return new Error('Камера или микрофон не найдены');
  return err instanceof Error ? err : new Error(String(err || 'Не удалось получить медиапоток'));
}

async function captureCamera() {
  const settings = useApp.getState().settings;
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
    sampleSize: 16,
    latency: 0.01,
  };
  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 },
  };
  if (settings.inputDevice && settings.inputDevice !== 'default') {
    audio.deviceId = { exact: settings.inputDevice };
  }
  if (settings.videoDevice && settings.videoDevice !== 'default') {
    video.deviceId = { exact: settings.videoDevice };
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video });
  } catch (err) {
    if (isMissingDevice(err)) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {}
    }
    // Камера может работать без микрофона — трансляция важнее.
    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }
}

async function resolveScreenSource(preselectedId) {
  if (!window.desktop?.listScreenSources || !window.desktop?.selectScreenSource) {
    return preselectedId || '';
  }
  // Монитор уже выбран в окне запуска трансляции.
  if (preselectedId) return preselectedId;
  const sources = await window.desktop.listScreenSources();
  if (!sources.length) return '';
  const sourceId = await useApp.getState().requestScreenSource(sources);
  if (!sourceId) throw new DOMException('Захват экрана отменён', 'AbortError');
  return sourceId;
}

async function requestDisplay(sourceId) {
  const select = async () => {
    if (!sourceId || !window.desktop?.selectScreenSource) return;
    try {
      await window.desktop.selectScreenSource(sourceId);
    } catch {}
  };
  await select();
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') throw err;
    // Не все системы разрешают системный звук — показываем хотя бы видео.
    await select();
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  }
}

async function captureScreen(preselectedId) {
  const sourceId = await resolveScreenSource(preselectedId);
  return requestDisplay(sourceId);
}

// Ограничиваем итоговый поток 1080p, сохраняя пропорции исходного экрана.
const MAX_STREAM_WIDTH = 1920;
const MAX_STREAM_HEIGHT = 1080;

function fitDimensions(width, height) {
  if (!width || !height) return { width: MAX_STREAM_WIDTH, height: MAX_STREAM_HEIGHT };
  const scale = Math.min(1, MAX_STREAM_WIDTH / width, MAX_STREAM_HEIGHT / height);
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
}

async function optimizeScreenTrack(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.applyConstraints) return;
  try {
    const settings = track.getSettings?.() || {};
    const width = Number(settings.width) || 0;
    const height = Number(settings.height) || 0;
    if (width > MAX_STREAM_WIDTH || height > MAX_STREAM_HEIGHT) {
      await track.applyConstraints({
        width: { max: MAX_STREAM_WIDTH },
        height: { max: MAX_STREAM_HEIGHT },
        frameRate: { max: 30 },
      });
    }
  } catch {}
}

function stopTracks(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {}
  }
}

const PIP_LAYOUT_KEY = 'carnage_stream_pip_layout';
const DEFAULT_PIP_LAYOUT = { x: 0.72, y: 0.7, w: 0.24 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readPipLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(PIP_LAYOUT_KEY) || 'null');
    if (
      raw &&
      Number.isFinite(raw.x) &&
      Number.isFinite(raw.y) &&
      Number.isFinite(raw.w)
    ) {
      return {
        x: clamp(raw.x, 0, 0.9),
        y: clamp(raw.y, 0, 0.9),
        w: clamp(raw.w, 0.12, 0.6),
      };
    }
  } catch {}
  return { ...DEFAULT_PIP_LAYOUT };
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, r);
    return;
  }
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

class StreamBroadcaster {
  constructor() {
    this.stream = null;
    this.localStream = null;
    this.cameraStream = null;
    this.screenStream = null;
    this.socket = null;
    this.source = 'camera';
    this.peers = new Map();
    this.iceQueues = new Map();
    this.previewTimer = null;
    this.previewVideo = null;
    this.previewCanvas = null;
    this.stopping = false;

    // Композиция «экран + камера поверх».
    this.canvas = null;
    this.canvasContext = null;
    this.screenVideo = null;
    this.cameraVideo = null;
    this.compositeTimer = null;
    this.audioContext = null;
    this.audioNodes = [];
    this.pipLayout = readPipLayout();
    this.screenAspect = 16 / 9;
    this.cameraAspect = 16 / 9;
  }

  get active() {
    return Boolean(this.stream);
  }

  async start({
    title = 'Трансляция',
    mode = 'app',
    source = 'camera',
    screenSourceId = '',
    channelId = null,
  } = {}) {
    if (this.stream) await this.stop({ silent: true });
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Устройство не поддерживает захват камеры или экрана');
    }

    const needsScreen = source === 'screen' || source === 'both';
    const needsCamera = source === 'camera' || source === 'both';
    let screenMedia = null;
    let cameraMedia = null;
    let warning = '';

    try {
      // Захват экрана запрашиваем первым: браузеру нужен активный жест
      // пользователя, а диалог камеры может «съесть» этот жест.
      if (needsScreen) {
        screenMedia = await captureScreen(screenSourceId);
        if (!screenMedia.getVideoTracks().length) {
          stopTracks(screenMedia);
          screenMedia = null;
          throw new Error('Не удалось получить видеопоток экрана');
        }
        await optimizeScreenTrack(screenMedia);
      }

      if (needsCamera) {
        try {
          cameraMedia = await captureCamera();
        } catch (err) {
          // Если экран уже захвачен, не срываем эфир из-за камеры.
          if (!screenMedia) throw err;
          warning = 'Камера недоступна — показываем только экран';
        }
        if (cameraMedia && !cameraMedia.getVideoTracks().length) {
          stopTracks(cameraMedia);
          cameraMedia = null;
          if (!screenMedia) throw new Error('Не удалось получить видеопоток камеры');
        }
      }
    } catch (err) {
      stopTracks(screenMedia);
      stopTracks(cameraMedia);
      throw mediaStreamError(err);
    }

    if (!screenMedia && !cameraMedia) {
      throw new Error('Не удалось получить видеопоток');
    }

    this.screenStream = screenMedia;
    this.cameraStream = cameraMedia;
    this.source = screenMedia && cameraMedia ? 'both' : screenMedia ? 'screen' : 'camera';

    try {
      this.localStream =
        this.source === 'both'
          ? this.createCompositeStream()
          : screenMedia || cameraMedia;
    } catch (err) {
      this.releaseMedia();
      throw new Error(err?.message || 'Не удалось подготовить видео');
    }

    this.bindCaptureEnded(screenMedia, 'Демонстрация экрана остановлена');
    this.bindCaptureEnded(cameraMedia, 'Камера отключена');

    let data;
    try {
      data = await api('/api/streams', {
        method: 'POST',
        body: { title, mode, source: this.source, channelId: channelId || null },
      });
    } catch (err) {
      this.releaseMedia();
      throw err;
    }

    const stream = {
      ...data.stream,
      url: data.url || `${getServerBase()}/stream/${data.stream.id}`,
    };
    this.stream = stream;
    useApp.getState().setMyStream(stream);
    if (warning) useApp.getState().toast(warning, 'info');
    this.connectHost();
    this.startPreview();
    return stream;
  }

  createVideoElement(stream) {
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.play().catch(() => {});
    return video;
  }

  createCompositeStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    if (!context || typeof canvas.captureStream !== 'function') {
      throw new Error('Устройство не поддерживает камеру поверх экрана');
    }

    this.canvas = canvas;
    this.canvasContext = context;
    this.screenVideo = this.createVideoElement(this.screenStream);
    this.cameraVideo = this.createVideoElement(this.cameraStream);

    const tick = () => this.drawCompositeFrame();
    this.compositeTimer = setInterval(tick, 1000 / 30);
    tick();

    const videoStream = canvas.captureStream(30);
    const audioTracks = this.mixAudioTracks([this.cameraStream, this.screenStream]);
    return new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
  }

  mixAudioTracks(streams) {
    const tracks = [];
    for (const stream of streams) {
      if (!stream) continue;
      for (const track of stream.getAudioTracks()) {
        if (track.readyState === 'live') tracks.push(track);
      }
    }
    if (tracks.length <= 1) return tracks;
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return tracks.slice(0, 1);
      const context = new AudioCtor();
      const destination = context.createMediaStreamDestination();
      const nodes = [];
      for (const track of tracks) {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
        nodes.push(source);
      }
      this.audioContext = context;
      this.audioNodes = nodes;
      try {
        context.resume?.();
      } catch {}
      return destination.stream.getAudioTracks();
    } catch {
      return tracks.slice(0, 1);
    }
  }

  drawCompositeFrame() {
    const canvas = this.canvas;
    const context = this.canvasContext;
    const screen = this.screenVideo;
    if (!canvas || !context || !screen) return;
    const screenWidth = screen.videoWidth;
    const screenHeight = screen.videoHeight;
    if (!screenWidth || !screenHeight) return;

    // Итоговый кадр повторяет пропорции выбранного монитора и при
    // необходимости ужимается до 1080p — без растягивания и обрезки.
    const target = fitDimensions(screenWidth, screenHeight);
    if (canvas.width !== target.width || canvas.height !== target.height) {
      canvas.width = target.width;
      canvas.height = target.height;
    }
    const width = target.width;
    const height = target.height;

    try {
      context.drawImage(screen, 0, 0, width, height);
    } catch {
      return;
    }
    this.screenAspect = width / height;

    const camera = this.cameraVideo;
    if (!camera || camera.readyState < 2) return;
    const cameraWidth = camera.videoWidth;
    const cameraHeight = camera.videoHeight;
    if (!cameraWidth || !cameraHeight) return;
    this.cameraAspect = cameraWidth / cameraHeight;

    const layout = this.pipLayout || DEFAULT_PIP_LAYOUT;
    const marginX = width * 0.012;
    const marginY = height * 0.012;
    const boxWidth = Math.min(layout.w * width, width - marginX * 2);
    const boxHeight = (boxWidth * cameraHeight) / cameraWidth;
    const maxX = Math.max(marginX, width - boxWidth - marginX);
    const maxY = Math.max(marginY, height - boxHeight - marginY);
    const x = clamp(layout.x * width, marginX, maxX);
    const y = clamp(layout.y * height, marginY, maxY);
    const radius = Math.max(8, Math.min(boxWidth, boxHeight) * 0.045);

    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.55)';
    context.shadowBlur = Math.max(10, width * 0.012);
    context.fillStyle = '#000';
    roundedRectPath(context, x, y, boxWidth, boxHeight, radius);
    context.fill();
    context.restore();

    context.save();
    roundedRectPath(context, x, y, boxWidth, boxHeight, radius);
    context.clip();
    try {
      context.drawImage(camera, x, y, boxWidth, boxHeight);
    } catch {}
    context.restore();

    context.save();
    roundedRectPath(context, x, y, boxWidth, boxHeight, radius);
    context.lineWidth = Math.max(2, width * 0.0025);
    context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    context.stroke();
    context.restore();
  }

  bindCaptureEnded(stream, message) {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    track.addEventListener('ended', () => {
      if (!this.stream || this.stopping) return;
      useApp.getState().toast(message, 'info');
      this.stop({ silent: true });
    });
  }

  getPipLayout() {
    return { ...this.pipLayout };
  }

  setPipLayout(next, persist = false) {
    const current = this.pipLayout || DEFAULT_PIP_LAYOUT;
    const width = Number.isFinite(next?.w) ? next.w : current.w;
    const widthClamped = clamp(width, 0.12, 0.6);
    const x = Number.isFinite(next?.x) ? next.x : current.x;
    const y = Number.isFinite(next?.y) ? next.y : current.y;
    this.pipLayout = {
      x: clamp(x, 0.005, 0.995 - widthClamped),
      y: clamp(y, 0.005, 0.995),
      w: widthClamped,
    };
    if (persist) {
      try {
        localStorage.setItem(PIP_LAYOUT_KEY, JSON.stringify(this.pipLayout));
      } catch {}
    }
  }

  stopComposite() {
    if (this.compositeTimer) clearInterval(this.compositeTimer);
    this.compositeTimer = null;
    for (const video of [this.screenVideo, this.cameraVideo]) {
      if (!video) continue;
      try {
        video.pause();
        video.srcObject = null;
      } catch {}
    }
    this.screenVideo = null;
    this.cameraVideo = null;
    this.canvas = null;
    this.canvasContext = null;
    this.audioNodes = [];
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
    }
    this.audioContext = null;
  }

  releaseMedia() {
    this.stopComposite();
    const seen = new Set();
    for (const stream of [this.localStream, this.screenStream, this.cameraStream]) {
      if (!stream || seen.has(stream)) continue;
      seen.add(stream);
      stopTracks(stream);
    }
    this.localStream = null;
    this.screenStream = null;
    this.cameraStream = null;
    this.source = 'camera';
  }

  connectHost() {
    if (!this.stream) return;
    const socket = io(socketUrl(), {
      auth: {
        streamId: this.stream.id,
        role: 'host',
        token: getToken() || '',
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 700,
      reconnectionDelayMax: 4000,
    });
    this.socket = socket;

    socket.on('stream:host', ({ stream } = {}) => {
      if (stream) {
        this.stream = { ...this.stream, ...stream, url: this.stream.url };
        useApp.getState().setMyStream(this.stream);
      }
    });

    socket.on('stream:viewer', ({ viewerId } = {}) => {
      if (viewerId) this.createPeer(viewerId);
    });

    socket.on('stream:viewer-left', ({ viewerId } = {}) => {
      if (viewerId) this.closePeer(viewerId);
    });

    socket.on('stream:signal', (payload) => this.handleSignal(payload));
    socket.on('stream:viewers', ({ viewers } = {}) => {
      if (!this.stream) return;
      this.stream = { ...this.stream, viewers: Number(viewers) || 0 };
      useApp.getState().setMyStream(this.stream);
    });
    socket.on('stream:ended', () => this.handleRemoteEnd());
    socket.on('stream:error', ({ error } = {}) => {
      useApp.getState().toast(error || 'Сервер остановил трансляцию', 'error');
      this.handleRemoteEnd({ quiet: true });
    });
  }

  async createPeer(viewerId) {
    if (!this.socket || !this.localStream) return;
    this.closePeer(viewerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(viewerId, pc);
    this.iceQueues.set(viewerId, []);

    for (const track of this.localStream.getTracks()) {
      try {
        pc.addTrack(track, this.localStream);
      } catch {}
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal(viewerId, { candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(viewerId);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal(viewerId, { type: 'offer', sdp: pc.localDescription });
    } catch (err) {
      console.warn('[stream] offer error', err);
      this.closePeer(viewerId);
    }
  }

  async handleSignal({ from, data } = {}) {
    if (!from || !data) return;
    const pc = this.peers.get(from);
    if (!pc) return;
    try {
      if (data.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const queue = this.iceQueues.get(from) || [];
        this.iceQueues.set(from, []);
        for (const candidate of queue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {}
        }
      } else if (data.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch {}
        } else {
          const queue = this.iceQueues.get(from) || [];
          queue.push(data.candidate);
          this.iceQueues.set(from, queue);
        }
      }
    } catch (err) {
      console.warn('[stream] signal error', err);
    }
  }

  signal(to, data) {
    this.socket?.emit('stream:signal', { to, data });
  }

  closePeer(viewerId) {
    const pc = this.peers.get(viewerId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {}
    }
    this.peers.delete(viewerId);
    this.iceQueues.delete(viewerId);
  }

  startPreview() {
    this.stopPreview();
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = this.localStream;
    video.play().catch(() => {});
    this.previewVideo = video;

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    this.previewCanvas = canvas;

    const tick = () => this.sendPreview();
    this.previewTimer = setInterval(tick, 4000);
    setTimeout(tick, 1500);
  }

  sendPreview() {
    const video = this.previewVideo;
    const canvas = this.previewCanvas;
    if (!video || !canvas || video.readyState < 2) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const scale = Math.min(canvas.width / width, canvas.height / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const x = (canvas.width - drawWidth) / 2;
    const y = (canvas.height - drawHeight) / 2;
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      context.drawImage(video, x, y, drawWidth, drawHeight);
      const preview = canvas.toDataURL('image/jpeg', 0.5);
      getSocket()?.emit('stream:preview', { preview });
    } catch {}
  }

  stopPreview() {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    if (this.previewVideo) {
      try {
        this.previewVideo.pause();
        this.previewVideo.srcObject = null;
      } catch {}
    }
    this.previewVideo = null;
    this.previewCanvas = null;
  }

  handleRemoteEnd({ quiet = false } = {}) {
    const wasActive = Boolean(this.stream || this.localStream);
    this.stream = null;
    this.stopPreview();
    for (const viewerId of [...this.peers.keys()]) this.closePeer(viewerId);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.releaseMedia();
    useApp.getState().setMyStream(null);
    if (wasActive && !quiet) useApp.getState().toast('Трансляция завершена', 'info');
  }

  async stop({ silent = false } = {}) {
    if (this.stopping) return;
    this.stopping = true;
    const streamId = this.stream?.id;
    this.stopPreview();
    for (const viewerId of [...this.peers.keys()]) this.closePeer(viewerId);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.releaseMedia();
    this.stream = null;
    useApp.getState().setMyStream(null);
    if (streamId) {
      try {
        await api(`/api/streams/${streamId}`, { method: 'DELETE' });
      } catch (err) {
        if (!silent) useApp.getState().toast(err.message, 'error');
      }
    }
    if (!silent) useApp.getState().toast('Трансляция остановлена', 'info');
    this.stopping = false;
  }
}

export const streamBroadcaster = new StreamBroadcaster();

// Подключение зрителя. Используется и в приложении, и на публичной
// странице (там своя реализация на чистом JS).
export function watchStream(streamId, handlers = {}) {
  const socket = io(socketUrl(), {
    auth: { streamId, role: 'viewer' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
  });

  let pc = null;
  let hostId = null;
  let remote = new MediaStream();
  let pendingCandidates = [];
  let closed = false;

  const state = (value) => handlers.onState?.(value);

  const closePeer = () => {
    if (!pc) return;
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    } catch {}
    pc = null;
  };

  const createPeer = (from) => {
    closePeer();
    remote = new MediaStream();
    pendingCandidates = [];
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.ontrack = (event) => {
      if (event.streams?.[0]) remote = event.streams[0];
      else remote.addTrack(event.track);
      handlers.onStream?.(remote);
      state('playing');
    };
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('stream:signal', {
        to: from,
        data: { candidate: event.candidate },
      });
    };
    pc.onconnectionstatechange = () => {
      if (!pc || closed) return;
      if (pc.connectionState === 'connected') state('connected');
      else if (pc.connectionState === 'failed') state('failed');
      else if (pc.connectionState === 'disconnected') state('reconnecting');
    };
    return pc;
  };

  const handleSignal = async ({ from, data } = {}) => {
    if (!data || closed) return;
    try {
      if (data.type === 'offer') {
        hostId = from || hostId;
        const connection = createPeer(from);
        state('connecting');
        await connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const queue = pendingCandidates;
        pendingCandidates = [];
        for (const candidate of queue) {
          try {
            await connection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {}
        }
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.emit('stream:signal', {
          to: from,
          data: { type: 'answer', sdp: connection.localDescription },
        });
      } else if (data.candidate) {
        if (pc && pc.remoteDescription?.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch {}
        } else {
          pendingCandidates.push(data.candidate);
        }
      }
    } catch (err) {
      console.warn('[stream viewer] signal error', err);
      state('failed');
    }
  };

  socket.on('stream:ready', (payload = {}) => {
    if (closed) return;
    hostId = payload.hostId || hostId;
    handlers.onInfo?.(payload.stream || null);
    state(payload.hostId ? 'connecting' : 'waiting');
  });
  socket.on('stream:viewers', (payload = {}) => {
    handlers.onViewers?.(Number(payload.viewers) || 0);
  });
  socket.on('stream:signal', handleSignal);
  socket.on('stream:ended', () => {
    if (closed) return;
    state('ended');
    handlers.onEnded?.();
  });
  socket.on('stream:error', (payload = {}) => {
    if (closed) return;
    state('error');
    handlers.onError?.(payload.error || 'Трансляция недоступна');
  });
  socket.on('connect_error', () => {
    if (!closed) state('reconnecting');
  });
  socket.on('disconnect', (reason) => {
    if (closed || reason === 'io client disconnect') return;
    state('reconnecting');
  });

  return {
    close() {
      closed = true;
      socket.removeAllListeners();
      socket.disconnect();
      closePeer();
      remote = new MediaStream();
    },
    get hostId() {
      return hostId;
    },
  };
}
