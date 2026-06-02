import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, Modal, ActivityIndicator,
  TouchableOpacity, StyleSheet, Platform, Alert, Linking, useWindowDimensions,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import HuddleWorkspace    from './HuddleWorkspace';
import CollabCanvas       from './CollabCanvas';
import { useSovereignMode }   from '../hooks/useSovereignMode';
import SovereignHeader        from '../components/sovereign/SovereignHeader';
import BentoMetricCard        from '../components/sovereign/BentoMetricCard';
import ObfuscatedMessage      from '../components/sovereign/ObfuscatedMessage';

const WS_URL  = process.env.EXPO_PUBLIC_WS_URL  ?? 'wss://slack-api.akstest.win/ws/chat';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://slack-api.akstest.win';

function authHeader() {
  try { return { Authorization: `Bearer ${localStorage.getItem('myslack_token')}` }; }
  catch { return {}; }
}

export default function MainWorkspace({ user, channels, onLogout }) {
  const isAdmin = user.role === 'admin';

  // ── Sovereign Mode toggle (Phase 3)
  const [sovereignMode, toggleSovereignMode] = useSovereignMode();

  // ── channel list (local copy so we can push new channels without refetch)
  const [localChannels, setLocalChannels] = useState(channels);
  useEffect(() => { setLocalChannels(channels); }, [channels]);

  const [activeChannel, setActiveChannel] = useState(channels[0] ?? null);
  const [activeThread,  setActiveThread]  = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState('');
  const [threadInput,   setThreadInput]   = useState('');
  const wsRef = useRef(null);
  const [showSidebar, setShowSidebar] = useState(false);

  // ── file attachment state
  const [pendingFile,    setPendingFile]  = useState(null);
  const [uploadBusy,     setUploadBusy]   = useState(false);
  const pendingUploadRef = useRef(null);

  // ── channel-creator modal state (admin only)
  const [showNewCh,   setShowNewCh]   = useState(false);
  const [newChName,   setNewChName]   = useState('');
  const [newChErr,    setNewChErr]    = useState('');
  const [newChBusy,   setNewChBusy]   = useState(false);

  // ── canvas / whiteboard state
  const [showCanvas,  setShowCanvas]  = useState(false);
  const [brushColor,  setBrushColor]  = useState('#e8912d');
  const [brushSize,   setBrushSize]   = useState(4);

  // ── admin ops panel state
  const [users,       setUsers]       = useState([]);
  const [mapUserId,   setMapUserId]   = useState('');
  const [mapChannelId,setMapChannelId]= useState('');
  const [mapAlias,    setMapAlias]    = useState('');
  const [mapBusy,     setMapBusy]     = useState(false);
  const [mapErr,      setMapErr]      = useState('');
  const [mapOk,       setMapOk]       = useState('');
  const [showUserDrop,setShowUserDrop]= useState(false);
  const [showChDrop,  setShowChDrop]  = useState(false);

  // ── pending-approvals panel state
  const [approveBusy, setApproveBusy] = useState({});
  const [approveErr,  setApproveErr]  = useState('');

  // ── quarantine feed state (admin only)
  const [quarantineLogs, setQuarantineLogs] = useState([]);
  const [qLogsBusy,      setQLogsBusy]      = useState(false);

  // ── Phase 4: Topic threading state
  // topicsMap: { [channelId]: Topic[] }
  const [topicsMap,        setTopicsMap]        = useState({});
  const [expandedChannels, setExpandedChannels] = useState({});
  const [activeTopic,      setActiveTopic]      = useState(null);

  // ── Sovereign metrics (Phase 3) — polled only when sovereign mode is on
  const [sovereignMetrics, setSovereignMetrics] = useState([]);

  // Load topics for all visible channels once channel list is ready
  useEffect(() => {
    if (!localChannels.length) return;
    const load = async () => {
      const entries = await Promise.all(
        localChannels.map(async (ch) => {
          try {
            const r = await fetch(`${API_URL}/api/channels/${ch.id}/topics`, { headers: authHeader() });
            if (!r.ok) return [ch.id, []];
            return [ch.id, await r.json()];
          } catch {
            return [ch.id, []];
          }
        }),
      );
      setTopicsMap(Object.fromEntries(entries));
    };
    load();
  }, [localChannels]);

  // Fetch latest system metrics when sovereign mode is active (admin only)
  useEffect(() => {
    if (!sovereignMode || !isAdmin) return;
    const fetchMetrics = () => {
      fetch(`${API_URL}/api/admin/sovereign/metrics?limit=4`, { headers: authHeader() })
        .then((r) => r.ok ? r.json() : [])
        .then(setSovereignMetrics)
        .catch(() => {});
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, [sovereignMode, isAdmin]);

  // ── load message history whenever active channel changes
  useEffect(() => {
    if (!activeChannel) return;
    const chId = activeChannel.id;
    setMessages((prev) => prev.filter((m) => m.channelId !== chId));
    fetch(`${API_URL}/api/channels/${chId}/messages`, { headers: authHeader() })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((history) => setMessages((prev) => {
        const filtered = prev.filter((m) => m.channelId !== chId);
        return [...filtered, ...history];
      }))
      .catch((err) => console.warn('[messages] history fetch failed', err));
  }, [activeChannel?.id]);

  // fetch user list once for admin panel
  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API_URL}/api/admin/users`, { headers: authHeader() })
      .then((r) => r.ok ? r.json() : [])
      .then(setUsers)
      .catch(() => {});
  }, [isAdmin]);

  // fetch quarantine logs once for admin panel
  useEffect(() => {
    if (!isAdmin) return;
    setQLogsBusy(true);
    fetch(`${API_URL}/api/admin/quarantine-logs?limit=50`, { headers: authHeader() })
      .then((r) => r.ok ? r.json() : [])
      .then(setQuarantineLogs)
      .catch(() => {})
      .finally(() => setQLogsBusy(false));
  }, [isAdmin]);

  const activeChannelRef  = useRef(activeChannel);
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);
  const shouldReconnectRef = useRef(true);
  const reconnectTimerRef  = useRef(null);

  useEffect(() => {
    const userId = user.id;
    shouldReconnectRef.current = true;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        const ch = activeChannelRef.current;
        if (ch) ws.send(JSON.stringify({ type: 'subscribe', userId, channelId: ch.id }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // canvas_draw frames are handled by CollabCanvas — skip accumulation
          if (msg.type === 'canvas_draw') return;
          setMessages((prev) => [...prev, msg]);
          // upload queued file once we have the server-assigned messageId
          const pending = pendingUploadRef.current;
          if (pending && msg.id && msg.channelId === pending.channelId && msg.content === pending.content) {
            pendingUploadRef.current = null;
            const form = new FormData();
            if (Platform.OS === 'web' && pending.file.file instanceof File) {
              form.append('file', pending.file.file);
            } else {
              form.append('file', { uri: pending.file.uri, name: pending.file.name, type: pending.file.mimeType ?? 'application/octet-stream' });
            }
            setUploadBusy(true);
            fetch(`${API_URL}/api/files/upload?messageId=${encodeURIComponent(msg.id)}&uploaderId=${encodeURIComponent(userId)}`, {
              method: 'POST',
              headers: authHeader(),
              body: form,
            })
              .then((r) => r.ok ? r.json() : Promise.reject(r.status))
              .then((uploadResult) => {
                // Dispatch attachment frame so all channel members see the file card
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    userId:     pending.userId,
                    channelId:  pending.channelId,
                    content:    `\uD83D\uDCCE ${pending.file.name}`,
                    attachment: {
                      id:   uploadResult.fileId,
                      path: uploadResult.path,
                      name: pending.file.name,
                    },
                  }));
                }
              })
              .catch(() => {})
              .finally(() => setUploadBusy(false));
          }
        } catch { /* ignore malformed frames */ }
      };
      ws.onerror = (e) => console.warn('[ws] error', e?.message);
      ws.onclose = () => {
        if (shouldReconnectRef.current) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };
    }

    connect();
    return () => {
      shouldReconnectRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  const wsSend = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // re-subscribe when active channel changes so live messages arrive
  useEffect(() => {
    if (!activeChannel) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', userId: user.id, channelId: activeChannel.id }));
    }
  }, [activeChannel?.id, user.id]);

  // ── create channel
  const handleCreateChannel = useCallback(async () => {
    setNewChErr('');
    if (!newChName.trim()) { setNewChErr('Channel name is required.'); return; }
    setNewChBusy(true);
    try {
      const res  = await fetch(`${API_URL}/api/admin/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ name: newChName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setNewChErr(data.message ?? 'Failed.'); return; }
      setLocalChannels((prev) => [...prev, { ...data.channel, isMember: true }]);
      setNewChName('');
      setShowNewCh(false);
    } catch { setNewChErr('Network error.'); }
    finally   { setNewChBusy(false); }
  }, [newChName]);

  // ── add member mapping
  const handleAddMember = useCallback(async () => {
    setMapErr(''); setMapOk('');
    if (!mapUserId || !mapChannelId) { setMapErr('User and channel are required.'); return; }
    setMapBusy(true);
    try {
      const res  = await fetch(`${API_URL}/api/admin/channels/add-member`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ userId: mapUserId, channelId: mapChannelId, displayAlias: mapAlias || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setMapErr(data.message ?? 'Failed.'); return; }
      setMapOk('Member mapped successfully.');
      setMapUserId(''); setMapChannelId(''); setMapAlias('');
    } catch { setMapErr('Network error.'); }
    finally   { setMapBusy(false); }
  }, [mapUserId, mapChannelId, mapAlias]);

  const handleApproval = useCallback(async (userId, newStatus) => {
    setApproveBusy((prev) => ({ ...prev, [userId]: true }));
    setApproveErr('');
    try {
      const res  = await fetch(`${API_URL}/api/admin/users/${userId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body:    JSON.stringify({ newStatus }),
      });
      const data = await res.json();
      if (!res.ok) { setApproveErr(data.message ?? 'Action failed.'); return; }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status: newStatus } : u));
    } catch { setApproveErr('Network error.'); }
    finally   { setApproveBusy((prev) => { const n = { ...prev }; delete n[userId]; return n; }); }
  }, []);

  const visibleChannels = isAdmin
    ? localChannels
    : localChannels.filter((c) => c.isMember);

  const feedMessages  = messages.filter(
    (m) => m.channelId === activeChannel?.id && m.parentId === null,
  );
  const threadReplies = activeThread
    ? messages.filter((m) => m.parentId === activeThread.id)
    : [];

  const handlePickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.size !== undefined && asset.size > 25 * 1024 * 1024) {
      Alert.alert('File too large', 'Maximum file size is 25 MB.');
      return;
    }
    setPendingFile(asset);
  }, []);

  const handleSend = useCallback(() => {
    if (!input.trim() || !activeChannel) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      Alert.alert('Reconnecting…', 'Chat connection is being restored. Please try again in a moment.');
      return;
    }
    const content = input.trim();
    if (pendingFile) {
      pendingUploadRef.current = { file: pendingFile, content, channelId: activeChannel.id, userId: user.id };
      setPendingFile(null);
    }
    wsSend({ userId: user.id, channelId: activeChannel.id, content, parentId: null });
    setInput('');
  }, [input, activeChannel, user.id, wsSend, pendingFile]);

  const handleThreadReply = useCallback(() => {
    if (!threadInput.trim() || !activeThread) return;
    wsSend({ userId: user.id, channelId: activeChannel.id, content: threadInput.trim(), parentId: activeThread.id });
    setThreadInput('');
  }, [threadInput, activeChannel, activeThread, user.id, wsSend]);

  const selectedUser    = users.find((u) => u.id === mapUserId);
  const selectedChannel = localChannels.find((c) => c.id === mapChannelId);

  const { width } = useWindowDimensions();
  const isMobile  = width < 768;

  return (
    <View style={s.root}>

      {/* ── New-channel modal (admin) ────────────────────────── */}
      {isAdmin && (
        <Modal transparent animationType="fade" visible={showNewCh} onRequestClose={() => setShowNewCh(false)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowNewCh(false)}>
            <TouchableOpacity activeOpacity={1} style={s.modalCard} onPress={() => {}}>
              <Text style={s.modalTitle}>New Channel</Text>
              <TextInput
                style={s.modalInput}
                placeholder="channel-name"
                placeholderTextColor="#666"
                value={newChName}
                onChangeText={setNewChName}
                autoCapitalize="none"
                autoFocus
                onSubmitEditing={handleCreateChannel}
              />
              {!!newChErr && <Text style={s.errText}>{newChErr}</Text>}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity style={[s.modalBtn, s.modalBtnSecondary]} onPress={() => { setShowNewCh(false); setNewChErr(''); setNewChName(''); }}>
                  <Text style={s.modalBtnSecText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.modalBtn} onPress={handleCreateChannel} disabled={newChBusy}>
                  {newChBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.modalBtnText}>Create</Text>}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <View style={[s.sidebar, isMobile && s.sidebarMobile, isMobile && !showSidebar && s.sidebarHidden]}>

        {/* ── Sovereign Mode toggle ─────────────────────── */}
        <TouchableOpacity
          style={[s.sovereignToggle, sovereignMode && s.sovereignToggleActive]}
          onPress={toggleSovereignMode}
        >
          <Text style={[s.sovereignToggleText, sovereignMode && s.sovereignToggleTextActive]}>
            {sovereignMode ? '⬡ SOVEREIGN MODE ON' : '⬡ SOVEREIGN MODE'}
          </Text>
        </TouchableOpacity>

        {/* Channels / Project Containers heading + optional '+' for admin */}
        <View style={s.sidebarHeadingRow}>
          <Text style={s.sidebarHeading}>
            {sovereignMode ? 'PROJECT CONTAINERS' : 'Channels'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {isAdmin && (
              <TouchableOpacity style={s.addBtn} onPress={() => { setShowNewCh(true); setNewChErr(''); setNewChName(''); }}>
                <Text style={s.addBtnText}>+</Text>
              </TouchableOpacity>
            )}
            {isMobile && (
              <TouchableOpacity style={s.addBtn} onPress={() => setShowSidebar(false)}>
                <Text style={s.addBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }}>
          {/* ── Sovereign Metrics bento row (admin, sovereign mode only) ── */}
          {sovereignMode && isAdmin && sovereignMetrics.length > 0 && (
            <View style={s.bentoRow}>
              {sovereignMetrics.slice(0, 4).map((m) => (
                <BentoMetricCard
                  key={m.id}
                  label={m.node_id}
                  value={m.latency_ms != null ? `${m.latency_ms}ms` : (m.cpu_pct != null ? `${m.cpu_pct}%` : '—')}
                  subValue={m.cpu_pct != null && m.latency_ms != null ? `CPU ${m.cpu_pct}%` : undefined}
                  status={m.latency_ms > 500 || m.cpu_pct > 80 ? 'warning' : 'ok'}
                  nodeId={m.node_id}
                />
              ))}
            </View>
          )}

          {/* ── Project Containers / Channel list ─────────────────────── */}
          {visibleChannels.map((ch) => {
            const chTopics   = topicsMap[ch.id] ?? [];
            const isExpanded = expandedChannels[ch.id] ?? false;
            const isActive   = activeChannel?.id === ch.id;

            if (!sovereignMode) {
              // ── Standard (non-sovereign) flat channel row ──
              return (
                <TouchableOpacity
                  key={ch.id}
                  style={[s.channelRow, isActive && s.channelRowActive]}
                  onPress={() => { setActiveChannel(ch); setActiveThread(null); setActiveTopic(null); if (isMobile) setShowSidebar(false); }}
                >
                  <Text style={s.channelName}># {ch.name}</Text>
                </TouchableOpacity>
              );
            }

            // ── Sovereign: Project Container with collapsible Topic Streams ──
            return (
              <View key={ch.id} style={s.projectContainer}>
                {/* Project Container header */}
                <TouchableOpacity
                  style={[s.projectHeader, isActive && s.projectHeaderActive]}
                  onPress={() => {
                    setActiveChannel(ch);
                    setActiveThread(null);
                    setActiveTopic(null);
                    setExpandedChannels((prev) => ({ ...prev, [ch.id]: !prev[ch.id] }));
                    if (isMobile && !chTopics.length) setShowSidebar(false);
                  }}
                >
                  <Text style={s.projectExpandIcon}>{isExpanded ? '▾' : '▸'}</Text>
                  <Text style={[s.projectName, isActive && s.projectNameActive]} numberOfLines={1}>
                    {ch.name.toUpperCase()}
                  </Text>
                  {chTopics.length > 0 && (
                    <Text style={s.topicCount}>{chTopics.length}</Text>
                  )}
                </TouchableOpacity>

                {/* Topic Streams (visible when expanded) */}
                {isExpanded && chTopics.map((topic) => {
                  const statusColor =
                    topic.status === 'RESOLVING'  ? '#ff6b35' :
                    topic.status === 'MONITORING' ? '#ffca28' : '#00e676';
                  const isTopicActive = activeTopic?.id === topic.id;

                  return (
                    <TouchableOpacity
                      key={topic.id}
                      style={[s.topicRow, isTopicActive && s.topicRowActive]}
                      onPress={() => {
                        setActiveTopic(topic);
                        setActiveChannel(ch);
                        setActiveThread(null);
                        if (isMobile) setShowSidebar(false);
                      }}
                    >
                      <View style={[s.topicStatusDot, { backgroundColor: statusColor }]} />
                      <Text style={[s.topicName, isTopicActive && s.topicNameActive]} numberOfLines={1}>
                        {topic.name}
                      </Text>
                      <View style={[s.topicBadge, { borderColor: statusColor }]}>
                        <Text style={[s.topicBadgeText, { color: statusColor }]}>{topic.status}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

          {/* ── Admin Operations Panel ─────────────────────── */}
          {isAdmin && (
            <View style={s.adminPanel}>
              <Text style={s.adminPanelTitle}>Admin Operations</Text>

              {/* User picker */}
              <Text style={s.adminLabel}>Target User</Text>
              <TouchableOpacity style={s.picker} onPress={() => { setShowUserDrop((v) => !v); setShowChDrop(false); }}>
                <Text style={selectedUser ? s.pickerVal : s.pickerPlaceholder} numberOfLines={1}>
                  {selectedUser ? `${selectedUser.email}` : 'Select user…'}
                </Text>
                <Text style={s.pickerCaret}>{showUserDrop ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {showUserDrop && (
                <View style={s.dropList}>
                  {users.map((u) => (
                    <TouchableOpacity key={u.id} style={[s.dropItem, u.id === mapUserId && s.dropItemActive]}
                      onPress={() => { setMapUserId(u.id); setShowUserDrop(false); }}>
                      <Text style={s.dropItemText} numberOfLines={1}>{u.email}</Text>
                      <Text style={s.dropItemSub}>{u.role} · {u.status}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Channel picker */}
              <Text style={s.adminLabel}>Target Channel</Text>
              <TouchableOpacity style={s.picker} onPress={() => { setShowChDrop((v) => !v); setShowUserDrop(false); }}>
                <Text style={selectedChannel ? s.pickerVal : s.pickerPlaceholder} numberOfLines={1}>
                  {selectedChannel ? `# ${selectedChannel.name}` : 'Select channel…'}
                </Text>
                <Text style={s.pickerCaret}>{showChDrop ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {showChDrop && (
                <View style={s.dropList}>
                  {localChannels.map((c) => (
                    <TouchableOpacity key={c.id} style={[s.dropItem, c.id === mapChannelId && s.dropItemActive]}
                      onPress={() => { setMapChannelId(c.id); setShowChDrop(false); }}>
                      <Text style={s.dropItemText}># {c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Display alias */}
              <Text style={s.adminLabel}>Display Alias <Text style={s.adminLabelOpt}>(optional)</Text></Text>
              <TextInput
                style={s.adminInput}
                placeholder="e.g. Aks"
                placeholderTextColor="#555"
                value={mapAlias}
                onChangeText={setMapAlias}
              />

              {!!mapErr && <Text style={s.errText}>{mapErr}</Text>}
              {!!mapOk  && <Text style={s.okText}>{mapOk}</Text>}

              <TouchableOpacity style={s.execBtn} onPress={handleAddMember} disabled={mapBusy}>
                {mapBusy
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.execBtnText}>Execute Mapping</Text>
                }
              </TouchableOpacity>

              {/* ── Pending Approvals ───────────────────────── */}
              {users.some((u) => u.status === 'pending') && (
                <View style={s.approvalPanel}>
                  <Text style={s.adminLabel}>Pending Approvals</Text>
                  {!!approveErr && <Text style={s.errText}>{approveErr}</Text>}
                  {users.filter((u) => u.status === 'pending').map((u) => (
                    <View key={u.id} style={s.approvalRow}>
                      <Text style={s.approvalEmail} numberOfLines={1}>{u.email}</Text>
                      <View style={s.approvalBtns}>
                        <TouchableOpacity
                          style={[s.approvalBtn, s.approvalBtnApprove]}
                          onPress={() => handleApproval(u.id, 'approved')}
                          disabled={!!approveBusy[u.id]}
                        >
                          {approveBusy[u.id]
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={s.approvalBtnText}>✓ Approve</Text>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.approvalBtn, s.approvalBtnReject]}
                          onPress={() => handleApproval(u.id, 'rejected')}
                          disabled={!!approveBusy[u.id]}
                        >
                          <Text style={s.approvalBtnText}>✗ Reject</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ── Quarantine & Threat Logs (admin only) ────── */}
          {isAdmin && (
            <View style={s.qPanel}>
              <Text style={s.qPanelTitle}>⚠️ QUARANTINE & THREAT LOGS</Text>
              {qLogsBusy && <ActivityIndicator color="#f39c12" size="small" style={{ marginTop: 8 }} />}
              {!qLogsBusy && quarantineLogs.length === 0 && (
                <Text style={s.qEmpty}>No violations recorded.</Text>
              )}
              {quarantineLogs.map((log) => (
                <View key={log.id} style={s.qRow}>
                  <View style={s.qRowHeader}>
                    <Text style={s.qTs}>{new Date(log.created_at).toLocaleString()}</Text>
                    <Text style={s.qChannel} numberOfLines={1}>ch: {log.channel_id?.slice(0, 8)}…</Text>
                  </View>
                  <Text style={s.qUser} numberOfLines={1}>{log.violator_email ?? log.violating_user_id ?? '—'}</Text>
                  <Text style={s.qBlocked} numberOfLines={2}>{log.raw_blocked_text?.slice(0, 120)}</Text>
                  {!!log.flagged_reason && <Text style={s.qReason}>{log.flagged_reason}</Text>}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <TouchableOpacity style={s.logoutBtn} onPress={onLogout}>
          <Text style={s.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      {/* ── Mobile sidebar backdrop ───────────────────────────── */}
      {isMobile && showSidebar && (
        <TouchableOpacity style={s.mobileBackdrop} activeOpacity={1} onPress={() => setShowSidebar(false)} />
      )}
      {/* ── Main feed ───────────────────────────────────────── */}
      <View style={s.feed}>
        {/* Sovereign Header (shown only in sovereign mode) */}
        {sovereignMode && (
          <SovereignHeader
            nodeLocation={process.env.EXPO_PUBLIC_NODE_LOCATION ?? 'LOCAL'}
            e2eeVerified
            isAdmin={isAdmin}
            channelName={activeTopic ? `${activeChannel?.name} › ${activeTopic.name}` : activeChannel?.name}
          />
        )}
        <View style={s.feedHeaderRow}>
          {isMobile && (
            <TouchableOpacity style={s.hamburger} onPress={() => setShowSidebar(true)}>
              <Text style={s.hamburgerIcon}>☰</Text>
            </TouchableOpacity>
          )}
          <Text style={s.feedHeaderText}>
            {activeTopic
              ? `# ${activeChannel?.name} › ${activeTopic.name}`
              : `# ${activeChannel?.name ?? '—'}`}
          </Text>
          {/* Board toggle */}
          <TouchableOpacity
            style={[s.boardToggleBtn, showCanvas && s.boardToggleBtnActive]}
            onPress={() => setShowCanvas((v) => !v)}
          >
            <Text style={s.boardToggleText}>✏️ {showCanvas ? 'Close Board' : 'Open Board'}</Text>
          </TouchableOpacity>
          {isMobile && activeThread && (
            <TouchableOpacity style={s.hamburger} onPress={() => setActiveThread(null)}>
              <Text style={[s.hamburgerIcon, { fontSize: 16 }]}>▼ Thread</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Huddle Workspace tray ─────────────────────────────── */}
        <HuddleWorkspace user={user} channel={activeChannel} wsSend={wsSend} />

        {/* ── Collaborative Whiteboard ──────────────────────────── */}
        {showCanvas && (
          <View style={s.canvasPanel}>
            {/* Brush toolbar */}
            <View style={s.brushToolbar}>
              <Text style={s.brushLabel}>Brush</Text>
              {['#e8912d', '#e74c3c', '#2ecc71', '#1d9bd1', '#ffffff', '#9b59b6'].map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.brushSwatch, { backgroundColor: c }, brushColor === c && s.brushSwatchActive]}
                  onPress={() => setBrushColor(c)}
                />
              ))}
              <Text style={s.brushLabel}>Size</Text>
              {[2, 4, 8, 14].map((sz) => (
                <TouchableOpacity
                  key={sz}
                  style={[s.sizeBtn, brushSize === sz && s.sizeBtnActive]}
                  onPress={() => setBrushSize(sz)}
                >
                  <Text style={s.sizeBtnText}>{sz}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <CollabCanvas
              channelId={activeChannel?.id}
              userId={user.id}
              wsSend={wsSend}
              wsRef={wsRef}
              color={brushColor}
              brushSize={brushSize}
              onClose={() => setShowCanvas(false)}
            />
          </View>
        )}

        <ScrollView style={s.messageList} contentContainerStyle={[s.messageListContent, feedMessages.length === 0 && s.messageListEmpty]}>
          {feedMessages.length === 0 && (
            <View style={s.watermark}>
              <Text style={s.watermarkIcon}>✨</Text>
              <Text style={s.watermarkTitle}>Project Intelligent Workspace</Text>
              <Text style={s.watermarkBody}>
                {'This channel is secured and monitored by our Automated Project Director. Type your questions directly using \u2018@agent\u2019 to analyze attached documents, check onboarding queues, or request administrative help inline.'}
              </Text>
            </View>
          )}
          {feedMessages.map((msg) => (
            <TouchableOpacity
              key={msg.id}
              style={s.messageBubble}
              onPress={() => setActiveThread(msg)}
            >
              <Text style={s.messageSender}>{msg.sender}</Text>
              <Text style={s.messageBody}>{msg.content}</Text>
              {msg.attachment && (
                <TouchableOpacity
                  style={s.attachBox}
                  onPress={() => msg.attachment.path && Linking.openURL(`${API_URL}${msg.attachment.path}`)}
                >
                  <Text style={s.attachIcon}>📎</Text>
                  <Text style={s.attachName} numberOfLines={1}>{msg.attachment.name ?? msg.attachment.path}</Text>
                </TouchableOpacity>
              )}
              {msg.replyCount > 0 && (
                <Text style={s.replyCount}>{msg.replyCount} repl{msg.replyCount === 1 ? 'y' : 'ies'}</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {pendingFile && (
          <View style={s.fileChip}>
            <Text style={s.fileChipName} numberOfLines={1}>📎 {pendingFile.name}</Text>
            <TouchableOpacity onPress={() => setPendingFile(null)}>
              <Text style={s.fileChipDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={s.inputRow}>
          <TouchableOpacity style={s.clipBtn} onPress={handlePickFile}>
            <Text style={{ color: '#9b9b9b', fontSize: 18 }}>📎</Text>
          </TouchableOpacity>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Type a message, or use @agent to pull project metrics and files..."
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity style={[s.sendBtn, uploadBusy && { opacity: 0.6 }]} onPress={handleSend} disabled={uploadBusy}>
            {uploadBusy
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.sendBtnText}>Send</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Thread panel (conditional) ──────────────────────── */}
      {activeThread && (
        <View style={[s.threadPanel, isMobile && s.threadPanelMobile]}>
          <View style={s.threadHeader}>
            <Text style={s.threadTitle}>Thread</Text>
            <TouchableOpacity onPress={() => setActiveThread(null)}>
              <Text style={s.threadClose}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Root message */}
          <View style={[s.messageBubble, s.threadRoot]}>
            <Text style={s.messageSender}>{activeThread.sender}</Text>
            <Text style={s.messageBody}>{activeThread.content}</Text>
          </View>

          <ScrollView style={s.messageList} contentContainerStyle={s.messageListContent}>
            {threadReplies.map((msg) => (
              <View key={msg.id} style={s.messageBubble}>
                <Text style={s.messageSender}>{msg.sender}</Text>
                <Text style={s.messageBody}>{msg.content}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={threadInput}
              onChangeText={setThreadInput}
              placeholder="Reply in thread…"
              onSubmitEditing={handleThreadReply}
              returnKeyType="send"
            />
            <TouchableOpacity style={s.sendBtn} onPress={handleThreadReply}>
              <Text style={s.sendBtnText}>Reply</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:               { flex: 1, flexDirection: 'row', backgroundColor: '#1a1d21' },

  // sidebar
  sidebar:            { width: 260, backgroundColor: '#19171d', paddingTop: 16, flexDirection: 'column' },
  sidebarMobile:      { position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 10, width: '80%', maxWidth: 300, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 12, elevation: 10 },
  sidebarHidden:      { display: 'none' },
  mobileBackdrop:     { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 9 },
  sidebarHeadingRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 4 },
  sidebarHeading:     { color: '#9b9b9b', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  addBtn:             { width: 22, height: 22, borderRadius: 4, backgroundColor: '#2c2f33', alignItems: 'center', justifyContent: 'center' },
  addBtnText:         { color: '#aaa', fontSize: 14, lineHeight: 20 },
  channelRow:         { paddingVertical: 6, paddingHorizontal: 16 },
  channelRowActive:   { backgroundColor: '#1164a3' },
  channelName:        { color: '#d1d2d3', fontSize: 15 },
  logoutBtn:          { margin: 12, padding: 10, borderRadius: 6, backgroundColor: '#2c2f33', alignItems: 'center' },
  logoutText:         { color: '#9b9b9b', fontSize: 13 },

  // ── Sovereign mode toggle ─────────────────────────────────────────────────
  sovereignToggle:         { marginHorizontal: 10, marginTop: 8, marginBottom: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: '#1a2e50', backgroundColor: '#0d1a30', alignItems: 'center' },
  sovereignToggleActive:   { borderColor: '#0066ff', backgroundColor: 'rgba(0,102,255,0.10)' },
  sovereignToggleText:     { color: '#3a5070', fontSize: 9, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier', textTransform: 'uppercase', letterSpacing: 1 },
  sovereignToggleTextActive:{ color: '#0066ff', fontWeight: '700' },

  // ── Project Container (sovereign sidebar) ────────────────────────────────
  projectContainer:        { marginBottom: 2 },
  projectHeader:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, gap: 5 },
  projectHeaderActive:     { backgroundColor: 'rgba(0,102,255,0.15)' },
  projectExpandIcon:       { color: '#3a5070', fontSize: 10, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier', width: 10 },
  projectName:             { color: '#5e7a9e', fontSize: 10, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier', fontWeight: '700', letterSpacing: 0.8, flex: 1 },
  projectNameActive:       { color: '#0066ff' },
  topicCount:              { color: '#3a5070', fontSize: 8, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier', backgroundColor: '#0d1a30', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },

  // ── Topic Stream rows ────────────────────────────────────────────────────
  topicRow:                { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 20, gap: 6 },
  topicRowActive:          { backgroundColor: 'rgba(0,102,255,0.12)' },
  topicStatusDot:          { width: 5, height: 5, borderRadius: 2.5, flexShrink: 0 },
  topicName:               { color: '#4a6a8a', fontSize: 11, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier', flex: 1 },
  topicNameActive:         { color: '#e8f4ff' },
  topicBadge:              { borderRadius: 3, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 1 },
  topicBadgeText:          { fontSize: 7, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier', fontWeight: '700', letterSpacing: 0.5 },

  // ── Bento metrics row ────────────────────────────────────────────────────
  bentoRow:                { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 6, flexWrap: 'wrap' },

  // admin operations panel
  adminPanel:         { margin: 10, marginTop: 20, padding: 12, backgroundColor: '#1e1f23', borderRadius: 8, borderWidth: 1, borderColor: '#2d2f33' },
  adminPanelTitle:    { color: '#e8912d', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  adminLabel:         { color: '#9b9b9b', fontSize: 11, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  adminLabelOpt:      { color: '#555', fontWeight: '400' },
  adminInput:         { backgroundColor: '#16181d', color: '#fff', borderRadius: 5, paddingHorizontal: 10, paddingVertical: Platform.OS === 'web' ? 8 : 6, fontSize: 13, borderWidth: 1, borderColor: '#333' },
  picker:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16181d', borderRadius: 5, paddingHorizontal: 10, paddingVertical: Platform.OS === 'web' ? 8 : 6, borderWidth: 1, borderColor: '#333' },
  pickerVal:          { color: '#fff', fontSize: 13, flex: 1 },
  pickerPlaceholder:  { color: '#555', fontSize: 13, flex: 1 },
  pickerCaret:        { color: '#555', fontSize: 10, marginLeft: 6 },
  dropList:           { backgroundColor: '#16181d', borderRadius: 5, borderWidth: 1, borderColor: '#333', marginTop: 2, maxHeight: 140 },
  dropItem:           { paddingHorizontal: 10, paddingVertical: 7 },
  dropItemActive:     { backgroundColor: '#1164a3' },
  dropItemText:       { color: '#d1d2d3', fontSize: 13 },
  dropItemSub:        { color: '#666', fontSize: 10, marginTop: 1 },
  execBtn:            { backgroundColor: '#1164a3', borderRadius: 5, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  execBtnText:        { color: '#fff', fontWeight: '700', fontSize: 13 },
  approvalPanel:      { marginTop: 16, borderTopWidth: 1, borderTopColor: '#333', paddingTop: 12 },
  approvalRow:        { marginBottom: 8 },
  approvalEmail:      { color: '#ccc', fontSize: 11, marginBottom: 4 },
  approvalBtns:       { flexDirection: 'row', gap: 6 },
  approvalBtn:        { flex: 1, paddingVertical: 6, borderRadius: 4, alignItems: 'center' },
  approvalBtnApprove: { backgroundColor: '#27ae60' },
  approvalBtnReject:  { backgroundColor: '#c0392b' },
  approvalBtnText:    { color: '#fff', fontSize: 12, fontWeight: '600' },
  qPanel:             { marginTop: 16, borderTopWidth: 1, borderTopColor: '#f39c12', paddingTop: 12 },
  qPanelTitle:        { color: '#f39c12', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  qEmpty:             { color: '#555', fontSize: 11, marginTop: 4 },
  qRow:               { backgroundColor: '#1a1510', borderRadius: 4, padding: 8, marginBottom: 6, borderLeftWidth: 2, borderLeftColor: '#f39c12' },
  qRowHeader:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  qTs:                { color: '#888', fontSize: 10 },
  qChannel:           { color: '#666', fontSize: 10 },
  qUser:              { color: '#e67e22', fontSize: 11, fontWeight: '600', marginBottom: 2 },
  qBlocked:           { color: '#ccc', fontSize: 11, fontStyle: 'italic' },
  qReason:            { color: '#e74c3c', fontSize: 10, marginTop: 2 },
  errText:            { color: '#e74c3c', fontSize: 11, marginTop: 6 },
  okText:             { color: '#2ecc71', fontSize: 11, marginTop: 6 },

  // new channel modal
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard:          { width: 320, backgroundColor: '#222529', borderRadius: 8, padding: 24, gap: 12 },
  modalTitle:         { color: '#fff', fontSize: 17, fontWeight: '700' },
  modalInput:         { backgroundColor: '#1a1d21', color: '#fff', borderRadius: 6, paddingHorizontal: 12, paddingVertical: Platform.OS === 'web' ? 10 : 8, fontSize: 15, borderWidth: 1, borderColor: '#444' },
  modalBtn:           { flex: 1, backgroundColor: '#1164a3', borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  modalBtnSecondary:  { backgroundColor: '#2c2f33' },
  modalBtnText:       { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalBtnSecText:    { color: '#9b9b9b', fontWeight: '600', fontSize: 14 },

  // feed
  feed:               { flex: 1, flexDirection: 'column', minWidth: 0 },
  feedHeaderRow:      { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333' },
  feedHeaderText:     { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', padding: 16 },
  hamburger:          { paddingHorizontal: 14, paddingVertical: 14 },
  hamburgerIcon:      { color: '#d1d2d3', fontSize: 22 },
  messageList:        { flex: 1 },
  messageListContent: { padding: 16, gap: 12 },
  messageListEmpty:   { flex: 1, justifyContent: 'center' },
  watermark:          { alignItems: 'center', paddingHorizontal: 40, paddingVertical: 32, gap: 12 },
  watermarkIcon:      { fontSize: 36 },
  watermarkTitle:     { color: '#8b95a3', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  watermarkBody:      { color: '#6b7480', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  messageBubble:      { paddingVertical: 4 },
  messageSender:      { color: '#fff', fontWeight: '600', fontSize: 14 },
  messageBody:        { color: '#d1d2d3', fontSize: 15, marginTop: 2 },
  replyCount:         { color: '#1d9bd1', fontSize: 12, marginTop: 4 },

  // input
  inputRow:           { flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#333', alignItems: 'center', overflow: 'hidden' },
  input:              { flex: 1, minWidth: 0, backgroundColor: '#222529', color: '#fff', borderRadius: 6, paddingHorizontal: 12, paddingVertical: Platform.OS === 'web' ? 10 : 8, fontSize: 15 },
  sendBtn:            { flexShrink: 0, backgroundColor: '#1164a3', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'center', alignItems: 'center' },
  sendBtnText:        { color: '#fff', fontWeight: '600' },

  // file attachment
  fileChip:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2c2f33', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, marginHorizontal: 12, marginBottom: 4, gap: 8 },
  fileChipName:       { flex: 1, color: '#d1d2d3', fontSize: 13 },
  fileChipDismiss:    { color: '#9b9b9b', fontSize: 14, paddingHorizontal: 4 },
  attachBox:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2c2f33', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, marginTop: 6, gap: 6, alignSelf: 'flex-start' },
  attachIcon:         { fontSize: 14 },
  attachName:         { color: '#1d9bd1', fontSize: 13, maxWidth: 240 },
  clipBtn:            { width: 38, height: 38, borderRadius: 6, backgroundColor: '#2c2f33', alignItems: 'center', justifyContent: 'center' },

  // board toggle button
  boardToggleBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#2c2f33', marginRight: 8 },
  boardToggleBtnActive: { backgroundColor: '#1164a3' },
  boardToggleText:    { color: '#d1d2d3', fontSize: 12, fontWeight: '600' },

  // canvas panel
  canvasPanel:        { borderBottomWidth: 1, borderBottomColor: '#333', padding: 12, backgroundColor: '#16181d' },
  brushToolbar:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  brushLabel:         { color: '#9b9b9b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  brushSwatch:        { width: 20, height: 20, borderRadius: 10 },
  brushSwatchActive:  { borderWidth: 2, borderColor: '#fff' },
  sizeBtn:            { width: 28, height: 28, borderRadius: 5, backgroundColor: '#2c2f33', alignItems: 'center', justifyContent: 'center' },
  sizeBtnActive:      { backgroundColor: '#1164a3' },
  sizeBtnText:        { color: '#d1d2d3', fontSize: 12 },

  // thread panel
  threadPanel:        { width: 360, borderLeftWidth: 1, borderLeftColor: '#333', flexDirection: 'column', backgroundColor: '#1a1d21' },
  threadPanelMobile:  { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', zIndex: 20, borderLeftWidth: 0 },
  threadHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#333' },
  threadTitle:        { color: '#fff', fontSize: 16, fontWeight: '700' },
  threadClose:        { color: '#9b9b9b', fontSize: 18, paddingHorizontal: 4 },
  threadRoot:         { margin: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#333' },
});
