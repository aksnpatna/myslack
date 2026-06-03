import { View, Text, StyleSheet } from 'react-native';

const OB_CODE_RE = /^(CONSULTANT|COLLABORATOR|OPERATOR)-[A-Z0-9]{2,6}$/;

/**
 * Wraps a user name — shows obfuscated code for non-admins viewing others.
 * - Admin users always see real names (with badge on obfuscated)
 * - Non-admin users see their own name always, but others as obfuscated
 *
 * @param {object}  props
 * @param {string}  props.displayName   - sender name as received from the server
 * @param {string}  [props.realName]     - unmasked real name
 * @param {string}  [props.userId]       - sender userId
 * @param {string}  [props.currentUserId] - the logged-in user's ID
 * @param {boolean} props.isAdmin        - when true, real name badge is shown
 * @param {boolean} [props.compact]      - smaller footprint for inline use
 */
export default function ObfuscatedIdentityWrapper({
  displayName,
  realName,
  userId,
  currentUserId,
  isAdmin = false,
  compact = false,
}) {
  const isObfuscated = OB_CODE_RE.test(displayName ?? '');
  const isOwnMessage = currentUserId && userId && currentUserId === userId;
  const canSeeReal = isAdmin || isOwnMessage;
  const showRealBadge = canSeeReal && isObfuscated && realName && realName !== displayName;

  return (
    <View style={[s.row, compact && s.rowCompact]}>
      <Text
        style={[s.name, isObfuscated && s.obfuscated, compact && s.nameCompact]}
        numberOfLines={1}
      >
        {displayName ?? '???'}
      </Text>

      {showRealBadge && (
        <View style={[s.badge, compact && s.badgeCompact]}>
          <Text style={[s.badgeText, compact && s.badgeTextCompact]}>
            {realName}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  rowCompact: {
    gap: 4,
  },
  name: {
    color: '#e8f4ff',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  nameCompact: {
    fontSize: 11,
  },
  obfuscated: {
    color: '#00e676',
    letterSpacing: 0.3,
  },
  badge: {
    backgroundColor: 'rgba(0,102,255,0.15)',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,102,255,0.4)',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeCompact: {
    paddingHorizontal: 3,
    paddingVertical: 0,
  },
  badgeText: {
    color: '#5e9eff',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  badgeTextCompact: {
    fontSize: 8,
  },
});
