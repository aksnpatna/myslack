import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://slack-api.akstest.win';

function authHeader() {
  try { return { Authorization: `Bearer ${localStorage.getItem('myslack_token')}` }; }
  catch { return {}; }
}

// Renders a single remote participant's video track and attaches it once mounted.
function RemoteVideo({ track, identity }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { try { track.detach(el); } catch (_) {} };
  }, [track]);
  return (
    <View style={{ alignItems: 'center' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: 160, height: 120, borderRadius: 8, backgroundColor: '#000', objectFit: 'cover' }}
      />
      <Text style={hs.participantLabel}>{identity}</Text>
    </View>
  );
}

export default function HuddleWorkspace({ user, channel, wsSend }) {
  const [expanded,      setExpanded]      = useState(false);
  const [tokenBusy,     setTokenBusy]     = useState(false);
  const [tokenErr,      setTokenErr]      = useState('');
  const [inCall,        setInCall]        = useState(false);
  const [audioMuted,    setAudioMuted]    = useState(false);
  const [videoOff,      setVideoOff]      = useState(false);
  const [participants,  setParticipants]  = useState([]);   // all identities (local first)
  const [remoteVideos,  setRemoteVideos]  = useState([]);   // [{identity, track}]
  const [deviceWarn,    setDeviceWarn]    = useState('');

  const roomRef         = useRef(null);
  const localAudio      = useRef(null);
  const localVideo      = useRef(null);
  const localVidEl      = useRef(null);
  const remoteAudioEls  = useRef({});   // identity -> <audio> DOM element

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => () => {
    roomRef.current?.disconnect();
    Object.values(remoteAudioEls.current).forEach(el => el.remove());
  }, []);

  // ── Attach local video AFTER inCall=true causes <video> to mount ───
  useEffect(() => {
    if (inCall && localVideo.current && localVidEl.current) {
      localVideo.current.attach(localVidEl.current);
    }
  }, [inCall]);

  // ── Join huddle ──────────────────────────────────────────────────────
  const joinHuddle = useCallback(async () => {
    if (!channel) return;
    setTokenBusy(true);
    setTokenErr('');
    try {
      const res  = await fetch(`${API_URL}/api/media/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body:    JSON.stringify({ channelId: channel.id }),
      });
      const data = await res.json();
      if (!res.ok) { setTokenErr(data.error ?? 'Token request failed.'); return; }

      const { Room, RoomEvent, createLocalTracks, Track } = await import('livekit-client');

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      // ── Remote track subscription ─────────────────────────────────
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        const id = participant.identity;
        if (track.kind === Track.Kind.Audio) {
          // Create a hidden <audio> element for autoplay
          if (!remoteAudioEls.current[id]) {
            const el = Object.assign(document.createElement('audio'), { autoplay: true });
            el.style.display = 'none';
            document.body.appendChild(el);
            remoteAudioEls.current[id] = el;
          }
          track.attach(remoteAudioEls.current[id]);
        } else if (track.kind === Track.Kind.Video) {
          setRemoteVideos(prev => {
            const filtered = prev.filter(r => !(r.identity === id));
            return [...filtered, { identity: id, track }];
          });
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        const id = participant.identity;
        if (track.kind === Track.Kind.Audio) {
          const el = remoteAudioEls.current[id];
          if (el) { track.detach(el); }
        } else if (track.kind === Track.Kind.Video) {
          track.detach();
          setRemoteVideos(prev => prev.filter(r => r.identity !== id));
        }
      });

      room.on(RoomEvent.ParticipantConnected,    () => syncParticipants(room));
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        syncParticipants(room);
        const id = participant.identity;
        const el = remoteAudioEls.current[id];
        if (el) { el.remove(); delete remoteAudioEls.current[id]; }
        setRemoteVideos(prev => prev.filter(r => r.identity !== id));
      });
      room.on(RoomEvent.Disconnected, () => {
        setInCall(false);
        setParticipants([]);
        setRemoteVideos([]);
        Object.values(remoteAudioEls.current).forEach(el => el.remove());
        remoteAudioEls.current = {};
        roomRef.current = null;
      });

      await room.connect(data.livekitUrl, data.token);

      // ── Publish local tracks ──────────────────────────────────────
      setDeviceWarn('');
      let tracks = [];
      try {
        tracks = await createLocalTracks({ audio: true, video: true });
      } catch (devErr) {
        const isNotFound = devErr.name === 'NotFoundError'
          || devErr.name === 'DevicesNotFoundError'
          || /not found|could not start|no device/i.test(devErr.message ?? '');
        if (isNotFound) {
          try {
            tracks = await createLocalTracks({ audio: true, video: false });
            setDeviceWarn('📷 No camera found — joined with audio only.');
          } catch {
            setDeviceWarn('🎤 No mic or camera found — joined in listen-only mode.');
          }
        } else {
          throw devErr;
        }
      }
      for (const t of tracks) {
        await room.localParticipant.publishTrack(t);
        if (t.kind === Track.Kind.Audio) localAudio.current = t;
        if (t.kind === Track.Kind.Video) localVideo.current = t;
        // Local video is attached via the useEffect above once inCall=true mounts <video>
      }

      syncParticipants(room);
      setInCall(true);   // triggers the local-video attach useEffect
    } catch (err) {
      setTokenErr(err.message ?? 'Connection failed.');
    } finally {
      setTokenBusy(false);
    }
  }, [channel]);

  function syncParticipants(room) {
    const names = [...room.participants.values()].map(p => p.identity);
    setParticipants([room.localParticipant.identity, ...names]);
  }

  // ── Leave huddle ─────────────────────────────────────────────────────
  const leaveHuddle = useCallback(async () => {
    await roomRef.current?.disconnect();
    localAudio.current = null;
    localVideo.current = null;
    setInCall(false);
    setParticipants([]);
    setRemoteVideos([]);
    setAudioMuted(false);
    setVideoOff(false);
  }, []);

  // ── Mute / camera controls ───────────────────────────────────────────
  const toggleAudio = useCallback(async () => {
    const track = localAudio.current;
    if (!track) return;
    if (audioMuted) { await track.unmute(); setAudioMuted(false); }
    else            { await track.mute();   setAudioMuted(true);  }
  }, [audioMuted]);

  const toggleVideo = useCallback(async () => {
    const track = localVideo.current;
    if (!track) return;
    if (videoOff) { await track.unmute(); setVideoOff(false); }
    else          { await track.mute();   setVideoOff(true);  }
  }, [videoOff]);

  if (!channel) return null;

  // Remote participants who are audio-only (no video track yet)
  const remoteVideoIds = new Set(remoteVideos.map(r => r.identity));
  const audioOnlyRemotes = participants.slice(1).filter(p => !remoteVideoIds.has(p));

  return (
    <View style={hs.container}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <TouchableOpacity style={hs.header} onPress={() => setExpanded(v => !v)}>
        <Text style={hs.headerIcon}>🎙</Text>
        <Text style={hs.headerTitle}>Huddle Workspace</Text>
        {inCall && <View style={hs.liveDot} />}
        <Text style={hs.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={hs.body}>
          {!!tokenErr   && <Text style={hs.errText}>{tokenErr}</Text>}
          {!!deviceWarn && <Text style={hs.warnText}>{deviceWarn}</Text>}

          {/* ── Not in call ──────────────────────────────────────── */}
          {!inCall && (
            <TouchableOpacity style={hs.joinBtn} onPress={joinHuddle} disabled={tokenBusy}>
              {tokenBusy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={hs.joinBtnText}>🎙 Join Huddle</Text>}
            </TouchableOpacity>
          )}

          {/* ── In call ──────────────────────────────────────────── */}
          {inCall && (
            <View style={hs.callPanel}>
              {/* Video grid */}
              <View style={hs.videoGrid}>
                {/* Local preview */}
                <View style={{ alignItems: 'center' }}>
                  <View style={hs.videoWrap}>
                    <video
                      ref={localVidEl}
                      autoPlay
                      muted
                      playsInline
                      style={{
                        width: 160, height: 120,
                        borderRadius: 8, backgroundColor: '#000',
                        objectFit: 'cover', opacity: videoOff ? 0.15 : 1,
                      }}
                    />
                    {videoOff && (
                      <View style={hs.videoOffBadge}>
                        <Text style={{ color: '#fff', fontSize: 11 }}>Camera Off</Text>
                      </View>
                    )}
                  </View>
                  <Text style={hs.participantLabel}>You</Text>
                </View>

                {/* Remote videos */}
                {remoteVideos.map(({ identity, track }) => (
                  <RemoteVideo key={identity} track={track} identity={identity} />
                ))}
              </View>

              {/* Audio-only remote participants */}
              {audioOnlyRemotes.length > 0 && (
                <View style={hs.participantList}>
                  {audioOnlyRemotes.map(p => (
                    <View key={p} style={hs.participantChip}>
                      <Text style={hs.participantText}>🎙 {p}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Controls */}
              <View style={hs.controls}>
                <TouchableOpacity
                  style={[hs.ctrlBtn, audioMuted && hs.ctrlBtnActive]}
                  onPress={toggleAudio}
                >
                  <Text style={hs.ctrlBtnText}>{audioMuted ? '🔇 Unmute' : '🎙 Mute'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[hs.ctrlBtn, videoOff && hs.ctrlBtnActive]}
                  onPress={toggleVideo}
                >
                  <Text style={hs.ctrlBtnText}>{videoOff ? '📷 Show Video' : '📷 Hide Video'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={hs.leaveBtn} onPress={leaveHuddle}>
                  <Text style={hs.leaveBtnText}>Leave</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const hs = StyleSheet.create({
  container:        { borderBottomWidth: 1, borderBottomColor: '#2d2f33', backgroundColor: '#1a1d21' },
  header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  headerIcon:       { fontSize: 16 },
  headerTitle:      { flex: 1, color: '#d1d2d3', fontSize: 13, fontWeight: '600' },
  chevron:          { color: '#555', fontSize: 11 },
  liveDot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2ecc71', marginRight: 4 },
  body:             { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  errText:          { color: '#e74c3c', fontSize: 12 },
  warnText:         { color: '#f39c12', fontSize: 12, marginTop: 4 },
  joinBtn:          { backgroundColor: '#1164a3', borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  joinBtnText:      { color: '#fff', fontWeight: '700', fontSize: 14 },
  callPanel:        { gap: 10 },
  videoGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  videoWrap:        { position: 'relative' },
  videoOffBadge:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)' },
  participantLabel: { color: '#888', fontSize: 11, marginTop: 3, textAlign: 'center' },
  participantList:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  participantChip:  { backgroundColor: '#2c2f33', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  participantText:  { color: '#d1d2d3', fontSize: 12 },
  controls:         { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  ctrlBtn:          { flex: 1, minWidth: 80, backgroundColor: '#2c2f33', borderRadius: 6, paddingVertical: 8, alignItems: 'center' },
  ctrlBtnActive:    { backgroundColor: '#4a2c2c' },
  ctrlBtnText:      { color: '#d1d2d3', fontSize: 13 },
  leaveBtn:         { backgroundColor: '#c0392b', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center' },
  leaveBtnText:     { color: '#fff', fontWeight: '700', fontSize: 13 },
});
