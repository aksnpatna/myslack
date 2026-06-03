import { View, Text, StyleSheet } from 'react-native';

/**
 * Technical metadata footer rendered below every @agent / SOVEREIGN-01 message.
 * Shows RAG context mapping, source document citation, and processing node.
 */
export default function AgentMetadata({
  contextScore,
  sourceDoc,
  nodeLocation,
}) {
  const ctxPct = contextScore != null ? `${(contextScore * 100).toFixed(1)}%` : '—';
  const src    = sourceDoc ?? '—';
  const node   = nodeLocation ?? 'NODE-01';

  return (
    <View style={s.footer}>
      <View style={s.row}>
        <View style={s.item}>
          <Text style={s.dot}>⬡</Text>
          <Text style={s.label}>CONTEXT</Text>
          <Text style={[s.value, s.valuePrimary]}>{ctxPct} MAPPED</Text>
        </View>
        <View style={s.divider} />
        <View style={s.item}>
          <Text style={s.dot}>◈</Text>
          <Text style={s.label}>SOURCE</Text>
          <Text style={s.value} numberOfLines={1}>{src}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.item}>
          <Text style={s.dot}>◉</Text>
          <Text style={s.label}>NODE</Text>
          <Text style={s.value}>{node}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  footer: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  dot: {
    color: '#0066ff',
    fontSize: 8,
    fontFamily: 'monospace',
  },
  label: {
    color: '#64748b',
    fontSize: 8,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  value: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
    flex: 1,
    minWidth: 0,
  },
  valuePrimary: {
    color: '#0066ff',
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: '#1e293b',
  },
});
