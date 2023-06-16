// @flow

import * as React from 'react';
import EmojiPicker from 'rn-emoji-keyboard';

export type EmojiSelection = {
  +emoji: string,
  +name: string,
  +slug: string,
  +unicode_version: string,
  +toneEnabled: string,
  +alreadySelected?: boolean,
};

type Props = {
  +onEmojiSelected: (emoji: EmojiSelection) => mixed,
  +emojiKeyboardOpen: boolean,
  +onEmojiKeyboardClose: () => mixed,
};

function EmojiKeyboard(props: Props): React.Node {
  const { onEmojiSelected, emojiKeyboardOpen, onEmojiKeyboardClose } = props;

  return (
    <EmojiPicker
      onEmojiSelected={onEmojiSelected}
      open={emojiKeyboardOpen}
      onClose={onEmojiKeyboardClose}
      enableSearchBar
      enableSearchAnimation={false}
    />
  );
}

export default EmojiKeyboard;
