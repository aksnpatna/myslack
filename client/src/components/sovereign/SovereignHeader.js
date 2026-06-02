/**
 * SovereignHeader.js
 * Top bar for Sovereign Mode showing Node Location, E2EE status, and admin badge.
 * Sovereign Tech Design System: Deep Navy #0b1326, Electric Blue #0066ff.
 */
import { View, Text, StyleSheet } from 'react-native';

/**
 * @param {object}  props
 * @param {string}  [props.nodeLocation]   - e.g. "EU-WEST-1"
 * @param {boolean} [props.e2eeVerified]   - whether E2EE is confirmed active
 * @param {boolean} [props.isAdmin]        - shows Full Visibility badge when true
 * @param {string}  [props.channelName]    - active channel / topic name
 */
export default function SovereignHeader({ nodeLocation = 'LOCAL', e2eeVerified = true, isAdmin = false, channelName }) {
  return (
    <View style={s.bar}>
      {/* Node location */}
      <View style={s.pill}>
        <View style={[s.ledge, { backgroundColor: '#0066ff' }]} />
        <Text style={s.pillText}>NODE: {nodeLocation}</Text>
      </View>

      {/* Channel name */}
      {!!channelName && (
        <Text style={s.channelLabel} numberOfLines={1}># {channelName}</Text>
      )}

      <View style={s.right}>
        {/* E2EE status */}
        <View style={s.pill}>
          <View style={[s.ledge, { backgroundColor: e2eeVerified ? '#00e676' : '#ff1744' }]} />
          <Text style={s.pillText}>{e2eeVerified ? 'E2EE ✓' : 'E2EE ✗'}</Text>
        </View>

        {/* Admin badge */}
        {isAdmin && (
          <View style={[s.pill, s.adminPill]}>
            <Text style={[s.pillText, s.adminPillText]}>FULL VISIBILITY</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b1326',
    borderBottomWidth: 1,
    borderBottomColor: '#1a2e50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1a30',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1a2e50',
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 5,
  },
  ledge: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  pillText: {
    color: '#5e7a9e',
    fontSize: 9,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  channelLabel: {
    flex: 1,
    color: '#e8f4ff',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  right: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 'auto',
  },
  adminPill: {
    borderColor: '#0066ff',
    backgroundColor: 'rgba(0,102,255,0.12)',
  },
  adminPillText: {
    color: '#0066ff',
    fontWeight: '700',
  },
});
