// @flow

import * as React from 'react';
import { View, StyleSheet } from 'react-native';

import { useKeyserverAdmin } from 'lib/shared/user-utils';
import type { ThreadInfo } from 'lib/types/thread-types';

import { useColors } from '../themes/colors';
import CommIcon from './comm-icon.react';
import Pill from './pill.react';
import ThreadPill from './thread-pill.react';

type Props = {
  +community: ThreadInfo,
};
function CommunityPill(props: Props): React.Node {
  const { community } = props;

  const keyserverAdmin = useKeyserverAdmin(community);
  const keyserverOperatorUsername = keyserverAdmin?.username;

  const colors = useColors();
  const keyserverOperatorLabel: ?React.Node = React.useMemo(() => {
    if (!keyserverOperatorUsername) {
      return undefined;
    }
    const icon = (
      <CommIcon
        name="cloud-filled"
        size={12}
        color={colors.panelForegroundLabel}
      />
    );
    return (
      <Pill
        backgroundColor={colors.codeBackground}
        roundCorners={{ left: true, right: false }}
        label={keyserverOperatorUsername}
        icon={icon}
      />
    );
  }, [
    colors.codeBackground,
    colors.panelForegroundLabel,
    keyserverOperatorUsername,
  ]);

  return (
    <View style={styles.container}>
      {keyserverOperatorLabel}
      <ThreadPill
        threadInfo={community}
        roundCorners={{ left: false, right: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
});

export default CommunityPill;
