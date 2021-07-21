// @flow

import * as React from 'react';
import Animated from 'react-native-reanimated';

import type { AppNavigationProp } from '../navigation/app-navigator.react';
import type { TooltipRoute } from '../navigation/tooltip.react';
import { useSelector } from '../redux/redux-utils';
import { InnerRobotextMessage } from './inner-robotext-message.react';
import { Timestamp } from './timestamp.react';
import { useAnimatedMessageTooltipButton } from './utils';

/* eslint-disable import/no-named-as-default-member */
const { Node } = Animated;
/* eslint-enable import/no-named-as-default-member */

type Props = {
  +navigation: AppNavigationProp<'RobotextMessageTooltipModal'>,
  +route: TooltipRoute<'RobotextMessageTooltipModal'>,
  +progress: Node,
};
function RobotextMessageTooltipButton(props: Props): React.Node {
  const { progress } = props;
  const windowWidth = useSelector(state => state.dimensions.width);
  const { initialCoordinates } = props.route.params;
  const headerStyle = React.useMemo(() => {
    const bottom = initialCoordinates.height;
    return {
      opacity: progress,
      position: 'absolute',
      left: -initialCoordinates.x,
      width: windowWidth,
      bottom,
    };
  }, [progress, windowWidth, initialCoordinates]);

  const { item, verticalBounds } = props.route.params;
  const { style: messageContainerStyle } = useAnimatedMessageTooltipButton(
    item,
    initialCoordinates,
    verticalBounds,
    progress,
  );

  const { navigation } = props;
  return (
    <React.Fragment>
      <Animated.View style={headerStyle}>
        <Timestamp time={item.messageInfo.time} display="modal" />
      </Animated.View>
      <Animated.View style={messageContainerStyle}>
        <InnerRobotextMessage item={item} onPress={navigation.goBackOnce} />
      </Animated.View>
    </React.Fragment>
  );
}

export default RobotextMessageTooltipButton;
