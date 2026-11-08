import { useApp } from './store';
import { playSound } from './sounds';

const ICE_SERVERS = [
  {
    urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  },
];

function audioConstraints(deviceId) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
    sampleSize: 16,
    latency: 0.01,
  };
  if (deviceId && deviceId !== 'default') audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

function videoConstraints(deviceId) {
  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 },
  };
  if (deviceId && deviceId !== 'default') video.deviceId = { exact: deviceId };
  return { audio: false, video };
}

// Если сохранённое устройство отключили или его ID изменился,
// автоматически переходим на устройство по умолчанию.
function isMissingDevice(err) {
  return err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError';
}

export async function requestMic(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia(audioConstraints(deviceId));
  } catch (err) {
    if (deviceId && deviceId !== 'default' && isMissingDevice(err)) {
      return navigator.mediaDevices.getUserMedia(audioConstraints('default'));
    }
    throw err;
  }
}

async function requestCamera(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints(deviceId).video,
    });
  } catch (err) {
    if (deviceId && deviceId !== 'default' && isMissingDevice(err)) {
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints('default').video,
      });
    }
    throw err;
  }
}

class VoiceManager {
  constructor() {
    this.socket = null;
    this.pcs = new Map();
    this.localStream = null;
    this.cameraStream = null;
    this.screenStream = null;
    this.screenAudioStream = null;
    this.remoteStreams = new Map();
    this.remoteTracks = new Map();
    this.videoSenders = new Map();
    this.screenAudioSenders = new Map();
    this.iceQueues = new Map();
    this.channelId = null;
    this.joined = false;
    this.muted = false;
    this.deafened = false;
    this.pttActive = false;
    this.pttPrevMuted = false;
    this.cameraOn = false;
    this.screenOn = false;
    this.screenTrackHandler = null;
    this.audioCtx = null;
    this.analyser = null;
    this.vadRaf = null;
    this.speaking = false;
    this.lastSpeakEmit = 0;
  }

  attachSocket(socket) {
    if (this.socket === socket) return;
    this.detachSocket();
    this.socket = socket;
    socket.on('voice:signal', this.handleSignal);
    socket.on('voice:state', this.handleVoiceState);
  }

  detachSocket() {
    if (this.socket) {
      this.socket.off('voice:signal', this.handleSignal);
      this.socket.off('voice:state', this.handleVoiceState);
    }
    if (this.joined) {
      this.cleanupLocal();
      this.joined = false;
      this.channelId = null;
      useApp.getState().resetVoice();
    }
    this.socket = null;
  }

  handleDisconnect = () => {
    if (!this.joined) return;
    playSound('leave');
    this.cleanupLocal();
    this.joined = false;
    this.channelId = null;
    useApp.getState().resetVoice();
    useApp.getState().toast('Соединение потеряно — голосовой чат отключён', 'error');
  };

  handleVoiceState = ({ channelId, participants }) => {
    if (!this.joined || channelId !== this.channelId) return;
    const me = useApp.getState().user;
    const list = participants || [];
    if (me && !list.some((p) => p.userId === me.id)) {
      if (this.joined) playSound('leave');
      this.cleanupLocal();
      this.joined = false;
      this.channelId = null;
      useApp.getState().resetVoice();
      useApp.getState().toast('Вы больше не в голосовом канале', 'info');
      return;
    }
    const remoteIds = new Set(list.filter((p) => p.userId !== me?.id).map((p) => p.userId));
    for (const userId of [...this.pcs.keys()]) {
      if (!remoteIds.has(userId)) this.closePeer(userId);
    }
    for (const userId of remoteIds) this.syncRemoteStreams(userId);
  };

