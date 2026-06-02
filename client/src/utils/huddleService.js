import { useEffect, useRef, useCallback } from 'react';
import { AppState, Platform }             from 'react-native';
import { Audio }                          from 'expo-av';
import {
  Room,
  RoomEvent,
  VideoPresets,
  createLocalAudioTrack,
} from '@livekit/react-native';

/**
 * Requests OS background audio priority so the connection survives
 * screen lock and app backgrounding on both platforms.
 */
async function acquireBackgroundAudioSession() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS:          true,
    playsInSilentModeIOS:        true,   // keeps audio alive when iOS silent switch is on
    staysActiveInBackground:     true,   // prevents OS from suspending the audio session
    interruptionModeIOS:         Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
    shouldDuckAndroid:           false,
    interruptionModeAndroid:     Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
    playThroughEarpieceAndroid:  false,
  });
}

async function releaseAudioSession() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS:      false,
    staysActiveInBackground: false,
    playsInSilentModeIOS:    false,
  });
}

/**
 * Connects to a LiveKit huddle room with background-persistent audio.
 * Returns a disconnect handle for manual cleanup.
 *
 * @param {string} serverUrl  — LiveKit server WebSocket URL
 * @param {string} token      — signed JWT from /api/huddles/join
 * @returns {Promise<{ room: Room, disconnect: () => Promise<void> }>}
 */
export async function connectToHuddle(serverUrl, token) {
  await acquireBackgroundAudioSession();

  const room = new Room({
    adaptiveStream:       true,
    dynacast:             true,
    audioCaptureDefaults: {
      echoCancellation:   true,
      noiseSuppression:   true,
      autoGainControl:    true,
    },
  });

  room.on(RoomEvent.Disconnected, async () => {
    await releaseAudioSession();
  });

  room.on(RoomEvent.MediaDevicesError, (err) => {
    console.error('[huddle] media device error', err.message);
  });

  await room.connect(serverUrl, token, { autoSubscribe: true });

  const audioTrack = await createLocalAudioTrack({
    echoCancellation:  true,
    noiseSuppression:  true,
    autoGainControl:   true,
  });
  await room.localParticipant.publishTrack(audioTrack);

  async function disconnect() {
    await room.localParticipant.unpublishAllTracks();
    await room.disconnect();
    await releaseAudioSession();
  }

  return { room, disconnect };
}

/**
 * React hook that manages a huddle connection lifecycle,
 * including cleanup on unmount and AppState changes.
 *
 * @param {string|null} serverUrl
 * @param {string|null} token
 */
export function useHuddle(serverUrl, token) {
  const roomRef       = useRef(null);
  const disconnectRef = useRef(null);
  const appState      = useRef(AppState.currentState);

  const leave = useCallback(async () => {
    if (disconnectRef.current) {
      await disconnectRef.current();
      disconnectRef.current = null;
      roomRef.current       = null;
    }
  }, []);

  useEffect(() => {
    if (!serverUrl || !token) return;

    let active = true;
    connectToHuddle(serverUrl, token).then(({ room, disconnect }) => {
      if (!active) { disconnect(); return; }
      roomRef.current       = room;
      disconnectRef.current = disconnect;
    }).catch((err) => console.error('[huddle] connect error', err.message));

    // Re-assert background audio priority when returning from background
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        acquireBackgroundAudioSession().catch(() => {});
      }
      appState.current = next;
    });

    return () => {
      active = false;
      sub.remove();
      leave();
    };
  }, [serverUrl, token]);

  return { leave };
}
