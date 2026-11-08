import React, { useEffect, useRef } from 'react';
import { useApp } from '../../store';

function StreamAudio({ stream, volume, muted, outputDevice }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream || null;
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    const node = ref.current;
    if (!node?.setSinkId) return;
    const target = outputDevice && outputDevice !== 'default' ? outputDevice : '';
    node.setSinkId(target).catch(() => {});
  }, [outputDevice]);
  return <audio ref={ref} autoPlay playsInline />;
}

export default function AudioOutputs() {
  const streams = useApp((state) => state.voice.streams);
  const screenAudioStreams = useApp((state) => state.voice.screenAudioStreams);
  const deafened = useApp((state) => state.voice.deafened);
  const outputVolume = useApp((state) => state.settings.outputVolume ?? 100);
  const streamVolume = useApp((state) => state.settings.streamVolume ?? 100);
  const streamMuted = useApp((state) => state.settings.streamMuted);
  const outputDevice = useApp((state) => state.settings.outputDevice);
  return (
    <div className="audio-outputs" aria-hidden="true">
      {Object.entries(streams).map(([userId, stream]) => (
        <StreamAudio
          key={userId}
          stream={stream}
          volume={outputVolume / 100}
          muted={deafened}
          outputDevice={outputDevice}
        />
      ))}
      {Object.entries(screenAudioStreams || {}).map(([userId, stream]) => (
        <StreamAudio
          key={`screen-audio-${userId}`}
          stream={stream}
          volume={streamVolume / 100}
          muted={deafened || streamMuted}
          outputDevice={outputDevice}
        />
      ))}
    </div>
  );
}