  async join(channelId) {
    if (!this.socket?.connected) {
      useApp.getState().toast('Нет соединения с сервером', 'error');
      return;
    }
    if (this.joined && this.channelId === channelId) {
      useApp.getState().setVoice({ stageOpen: true });
      return;
    }
    await this.leave({ silent: true });

    const state = useApp.getState();
    const settings = state.settings;
    this.deafened = false;
    this.muted = false;
    this.channelId = channelId;
    state.setVoice({
      channelId,
      connecting: true,
      joined: false,
      stageOpen: true,
      muted: false,
      deafened: false,
      camera: false,
      screen: false,
      participants: [],
      streams: {},
      error: null,
    });

    try {
      this.localStream = await requestMic(settings.inputDevice);
    } catch (err) {
      this.localStream = null;
      this.muted = true;
      state.toast('Микрофон недоступен — вы подключены в режиме прослушивания', 'info');
    }
    if (this.localStream && settings.pushToTalk) {
      this.muted = true;
      for (const track of this.localStream.getAudioTracks()) track.enabled = false;
    }

    const payload = {
      channelId,
      muted: this.muted,
      deafened: this.deafened,
      voiceStreamId: this.localStream?.id || '',
    };
    this.socket.timeout(12000).emit('voice:join', payload, (err, res) => {
      if (this.channelId !== channelId) return;
      if (err || !res?.ok) {
        this.cleanupLocal();
        this.joined = false;
        this.channelId = null;
        useApp.getState().resetVoice();
        useApp.getState().toast(err ? 'Не удалось подключиться к голосовому каналу' : res.error, 'error');
        return;
      }
      this.joined = true;
      this.muted = Boolean(res.self?.muted);
      this.deafened = Boolean(res.self?.deafened);
      useApp.getState().setVoice({
        channelId,
        joined: true,
        connecting: false,
        muted: this.muted,
        deafened: this.deafened,
        participants: res.participants || [],
      });
      for (const participant of res.participants || []) {
        this.createPeer(participant.userId, true);
      }
      this.startVAD();
      playSound('join');
    });
  }

  async leave(options = {}) {
    const { silent = false } = options;
    const wasJoined = this.joined;
    if (this.joined && this.socket?.connected && !silent) {
      this.socket.emit('voice:leave');
    }
    if (wasJoined && !silent) playSound('leave');
    this.cleanupLocal();
    this.joined = false;
    this.channelId = null;
    useApp.getState().resetVoice();
  }

  cleanupLocal() {
    this.stopVAD();
    for (const userId of [...this.pcs.keys()]) this.closePeer(userId);
    this.pcs.clear();
    this.videoSenders.clear();
    this.screenAudioSenders.clear();
    this.iceQueues.clear();
    this.remoteStreams.clear();
    this.remoteTracks.clear();
    this.stopStream(this.localStream);
    this.stopStream(this.cameraStream);
    this.stopStream(this.screenStream);
    this.stopStream(this.screenAudioStream);
    this.localStream = null;
    this.cameraStream = null;
    this.screenStream = null;
    this.screenAudioStream = null;
    this.screenTrackHandler = null;
    this.cameraOn = false;
    this.screenOn = false;
    this.speaking = false;
    this.muted = false;
    this.deafened = false;
    this.pttActive = false;
    this.pttPrevMuted = false;
  }

