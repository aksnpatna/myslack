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

  return (
    <View style={[s.row, compact && s.rowCompact]}>
      <Text
        style={[
          s.name,
          isObfuscated && !canSeeReal && s.nameObscured,
          canSeeReal && isObfuscated && s.nameOwn,
          isObfuscated && canSeeReal && !isOwnMessage && s.nameAdmin,
          compact && s.nameCompact,
        ]}
        numberOfLines={1}
      >
        {displayName ?? '???'}
      </Text>

      {/* Admin sees real name badge on obfuscated identities */}
      {isAdmin && isObfuscated && realName && realName !== displayName && (
        <View style={[s.badge, compact && s.badgeCompact]}>
          <Text style={[s.badgeText, compact && s.badgeTextCompact]}>
            {realName}
          </Text>
        </View>
      )}

      {/* Non-admin viewers see SECURED indicator on obfuscated identities */}
      {!canSeeReal && isObfuscated && (
        <View style={[s.securedBadge, compact && s.securedBadgeCompact]}>
          <Text style={[s.securedText, compact && s.securedTextCompact]}>
            SECURED
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
  nameObscured: {
    color: '#a0aec0',
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },
  nameOwn: {
    color: '#00e676',
    letterSpacing: 0.3,
  },
  nameAdmin: {
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
  securedBadge: {
    backgroundColor: '#1e293b',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  securedBadgeCompact: {
    paddingHorizontal: 3,
    paddingVertical: 0,
  },
  securedText: {
    color: '#94a3b8',
    fontSize: 8,
    fontFamily: 'monospace',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  securedTextCompact: {
    fontSize: 7,
    letterSpacing: 0.5,
  },
});
