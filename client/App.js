import { useState, useEffect, useCallback } from 'react';
import { SafeAreaView, StatusBar, View, ActivityIndicator } from 'react-native';
import MainWorkspace from './src/screens/MainWorkspace';
import LoginScreen   from './src/screens/LoginScreen';

const API_URL     = process.env.EXPO_PUBLIC_API_URL ?? 'https://slack-api.akstest.win';
const STORAGE_KEY = 'myslack_token';

function getStoredToken() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else       localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export default function App() {
  const [user,     setUser]     = useState(null);
  const [channels, setChannels] = useState([]);
  const [ready,    setReady]    = useState(false);

  const hydrateFromToken = useCallback(async (token) => {
    try {
      const [meRes, chRes] = await Promise.all([
        fetch(`${API_URL}/api/me`,       { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/channels`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!meRes.ok) throw new Error('token invalid');
      const me  = await meRes.json();
      const chs = chRes.ok ? await chRes.json() : [];
      setUser(me);
      setChannels(chs.map((c) => ({ ...c, isMember: true })));
    } catch {
      setStoredToken(null);
      setUser(null);
      setChannels([]);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (token) {
      hydrateFromToken(token).finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [hydrateFromToken]);

  const handleAuth = useCallback(async (token) => {
    setStoredToken(token);
    await hydrateFromToken(token);
  }, [hydrateFromToken]);

  const handleLogout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    setChannels([]);
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a1d21', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#1164a3" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1d21' }}>
      <StatusBar barStyle="light-content" />
      {user
        ? <MainWorkspace user={user} channels={channels} onLogout={handleLogout} />
        : <LoginScreen onAuth={handleAuth} />
      }
    </SafeAreaView>
  );
}