  stopStream(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch {}
    }
  }

  closePeer(userId) {
    const pc = this.pcs.get(userId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {}
    }
    this.pcs.delete(userId);
    this.videoSenders.delete(userId);
    this.screenAudioSenders.delete(userId);
    this.iceQueues.delete(userId);
    this.remoteStreams.delete(userId);
    this.remoteTracks.delete(userId);
    useApp.getState().removeVoiceStream(userId);
  }

  createPeer(userId, initiator) {
    if (!userId || userId === useApp.getState().user?.id) return null;
    const existing = this.pcs.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pcs.set(userId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        try { pc.addTrack(track, this.localStream); } catch {}
      }
    }

    const videoTrack = this.currentVideoTrack();
    if (videoTrack) {
      const stream = this.screenStream || this.cameraStream;
      try {
        const sender = pc.addTrack(videoTrack, stream);
        this.videoSenders.set(userId, sender);
      } catch {}
    }

    const screenAudioTrack = this.screenAudioStream?.getAudioTracks?.()[0];
    if (screenAudioTrack && screenAudioTrack.readyState === 'live') {
      try {
        const sender = pc.addTrack(screenAudioTrack, this.screenAudioStream);
        this.screenAudioSenders.set(userId, sender);
      } catch {}
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) this.emitSignal(userId, { candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const track = event.track;
      const streamId = event.streams?.[0]?.id || '';
      const entries = this.remoteTracks.get(userId) || [];
      entries.push({ track, streamId });
      this.remoteTracks.set(userId, entries);
      track.addEventListener('ended', () => {
        const list = this.remoteTracks.get(userId) || [];
        const next = list.filter((entry) => entry.track !== track);
        if (next.length) this.remoteTracks.set(userId, next);
        else this.remoteTracks.delete(userId);
        this.syncRemoteStreams(userId);
      });
      this.syncRemoteStreams(userId);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // Одна повторная попытка ICE restart, затем закрываем соединение.
        try {
          pc.restartIce();
        } catch {
          this.closePeer(userId);
        }
      }
    };

    if (initiator) this.makeOffer(userId, pc);
    return pc;
  }

  // Раскладывает входящие дорожки на голос и отдельный звук трансляции.
  // Дорожка звука экрана приходит в своём MediaStream (screenAudioStreamId),
  // поэтому её можно регулировать независимо от микрофона.
  syncRemoteStreams(userId) {
    const state = useApp.getState();
    const participant =
      (state.voiceStates?.[this.channelId] || []).find((item) => item.userId === userId) ||
      (state.voice.participants || []).find((item) => item.userId === userId);
    const screenAudioId = String(participant?.screenAudioStreamId || '');
    const voiceStreamId = String(participant?.voiceStreamId || '');
    const screenActive = Boolean(participant?.screen);
    const entries = (this.remoteTracks.get(userId) || []).filter(
      (entry) => entry.track.readyState !== 'ended'
    );

    const mainEntries = [];
    const screenEntries = [];
    for (const entry of entries) {
      const isScreenAudio =
        entry.track.kind === 'audio' &&
        ((screenAudioId && entry.streamId === screenAudioId) ||
          (screenActive &&
            !screenAudioId &&
            voiceStreamId &&
            entry.streamId &&
            entry.streamId !== voiceStreamId));
      if (isScreenAudio) screenEntries.push(entry);
      else mainEntries.push(entry);
    }

    const current = this.remoteStreams.get(userId);
    const currentTracks = current?.getTracks() || [];
    const sameMain =
      current &&
      currentTracks.length === mainEntries.length &&
      mainEntries.every((entry) => currentTracks.includes(entry.track));
    if (!sameMain) {
      const stream = new MediaStream(mainEntries.map((entry) => entry.track));
      this.remoteStreams.set(userId, stream);
      useApp.getState().setVoiceStream(userId, new MediaStream(stream.getTracks()));
    }

    if (screenEntries.length) {
      const currentScreen = state.voice.screenAudioStreams?.[userId];
      const screenTracks = currentScreen?.getTracks() || [];
      const sameScreen =
        currentScreen &&
        screenTracks.length === screenEntries.length &&
        screenEntries.every((entry) => screenTracks.includes(entry.track));
      if (!sameScreen) {
        useApp
          .getState()
          .setVoiceScreenAudioStream(
            userId,
            new MediaStream(screenEntries.map((entry) => entry.track))
          );
      }
    } else {
      useApp.getState().removeVoiceScreenAudioStream(userId);
    }
  }

  async makeOffer(userId, pc) {
    try {
      if (pc.signalingState !== 'stable') return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.emitSignal(userId, { type: 'offer', sdp: pc.localDescription });
    } catch (err) {
      console.warn('[voice] offer error', err);
    }
  }

  handleSignal = async (payload = {}) => {
    const { from, data } = payload;
    if (!from || !data || !this.joined) return;
    if (!this.pcs.has(from)) this.createPeer(from, false);
    const pc = this.pcs.get(from);
    if (!pc) return;
    try {
      if (data.type === 'offer') {
        if (pc.signalingState === 'have-local-offer') {
          try { await pc.setLocalDescription({ type: 'rollback' }); } catch {}
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await this.flushIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.emitSignal(from, { type: 'answer', sdp: pc.localDescription });
      } else if (data.type === 'answer') {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          await this.flushIce(from, pc);
        }
      } else if (data.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
        } else {
          const queue = this.iceQueues.get(from) || [];
          queue.push(data.candidate);
          this.iceQueues.set(from, queue);
        }
      }
    } catch (err) {
      console.warn('[voice] signal error', err);
    }
  };

  async flushIce(userId, pc) {
    const queue = this.iceQueues.get(userId) || [];
    this.iceQueues.delete(userId);
    for (const candidate of queue) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    }
  }

  emitSignal(to, data) {
    this.socket?.emit('voice:signal', { to, data });
  }

  async renegotiateAll() {
    for (const [userId, pc] of this.pcs.entries()) {
      await this.makeOffer(userId, pc);
    }
  }

  currentVideoTrack() {
    const track = this.screenStream?.getVideoTracks?.()[0] || this.cameraStream?.getVideoTracks?.()[0];
    return track && track.readyState === 'live' ? track : null;
  }

  async applyVideoTrack(track, stream) {
    let needsRenegotiation = false;
    for (const [userId, pc] of this.pcs.entries()) {
      const sender = this.videoSenders.get(userId);
      if (sender) {
        try { await sender.replaceTrack(track); } catch {}
      } else if (track) {
        try {
          const newSender = pc.addTrack(track, stream);
          this.videoSenders.set(userId, newSender);
          needsRenegotiation = true;
        } catch {}
      }
    }
    return needsRenegotiation;
  }

  // Добавляет звук трансляции в каждое соединение отдельной дорожкой.
  attachScreenAudio() {
    const track = this.screenAudioStream?.getAudioTracks?.()[0];
    if (!track) return false;
    let added = false;
    for (const [userId, pc] of this.pcs.entries()) {
      if (this.screenAudioSenders.has(userId)) continue;
      try {
        const sender = pc.addTrack(track, this.screenAudioStream);
        this.screenAudioSenders.set(userId, sender);
        added = true;
      } catch {}
    }
    return added;
  }

  async stopVideo() {
    const hadVideo = this.cameraOn || this.screenOn;
    const hadScreenAudio =
      Boolean(this.screenAudioStream?.getAudioTracks?.().length) ||
      this.screenAudioSenders.size > 0;
    this.cameraOn = false;
    this.screenOn = false;
    this.stopStream(this.cameraStream);
    this.stopStream(this.screenStream);
    this.stopStream(this.screenAudioStream);
    this.cameraStream = null;
    this.screenStream = null;
    this.screenAudioStream = null;
    this.screenTrackHandler = null;
    for (const sender of this.videoSenders.values()) {
      try { await sender.replaceTrack(null); } catch {}
    }
    for (const [userId, sender] of this.screenAudioSenders.entries()) {
      const pc = this.pcs.get(userId);
      try { pc?.removeTrack(sender); } catch {}
    }
    this.screenAudioSenders.clear();
    useApp.getState().setVoice({ camera: false, screen: false });
    if (hadVideo || hadScreenAudio) this.emitUpdate();
    if (hadScreenAudio) await this.renegotiateAll();
  }

  async toggleCamera() {
    if (!this.joined) {
      useApp.getState().toast('Сначала подключитесь к голосовому каналу', 'info');
      return;
    }
    if (this.cameraOn) {
      await this.stopVideo();
      playSound('cameraStop');
      return;
    }
    await this.stopVideo();
    try {
      const stream = await requestCamera(useApp.getState().settings.videoDevice);
      this.cameraStream = stream;
      this.cameraOn = true;
      useApp.getState().setVoice({ camera: true, screen: false });
      const needsRenegotiation = await this.applyVideoTrack(stream.getVideoTracks()[0], stream);
      if (needsRenegotiation) await this.renegotiateAll();
      this.emitUpdate();
      playSound('cameraStart');
    } catch (err) {
      useApp.getState().toast(`Не удалось включить камеру: ${err.message}`, 'error');
    }
  }

  async toggleScreen() {
    if (!this.joined) {
      useApp.getState().toast('Сначала подключитесь к голосовому каналу', 'info');
      return;
    }
    if (this.screenOn) {
      await this.stopVideo();
      playSound('screenStop');
      return;
    }

    // В Electron показываем свой выбор монитора: системный пикер
    // в Windows работает нестабильно и не даёт миниатюры экранов.
    let sourceId = '';
    if (window.desktop?.listScreenSources && window.desktop?.selectScreenSource) {
      try {
        const sources = await window.desktop.listScreenSources();
        if (sources.length) {
          sourceId = await useApp.getState().requestScreenSource(sources);
          if (!sourceId) return;
          await window.desktop.selectScreenSource(sourceId);
        }
      } catch (err) {
        console.warn('[voice] Не удалось получить список экранов:', err.message);
      }
    }

    await this.stopVideo();
    try {
      // Запрашиваем звук вместе с экраном. В Electron это системный
      // loopback (звук компьютера), в браузере — звук выбранной вкладки.
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') throw err;
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Источник экрана не выбран');
      const audioTrack = stream.getAudioTracks()[0] || null;
      this.screenAudioStream = audioTrack ? new MediaStream([audioTrack]) : null;
      this.screenTrackHandler = () => {
        if (this.screenOn) {
          playSound('screenStop');
          this.stopVideo();
        }
      };
      track.addEventListener('ended', this.screenTrackHandler);
      this.screenStream = stream;
      this.screenOn = true;
      const audioAdded = this.attachScreenAudio();
      useApp.getState().setVoice({ camera: false, screen: true });
      // Сначала сообщаем зрителям id аудиопотока, затем пересобираем SDP.
      this.emitUpdate();
      const needsVideo = await this.applyVideoTrack(track, stream);
      if (needsVideo || audioAdded) await this.renegotiateAll();
      playSound('screenStart');
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        useApp.getState().toast(`Не удалось показать экран: ${err.message}`, 'error');
      }
    }
  }

  emitUpdate() {
    this.socket?.emit('voice:update', {
      muted: this.muted,
      deafened: this.deafened,
      camera: this.cameraOn,
      screen: this.screenOn,
      voiceStreamId: this.localStream?.id || '',
      screenAudioStreamId: this.screenAudioStream?.id || '',
    });
  }

  emitSpeaking(speaking) {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.speakingSince = speaking ? performance.now() : 0;
    this.socket?.emit('voice:speaking', { speaking });
    useApp.getState().setSelfSpeaking(speaking);
  }

  async enableMic() {
    if (!this.joined) return;
    try {
      const stream = await requestMic(useApp.getState().settings.inputDevice);
      this.localStream = stream;
      this.muted = false;
      this.deafened = false;
      const track = stream.getAudioTracks()[0];
      let renegotiate = false;
      for (const [userId, pc] of this.pcs.entries()) {
        try {
          if (track) {
            pc.addTrack(track, stream);
            renegotiate = true;
          }
        } catch {}
      }
      if (track) track.enabled = true;
      if (renegotiate) await this.renegotiateAll();
      this.startVAD();
      useApp.getState().setVoice({ muted: false, deafened: false });
      this.emitUpdate();
      playSound('unmute');
    } catch (err) {
      useApp.getState().toast(`Микрофон недоступен: ${err.message}`, 'error');
    }
  }

  async toggleMute() {
    if (!this.joined) {
      useApp.getState().toast('Сначала подключитесь к голосовому каналу', 'info');
      return;
    }
    if (!this.localStream) {
      await this.enableMic();
      return;
    }
    this.muted = !this.muted;
    if (!this.muted && this.deafened) this.deafened = false;
    for (const track of this.localStream.getAudioTracks()) track.enabled = !this.muted;
    if (this.muted) this.emitSpeaking(false);
    useApp.getState().setVoice({ muted: this.muted, deafened: this.deafened });
    this.emitUpdate();
    playSound(this.muted ? 'mute' : 'unmute');
  }

  // Режим рации: микрофон включается только пока удерживают клавишу/кнопку.
  async pttStart() {
    if (!this.joined || this.deafened || this.pttActive) return;
    if (!useApp.getState().settings.pushToTalk) return;
    this.pttActive = true;
    this.pttPrevMuted = this.muted;
    if (!this.localStream) {
      await this.enableMic();
      if (!this.pttActive) return;
      if (!this.localStream) {
        this.pttActive = false;
        useApp.getState().setVoice({ ptt: false });
        return;
      }
    }
    this.muted = false;
    for (const track of this.localStream.getAudioTracks()) track.enabled = true;
    useApp.getState().setVoice({ muted: false, ptt: true });
    this.emitUpdate();
  }

  pttEnd() {
    if (!this.pttActive) return;
    this.pttActive = false;
    const restoreMuted = this.pttPrevMuted;
    this.pttPrevMuted = false;
    if (restoreMuted) {
      this.muted = true;
      if (this.localStream) {
        for (const track of this.localStream.getAudioTracks()) track.enabled = false;
      }
      this.emitSpeaking(false);
    }
    useApp.getState().setVoice({ muted: this.muted, ptt: false });
    this.emitUpdate();
  }

  // Включает/выключает режим рации на лету из настроек.
  applyPushToTalk(enabled) {
    if (!enabled) {
      this.pttEnd();
      return;
    }
    if (!this.joined || this.muted) return;
    this.muted = true;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = false;
    }
    this.emitSpeaking(false);
    useApp.getState().setVoice({ muted: true, ptt: false });
    this.emitUpdate();
  }

  async toggleDeafen() {
    if (!this.joined) {
      useApp.getState().toast('Сначала подключитесь к голосовому каналу', 'info');
      return;
    }
    this.deafened = !this.deafened;
    if (this.deafened) this.muted = true;
    else this.muted = Boolean(useApp.getState().settings.pushToTalk);
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = !this.muted;
    }
    if (this.muted) this.emitSpeaking(false);
    useApp.getState().setVoice({ muted: this.muted, deafened: this.deafened });
    this.emitUpdate();
    playSound(this.deafened ? 'deafen' : 'undeafen');
  }

  async changeInputDevice(deviceId) {
    if (!this.joined) return;
    try {
      const stream = await requestMic(deviceId);
      const track = stream.getAudioTracks()[0];
      let needsRenegotiation = false;
      for (const [userId, pc] of this.pcs.entries()) {
        let sender = null;
        for (const s of pc.getSenders()) {
          if (s.track && s.track.kind === 'audio') { sender = s; break; }
        }
        if (sender && track) {
          try { await sender.replaceTrack(track); } catch {}
        } else if (track) {
          try {
            pc.addTrack(track, stream);
            needsRenegotiation = true;
          } catch {}
        }
      }
      this.stopStream(this.localStream);
      this.localStream = stream;
      if (track) track.enabled = !this.muted;
      this.startVAD();
      if (needsRenegotiation) await this.renegotiateAll();
      this.emitUpdate();
      useApp.getState().toast('Микрофон переключён', 'success');
    } catch (err) {
      useApp.getState().toast(`Не удалось переключить микрофон: ${err.message}`, 'error');
    }
  }

  startVAD() {
    this.stopVAD();
    if (!this.localStream) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.audioCtx = new Ctx();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
      const source = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.65;
      source.connect(this.analyser);
      const data = new Uint8Array(this.analyser.fftSize);

      // Гистерезис: включаемся заметно выше, выключаемся ниже порога шума.
      // Удержание не даёт рамке мигать на коротких паузах между словами.
      const ON_LEVEL = 0.05;
      const OFF_LEVEL = 0.018;
      const ATTACK_MS = 90;
      const RELEASE_MS = 340;
      const MIN_SPEAK_MS = 380;

      let level = 0;
      let aboveSince = 0;
      let belowSince = 0;
      let startedAt = 0;

      const tick = (now) => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const value = (data[i] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        // Быстрый подъём и медленный спад — уровень не дрожит от шума.
        level += (rms - level) * (rms > level ? 0.4 : 0.06);

        const canSpeak = !this.muted && !this.deafened;
        if (!canSpeak) {
          level = 0;
          aboveSince = 0;
          belowSince = 0;
          startedAt = 0;
          if (this.speaking) this.emitSpeaking(false);
        } else if (!this.speaking) {
          if (level >= ON_LEVEL) {
            if (!aboveSince) aboveSince = now;
            if (now - aboveSince >= ATTACK_MS) {
              startedAt = now;
              belowSince = 0;
              this.emitSpeaking(true);
            }
          } else {
            aboveSince = 0;
          }
        } else if (level <= OFF_LEVEL) {
          if (!belowSince) belowSince = now;
          const minHeld = now - startedAt >= MIN_SPEAK_MS;
          if (minHeld && now - belowSince >= RELEASE_MS) this.emitSpeaking(false);
        } else {
          belowSince = 0;
        }
        this.vadRaf = requestAnimationFrame(tick);
      };
      this.vadRaf = requestAnimationFrame(tick);
    } catch (err) {
      console.warn('[voice] VAD error', err);
    }
  }

  stopVAD() {
    if (this.vadRaf) cancelAnimationFrame(this.vadRaf);
    this.vadRaf = null;
    this.analyser = null;
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
      this.audioCtx = null;
    }
    if (this.speaking) this.emitSpeaking(false);
    useApp.getState().setSelfSpeaking(false);
  }

  async reconnect(channelId) {
    if (!channelId) return;
    await this.join(channelId);
  }
}

export const voiceManager = new VoiceManager();
