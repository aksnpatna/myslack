import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://slack-api.akstest.win';

export default function LoginScreen({ onAuth }) {
  const [mode,     setMode]     = useState('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');

  const switchMode = (m) => { setMode(m); setError(''); setInfo(''); };

  const handleSubmit = async () => {
    setError(''); setInfo('');
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message ?? 'Request failed.');
        return;
      }

      if (mode === 'register') {
        setInfo(data.message);
        setMode('login');
        setPassword('');
        return;
      }

      onAuth(data.token);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.root}>
      <View style={s.card}>
        <Text style={s.brand}>myslack</Text>
        <Text style={s.tagline}>Private workspace</Text>

        <View style={s.tabs}>
          <TouchableOpacity
            style={[s.tab, mode === 'login' && s.tabActive]}
            onPress={() => switchMode('login')}
          >
            <Text style={[s.tabText, mode === 'login' && s.tabTextActive]}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, mode === 'register' && s.tabActive]}
            onPress={() => switchMode('register')}
          >
            <Text style={[s.tabText, mode === 'register' && s.tabTextActive]}>Register</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {!!error && <Text style={s.errorText}>{error}</Text>}
        {!!info  && <Text style={s.infoText}>{info}</Text>}

        <TouchableOpacity style={s.btn} onPress={handleSubmit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{mode === 'login' ? 'Sign in' : 'Request access'}</Text>
          }
        </TouchableOpacity>

        {mode === 'register' && (
          <Text style={s.hint}>
            New accounts require admin approval before they can sign in.
          </Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#1a1d21', justifyContent: 'center', alignItems: 'center' },
  card:          { width: 360, backgroundColor: '#222529', borderRadius: 8, padding: 32, gap: 16 },
  brand:         { color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  tagline:       { color: '#9b9b9b', fontSize: 13, textAlign: 'center', marginTop: -8 },
  tabs:          { flexDirection: 'row', gap: 4, marginTop: 8 },
  tab:           { flex: 1, paddingVertical: 8, borderRadius: 4, alignItems: 'center', backgroundColor: '#2c2f33' },
  tabActive:     { backgroundColor: '#1164a3' },
  tabText:       { color: '#9b9b9b', fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: '#fff' },
  input:         { backgroundColor: '#1a1d21', color: '#fff', borderRadius: 6, paddingHorizontal: 14, paddingVertical: Platform.OS === 'web' ? 12 : 10, fontSize: 15, borderWidth: 1, borderColor: '#333' },
  btn:           { backgroundColor: '#1164a3', borderRadius: 6, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  btnText:       { color: '#fff', fontWeight: '700', fontSize: 15 },
  errorText:     { color: '#e74c3c', fontSize: 13, textAlign: 'center' },
  infoText:      { color: '#2ecc71', fontSize: 13, textAlign: 'center' },
  hint:          { color: '#666', fontSize: 12, textAlign: 'center' },
});
