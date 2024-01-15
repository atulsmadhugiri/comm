// @flow

import Icon from '@expo/vector-icons/Feather.js';
import { useNavigation } from '@react-navigation/native';
import * as React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import type { MinimallyEncodedThreadInfo } from 'lib/types/minimally-encoded-thread-permissions-types.js';
import type { LegacyThreadInfo } from 'lib/types/thread-types.js';

import { SubchannelsListModalRouteName } from './route-names.js';
import { useStyles } from '../themes/colors.js';

type Props = {
  +threadInfo: LegacyThreadInfo | MinimallyEncodedThreadInfo,
};

function SubchnnelsButton(props: Props): React.Node {
  const styles = useStyles(unboundStyles);

  const { threadInfo } = props;
  const { navigate } = useNavigation();

  const onPress = React.useCallback(
    () =>
      navigate<'SubchannelsListModal'>({
        name: SubchannelsListModalRouteName,
        params: { threadInfo },
      }),
    [navigate, threadInfo],
  );

  return (
    <TouchableOpacity style={styles.view} onPress={onPress}>
      <View style={styles.iconWrapper}>
        <Icon name="corner-down-right" style={styles.label} size={16} />
      </View>
      <Text style={styles.label}>Subchannels</Text>
    </TouchableOpacity>
  );
}

const unboundStyles = {
  view: {
    flexDirection: 'row',
  },
  label: {
    color: 'drawerExpandButton',
    fontWeight: '500',
    fontSize: 12,
    lineHeight: 18,
  },
  iconWrapper: {
    height: 16,
    width: 16,
    alignItems: 'center',
  },
  icon: {
    color: 'drawerExpandButton',
    marginRight: 2,
  },
};

export default SubchnnelsButton;
