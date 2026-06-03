/**
 * ObfuscatedMessage.js
 * Chat message row that renders either the real sender name or an obfuscated code
 * depending on the `isAdmin` prop — matching the identity_mappings sovereignty layer.
 * Sovereign Tech Design System: Deep Navy #0b1326, Electric Blue #0066ff.
 */
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

/**
 * @param {object}   props
 * @param {object}   props.message          - message object from the WS / API
 * @param {string}   props.message.sender   - already-resolved sender (real name for admin, obfuscated for members)
 * @param {string}   props.message.content
 * @param {string}   props.message.createdAt
 * @param {string}   [props.message.id]
 * @param {boolean}  props.isAdmin          - when true, a subtle real-name badge is shown
 * @param {string}   [props.realName]       - the unmasked username (only pass to admin views)
 * @param {function} [props.onReply]        - called when the reply affordance is pressed
 * @param {number}   [props.replyCount]
 */
export default function ObfuscatedMessage({ message, isAdmin, realName, onReply, replyCount = 0 }) {
  const { sender, content, createdAt, ragConfidence, citation, nodeId } = message;
  const isSystemMsg = sender?.startsWith('🔒') || sender?.startsWith('⚠️')
    || sender === 'Automated Project Director' || sender === 'SOVEREIGN-01'
    || sender?.startsWith('❌') || sender?.startsWith('⚠');
  const isAgentMsg = sender === 'Automated Project Director' || sender === 'SOVEREIGN-01';

  const timestamp = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const ctxPct = ragConfidence != null ? `${(ragConfidence * 100).toFixed(1)}%` : '—';
  const srcDoc = citation ?? '—';
  const node   = nodeId ?? process.env.EXPO_PUBLIC_NODE_LOCATION ?? 'NODE-01';

  return (
    <View style={[s.row, isSystemMsg && s.systemRow]}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>
          {isSystemMsg ? '⬡' : (sender?.[0] ?? '?').toUpperCase()}
        </Text>
      </View>

      <View style={s.body}>
        <View style={s.meta}>
          <Text style={[s.sender, isSystemMsg && s.systemSender]} numberOfLines={1}>
            {sender}
          </Text>
          {/* Admin-only real-name overlay */}
          {isAdmin && realName && realName !== sender && (
            <View style={s.realNameBadge}>
              <Text style={s.realNameText}>{realName}</Text>
            </View>
          )}
          <Text style={s.ts}>{timestamp}</Text>
        </View>

        <Text style={[s.content, isSystemMsg && s.systemContent]}>{content}</Text>

        {/* Agent RAG Metadata Footer */}
        {isAgentMsg && (
          <View style={s.ragFooter}>
            <View style={s.ragItem}>
              <Text style={s.ragLabel}>CTX MAP</Text>
              <Text style={s.ragValue}>{ctxPct}</Text>
            </View>
            <View style={s.ragDivider} />
            <View style={s.ragItem}>
              <Text style={s.ragLabel}>SOURCE</Text>
              <Text style={s.ragValue} numberOfLines={1}>{srcDoc}</Text>
            </View>
            <View style={s.ragDivider} />
            <View style={s.ragItem}>
              <Text style={s.ragLabel}>NODE</Text>
              <Text style={s.ragValue}>{node}</Text>
            </View>
          </View>
        )}

        {!!onReply && (
          <TouchableOpacity style={s.replyBtn} onPress={onReply}>
            <Text style={s.replyText}>
              {replyCount > 0 ? `${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}` : 'Reply'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 10,
  },
  systemRow: {
    backgroundColor: 'rgba(0,102,255,0.05)',
    borderLeftWidth: 2,
    borderLeftColor: '#0066ff',
    paddingLeft: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#0d1a30',
    borderWidth: 1,
    borderColor: '#1a2e50',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    color: '#0066ff',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  sender: {
    color: '#e8f4ff',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  systemSender: {
    color: '#0066ff',
  },
  realNameBadge: {
    backgroundColor: 'rgba(0,102,255,0.15)',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,102,255,0.4)',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  realNameText: {
    color: '#5e9eff',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  ts: {
    color: '#3a5070',
    fontSize: 9,
    fontFamily: 'monospace',
    marginLeft: 'auto',
  },
  content: {
    color: '#c8d8e8',
    fontSize: 13,
    lineHeight: 18,
  },
  systemContent: {
    color: '#7a9ec0',
    fontSize: 12,
    fontStyle: 'italic',
  },
  replyBtn: {
    marginTop: 3,
    alignSelf: 'flex-start',
  },
  replyText: {
    color: '#3a5070',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  // ── Agent RAG metadata footer ──────────────────────
  ragFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1a2e50',
  },
  ragItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  ragLabel: {
    color: '#3a5070',
    fontSize: 8,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  ragValue: {
    color: '#0066ff',
    fontSize: 9,
    fontFamily: 'monospace',
    flex: 1,
    minWidth: 0,
  },
  ragDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#1a2e50',
  },
});
