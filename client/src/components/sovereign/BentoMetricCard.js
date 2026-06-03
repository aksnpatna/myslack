/**
 * BentoMetricCard.js
 * Compact bento-grid card for displaying a labelled metric with a status indicator.
 * Sovereign Tech Design System: Deep Navy #0b1326, Electric Blue #0066ff.
 */
import { View, Text, StyleSheet } from 'react-native';

const STATUS_COLORS = {
  stable:    '#00e676',
  degraded:  '#ffca28',
  critical:  '#ff1744',
  // legacy aliases
  ok:        '#00e676',
  warning:   '#ffca28',
  error:     '#ff1744',
  indexing:  '#0066ff',
  ready:     '#00e676',
  pending:   '#90a4ae',
};

const STATUS_LABELS = {
  stable:   'STABLE',
  degraded: 'DEGRADED',
  critical: 'CRITICAL',
};

/**
 * @param {object}  props
 * @param {string}  props.label        - Card label (e.g. "CPU")
 * @param {string}  props.value        - Mono-spaced primary value (e.g. "42%")
 * @param {string}  [props.subValue]   - Optional secondary value or unit
 * @param {string}  [props.status]     - ok | warning | error | indexing | ready | pending
 * @param {string}  [props.nodeId]     - Node identifier shown in footer
 */
export default function BentoMetricCard({ label, value, subValue, status = 'ok', nodeId }) {
  const dotColor = STATUS_COLORS[status] ?? STATUS_COLORS.ok;
  const statusLabel = STATUS_LABELS[status];

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
        <View style={[s.dot, { backgroundColor: dotColor }]} />
      </View>
      <Text style={s.value} numberOfLines={1}>{value}</Text>
      {!!subValue && <Text style={s.subValue} numberOfLines={1}>{subValue}</Text>}
      <View style={s.footer}>
        {!!statusLabel && (
          <View style={[s.statusPill, { borderColor: dotColor, backgroundColor: `${dotColor}15` }]}>
            <Text style={[s.statusText, { color: dotColor }]}>{statusLabel}</Text>
          </View>
        )}
        {!!nodeId && <Text style={s.nodeId} numberOfLines={1}>{nodeId}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0d1a30',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 10,
    minWidth: 110,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 4,
  },
  value: {
    color: '#e2e8f0',
    fontSize: 18,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subValue: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 4,
  },
  statusPill: {
    borderRadius: 3,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  statusText: {
    fontSize: 7,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  nodeId: {
    color: '#0066ff',
    fontSize: 8,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
