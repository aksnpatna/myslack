import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import BentoMetricCard from './BentoMetricCard';

/**
 * Multi-layered navigation drawer for Sovereign Mode.
 * Replaces standard channel list with Project Containers, Topic Streams,
 * and Live Health telemetry at the bottom.
 */
export default function SovereignSidebar({
  channels = [],
  topicsMap = {},
  expandedChannels = {},
  activeChannel,
  activeTopic,
  onToggleExpand,
  onSelectChannel,
  onSelectTopic,
  onToggleSovereign,
  isAdmin = false,
  sovereignMetrics = [],
  onToggleMobile,
  isMobile = false,
  collapsed = false,
}) {
  if (!isMobile && collapsed) {
    return <View style={s.collapsedBar}>
      <TouchableOpacity style={s.collapsedToggle} onPress={onToggleMobile}>
        <Text style={s.collapsedIcon}>⬡</Text>
      </TouchableOpacity>
    </View>;
  }

  const visibleChannels = isAdmin
    ? channels
    : channels.filter((c) => c.isMember);

  return (
    <View style={s.root}>
      {/* ── Header ─────────────────────────────────── */}
      <View style={s.header}>
        <Text style={s.headerBrand}>⬡ MYSYS</Text>
        <View style={s.headerActions}>
          {isMobile && (
            <TouchableOpacity style={s.headerBtn} onPress={onToggleMobile}>
              <Text style={s.headerBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Sovereign Toggle ────────────────────────── */}
      <TouchableOpacity style={s.toggle} onPress={onToggleSovereign}>
        <View style={[s.toggleDot, { backgroundColor: '#00e676' }]} />
        <Text style={s.toggleLabel}>SOVEREIGN MODE ACTIVE</Text>
      </TouchableOpacity>

      {/* ── Live Health Metrics ─────────────────────── */}
      {isAdmin && (
        <View style={s.healthSection}>
          <Text style={s.sectionTitle}>LIVE HEALTH</Text>
          <View style={s.bentoRow}>
            {sovereignMetrics.length > 0 ? (
              sovereignMetrics.slice(0, 4).map((m) => (
                <BentoMetricCard
                  key={m.id}
                  label={m.node_id}
                  value={m.latency_ms != null ? `${m.latency_ms}ms` : (m.cpu_pct != null ? `${m.cpu_pct}%` : '—')}
                  subValue={m.cpu_pct != null ? `CPU ${m.cpu_pct}%` : undefined}
                  status={m.status ?? 'ok'}
                  nodeId={m.node_id}
                />
              ))
            ) : (
              <BentoMetricCard
                label="SYSTEM"
                value="IDLE"
                subValue="No telemetry"
                status="pending"
                nodeId="LOCAL"
              />
            )}
          </View>
        </View>
      )}

      {/* ── Project Containers ──────────────────────── */}
      <Text style={s.sectionTitle}>PROJECT CONTAINERS</Text>

      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        {visibleChannels.map((ch) => {
          const chTopics = topicsMap[ch.id] ?? [];
          const isExpanded = expandedChannels[ch.id] ?? false;
          const isActive = activeChannel?.id === ch.id;

          return (
            <View key={ch.id} style={s.container}>
              {/* Container header */}
              <TouchableOpacity
                style={[s.containerHeader, isActive && s.containerHeaderActive]}
                onPress={() => {
                  onSelectChannel(ch);
                  onToggleExpand(ch.id);
                  if (isMobile && chTopics.length === 0) onToggleMobile();
                }}
              >
                <Text style={s.expandIcon}>{isExpanded ? '▾' : '▸'}</Text>
                <Text style={[s.containerName, isActive && s.containerNameActive]} numberOfLines={1}>
                  {ch.name.toUpperCase()}
                </Text>
                {chTopics.length > 0 && (
                  <View style={s.countBadge}>
                    <Text style={s.countText}>{chTopics.length}</Text>
                  </View>
                )}
                <View style={[s.statusLed, { backgroundColor: isActive ? '#00e676' : '#1a2e50' }]} />
              </TouchableOpacity>

              {/* Topic Streams */}
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
                      onSelectTopic(topic);
                      onSelectChannel(ch);
                      if (isMobile) onToggleMobile();
                    }}
                  >
                    <View style={[s.topicDot, { backgroundColor: statusColor }]} />
                    <Text style={[s.topicName, isTopicActive && s.topicNameActive]} numberOfLines={1}>
                      {topic.name}
                    </Text>
                    <View style={[s.topicBadge, { borderColor: statusColor }]}>
                      <Text style={[s.topicBadgeText, { color: statusColor }]}>{topic.status}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {isExpanded && chTopics.length === 0 && (
                <View style={s.emptyStreams}>
                  <Text style={s.emptyStreamsText}>No topic streams</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* ── Footer telemetry ────────────────────────── */}
      {isAdmin && (
        <View style={s.footer}>
          <Text style={s.footerTitle}>NODE STATUS</Text>
          <View style={s.footerRow}>
            <View style={s.footerMetric}>
              <View style={[s.footerLed, { backgroundColor: '#00e676' }]} />
              <Text style={s.footerLabel}>API</Text>
            </View>
            <View style={s.footerMetric}>
              <View style={[s.footerLed, { backgroundColor: '#00e676' }]} />
              <Text style={s.footerLabel}>DB</Text>
            </View>
            <View style={s.footerMetric}>
              <View style={[s.footerLed, { backgroundColor: '#0066ff' }]} />
              <Text style={s.footerLabel}>RAG</Text>
            </View>
            <View style={s.footerMetric}>
              <View style={[s.footerLed, { backgroundColor: '#00e676' }]} />
              <Text style={s.footerLabel}>E2EE</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b1326',
    borderRightWidth: 1,
    borderRightColor: '#1a2e50',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a2e50',
  },
  headerBrand: {
    color: '#0066ff',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 6,
  },
  headerBtn: {
    width: 26,
    height: 26,
    borderRadius: 4,
    backgroundColor: '#0d1a30',
    borderWidth: 1,
    borderColor: '#1a2e50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    marginVertical: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#0066ff',
    backgroundColor: 'rgba(0,102,255,0.08)',
  },
  toggleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  toggleLabel: {
    color: '#0066ff',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  healthSection: {
    paddingBottom: 8,
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bentoRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    flexWrap: 'wrap',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
  },
  container: {
    marginBottom: 1,
  },
  containerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 6,
  },
  containerHeaderActive: {
    backgroundColor: 'rgba(0,102,255,0.12)',
    borderLeftWidth: 2,
    borderLeftColor: '#0066ff',
  },
  expandIcon: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'monospace',
    width: 8,
  },
  containerName: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.8,
    flex: 1,
  },
  containerNameActive: {
    color: '#0066ff',
  },
  countBadge: {
    backgroundColor: '#0d1a30',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#334155',
  },
  countText: {
    color: '#94a3b8',
    fontSize: 8,
    fontFamily: 'monospace',
  },
  statusLed: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: 2,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 22,
    gap: 6,
  },
  topicRowActive: {
    backgroundColor: 'rgba(0,102,255,0.10)',
  },
  topicDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    flexShrink: 0,
  },
  topicName: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 1,
  },
  topicNameActive: {
    color: '#e2e8f0',
  },
  topicBadge: {
    borderRadius: 3,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  topicBadgeText: {
    fontSize: 7,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  emptyStreams: {
    paddingVertical: 8,
    paddingHorizontal: 26,
  },
  emptyStreamsText: {
    color: '#1a2e50',
    fontSize: 9,
    fontFamily: 'monospace',
    fontStyle: 'italic',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#1a2e50',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  footerTitle: {
    color: '#94a3b8',
    fontSize: 8,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  footerMetric: {
    alignItems: 'center',
    gap: 3,
  },
  footerLed: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  footerLabel: {
    color: '#94a3b8',
    fontSize: 8,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
  },
  collapsedBar: {
    width: 36,
    backgroundColor: '#0b1326',
    borderRightWidth: 1,
    borderRightColor: '#1a2e50',
    alignItems: 'center',
    paddingTop: 12,
  },
  collapsedToggle: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#0d1a30',
    borderWidth: 1,
    borderColor: '#1a2e50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedIcon: {
    color: '#0066ff',
    fontSize: 10,
    fontFamily: 'monospace',
  },
});
