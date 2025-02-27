// @flow

import invariant from 'invariant';
import _difference from 'lodash/fp/difference.js';
import * as React from 'react';

import {
  joinThreadActionTypes,
  newThreadActionTypes,
  useJoinThread,
} from 'lib/actions/thread-actions.js';
import SWMansionIcon from 'lib/components/swmansion-icon.react.js';
import {
  useChatMentionContext,
  useThreadChatMentionCandidates,
} from 'lib/hooks/chat-mention-hooks.js';
import { createLoadingStatusSelector } from 'lib/selectors/loading-selectors.js';
import { threadInfoSelector } from 'lib/selectors/thread-selectors.js';
import {
  getTypeaheadRegexMatches,
  type MentionTypeaheadSuggestionItem,
  type TypeaheadMatchedStrings,
  useMentionTypeaheadChatSuggestions,
  useMentionTypeaheadUserSuggestions,
  useUserMentionsCandidates,
} from 'lib/shared/mention-utils.js';
import { localIDPrefix, trimMessage } from 'lib/shared/message-utils.js';
import {
  checkIfDefaultMembersAreVoiced,
  threadActualMembers,
  threadFrozenDueToViewerBlock,
  threadHasPermission,
  viewerIsMember,
} from 'lib/shared/thread-utils.js';
import type { CalendarQuery } from 'lib/types/entry-types.js';
import type { LoadingStatus } from 'lib/types/loading-types.js';
import { messageTypes } from 'lib/types/message-types-enum.js';
import type { ThreadInfo } from 'lib/types/minimally-encoded-thread-permissions-types.js';
import { threadPermissions } from 'lib/types/thread-permission-types.js';
import {
  type ClientThreadJoinRequest,
  type ThreadJoinPayload,
} from 'lib/types/thread-types.js';
import { type UserInfos } from 'lib/types/user-types.js';
import {
  type DispatchActionPromise,
  useDispatchActionPromise,
} from 'lib/utils/redux-promise-utils.js';

import css from './chat-input-bar.css';
import TypeaheadTooltip from './typeahead-tooltip.react.js';
import Button from '../components/button.react.js';
import {
  type InputState,
  type PendingMultimediaUpload,
} from '../input/input-state.js';
import LoadingIndicator from '../loading-indicator.react.js';
import { allowedMimeTypeString } from '../media/file-utils.js';
import Multimedia from '../media/multimedia.react.js';
import { useSelector } from '../redux/redux-utils.js';
import { nonThreadCalendarQuery } from '../selectors/nav-selectors.js';
import {
  getMentionTypeaheadTooltipActions,
  getMentionTypeaheadTooltipButtons,
  webMentionTypeaheadRegex,
} from '../utils/typeahead-utils.js';

type BaseProps = {
  +threadInfo: ThreadInfo,
  +inputState: InputState,
};
type Props = {
  ...BaseProps,
  +viewerID: ?string,
  +joinThreadLoadingStatus: LoadingStatus,
  +threadCreationInProgress: boolean,
  +calendarQuery: () => CalendarQuery,
  +nextLocalID: number,
  +isThreadActive: boolean,
  +userInfos: UserInfos,
  +dispatchActionPromise: DispatchActionPromise,
  +joinThread: (request: ClientThreadJoinRequest) => Promise<ThreadJoinPayload>,
  +typeaheadMatchedStrings: ?TypeaheadMatchedStrings,
  +suggestions: $ReadOnlyArray<MentionTypeaheadSuggestionItem>,
  +parentThreadInfo: ?ThreadInfo,
};

class ChatInputBar extends React.PureComponent<Props> {
  textarea: ?HTMLTextAreaElement;
  multimediaInput: ?HTMLInputElement;

  componentDidMount() {
    this.updateHeight();
    if (this.props.isThreadActive) {
      this.addReplyListener();
    }
  }

  componentWillUnmount() {
    if (this.props.isThreadActive) {
      this.removeReplyListener();
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.isThreadActive && !prevProps.isThreadActive) {
      this.addReplyListener();
    } else if (!this.props.isThreadActive && prevProps.isThreadActive) {
      this.removeReplyListener();
    }

    const { inputState } = this.props;
    const prevInputState = prevProps.inputState;
    if (inputState.draft !== prevInputState.draft) {
      this.updateHeight();
    }

    if (
      inputState.draft !== prevInputState.draft ||
      inputState.textCursorPosition !== prevInputState.textCursorPosition
    ) {
      inputState.setTypeaheadState({
        canBeVisible: true,
      });
    }

    const curUploadIDs = ChatInputBar.unassignedUploadIDs(
      inputState.pendingUploads,
    );
    const prevUploadIDs = ChatInputBar.unassignedUploadIDs(
      prevInputState.pendingUploads,
    );
    const { multimediaInput, textarea } = this;
    if (
      multimediaInput &&
      _difference(prevUploadIDs)(curUploadIDs).length > 0
    ) {
      // Whenever a pending upload is removed, we reset the file
      // HTMLInputElement's value field, so that if the same upload occurs again
      // the onChange call doesn't get filtered
      multimediaInput.value = '';
    } else if (
      textarea &&
      _difference(curUploadIDs)(prevUploadIDs).length > 0
    ) {
      // Whenever a pending upload is added, we focus the textarea
      textarea.focus();
      return;
    }

    if (
      (this.props.threadInfo.id !== prevProps.threadInfo.id ||
        (inputState.textCursorPosition !== prevInputState.textCursorPosition &&
          this.textarea?.selectionStart === this.textarea?.selectionEnd)) &&
      this.textarea
    ) {
      this.textarea.focus();

      this.textarea?.setSelectionRange(
        inputState.textCursorPosition,
        inputState.textCursorPosition,
        'none',
      );
    }
  }

  static unassignedUploadIDs(
    pendingUploads: $ReadOnlyArray<PendingMultimediaUpload>,
  ): Array<string> {
    return pendingUploads
      .filter(
        (pendingUpload: PendingMultimediaUpload) => !pendingUpload.messageID,
      )
      .map((pendingUpload: PendingMultimediaUpload) => pendingUpload.localID);
  }

  updateHeight() {
    const textarea = this.textarea;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 150);
      textarea.style.height = `${newHeight}px`;
    }
  }

  addReplyListener() {
    invariant(
      this.props.inputState,
      'inputState should be set in addReplyListener',
    );
    this.props.inputState.addReplyListener(this.focusAndUpdateText);
  }

  removeReplyListener() {
    invariant(
      this.props.inputState,
      'inputState should be set in removeReplyListener',
    );
    this.props.inputState.removeReplyListener(this.focusAndUpdateText);
  }

  render(): React.Node {
    const isMember = viewerIsMember(this.props.threadInfo);
    const canJoin = threadHasPermission(
      this.props.threadInfo,
      threadPermissions.JOIN_THREAD,
    );

    let joinButton = null;
    if (!isMember && canJoin && !this.props.threadCreationInProgress) {
      let buttonContent;
      if (this.props.joinThreadLoadingStatus === 'loading') {
        buttonContent = (
          <LoadingIndicator
            status={this.props.joinThreadLoadingStatus}
            size="medium"
            color="white"
          />
        );
      } else {
        buttonContent = (
          <>
            <SWMansionIcon icon="plus" size={24} />
            <p className={css.joinButtonText}>Join Chat</p>
          </>
        );
      }
      joinButton = (
        <div className={css.joinButtonContainer}>
          <Button
            variant="filled"
            buttonColor={{ backgroundColor: `#${this.props.threadInfo.color}` }}
            onClick={this.onClickJoin}
          >
            {buttonContent}
          </Button>
        </div>
      );
    }

    const { pendingUploads, cancelPendingUpload } = this.props.inputState;
    const multimediaPreviews = pendingUploads.map(pendingUpload => {
      const { uri, mediaType, thumbHash, dimensions } = pendingUpload;
      let mediaSource = { thumbHash, dimensions };
      if (mediaType !== 'encrypted_photo' && mediaType !== 'encrypted_video') {
        mediaSource = {
          ...mediaSource,
          type: mediaType,
          uri,
          thumbnailURI: null,
        };
      } else {
        const { encryptionKey } = pendingUpload;
        invariant(
          encryptionKey,
          'encryptionKey should be set for encrypted media',
        );
        mediaSource = {
          ...mediaSource,
          type: mediaType,
          blobURI: uri,
          encryptionKey,
          thumbnailBlobURI: null,
          thumbnailEncryptionKey: null,
        };
      }
      return (
        <Multimedia
          mediaSource={mediaSource}
          pendingUpload={pendingUpload}
          remove={cancelPendingUpload}
          multimediaCSSClass={css.multimedia}
          multimediaImageCSSClass={css.multimediaImage}
          key={pendingUpload.localID}
        />
      );
    });
    const previews =
      multimediaPreviews.length > 0 ? (
        <div className={css.previews}>{multimediaPreviews}</div>
      ) : null;

    let content;
    // If the thread is created by somebody else while the viewer is attempting
    // to create it, the threadInfo might be modified in-place and won't
    // list the viewer as a member, which will end up hiding the input. In
    // this case, we will assume that our creation action will get translated,
    // into a join and as long as members are voiced, we can show the input.
    const defaultMembersAreVoiced = checkIfDefaultMembersAreVoiced(
      this.props.threadInfo,
    );

    let sendButton;
    if (this.props.inputState.draft.length) {
      sendButton = (
        <a onClick={this.onSend} className={css.sendButton}>
          <SWMansionIcon
            icon="send-2"
            size={22}
            color={`#${this.props.threadInfo.color}`}
          />
        </a>
      );
    }

    if (
      threadHasPermission(this.props.threadInfo, threadPermissions.VOICED) ||
      (this.props.threadCreationInProgress && defaultMembersAreVoiced)
    ) {
      content = (
        <div className={css.inputBarWrapper}>
          <a className={css.multimediaUpload} onClick={this.onMultimediaClick}>
            <input
              type="file"
              onChange={this.onMultimediaFileChange}
              ref={this.multimediaInputRef}
              accept={allowedMimeTypeString}
              multiple
            />
            <SWMansionIcon
              icon="image-1"
              size={22}
              color={`#${this.props.threadInfo.color}`}
              disableFill
            />
          </a>
          <div className={css.inputBarTextInput}>
            <textarea
              rows="1"
              placeholder="Type your message"
              value={this.props.inputState.draft}
              onChange={this.onChangeMessageText}
              onKeyDown={this.onKeyDown}
              onClick={this.onClickTextarea}
              onSelect={this.onSelectTextarea}
              ref={this.textareaRef}
              autoFocus
            />
          </div>
          {sendButton}
        </div>
      );
    } else if (
      threadFrozenDueToViewerBlock(
        this.props.threadInfo,
        this.props.viewerID,
        this.props.userInfos,
      ) &&
      threadActualMembers(this.props.threadInfo.members).length === 2
    ) {
      content = (
        <span className={css.explanation}>
          You can&rsquo;t send messages to a user that you&rsquo;ve blocked.
        </span>
      );
    } else if (isMember) {
      content = (
        <span className={css.explanation}>
          You don&rsquo;t have permission to send messages.
        </span>
      );
    } else if (defaultMembersAreVoiced && canJoin) {
      content = null;
    } else {
      content = (
        <span className={css.explanation}>
          You don&rsquo;t have permission to send messages.
        </span>
      );
    }

    let typeaheadTooltip;
    if (
      this.props.inputState.typeaheadState.canBeVisible &&
      this.props.suggestions.length > 0 &&
      this.props.typeaheadMatchedStrings &&
      this.textarea
    ) {
      typeaheadTooltip = (
        <TypeaheadTooltip
          inputState={this.props.inputState}
          textarea={this.textarea}
          matchedStrings={this.props.typeaheadMatchedStrings}
          suggestions={this.props.suggestions}
          typeaheadTooltipActionsGetter={getMentionTypeaheadTooltipActions}
          typeaheadTooltipButtonsGetter={getMentionTypeaheadTooltipButtons}
        />
      );
    }

    return (
      <div className={css.inputBar}>
        {joinButton}
        {previews}
        {content}
        {typeaheadTooltip}
      </div>
    );
  }

  textareaRef = (textarea: ?HTMLTextAreaElement) => {
    this.textarea = textarea;
    if (textarea) {
      textarea.focus();
    }
  };

  onChangeMessageText = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    this.props.inputState.setDraft(event.currentTarget.value);
    this.props.inputState.setTextCursorPosition(
      event.currentTarget.selectionStart,
    );
  };

  onClickTextarea = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    this.props.inputState.setTextCursorPosition(
      event.currentTarget.selectionStart,
    );
  };

  onSelectTextarea = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    this.props.inputState.setTextCursorPosition(
      event.currentTarget.selectionStart,
    );
  };

  focusAndUpdateText = (text: string) => {
    // We need to call focus() first on Safari, otherwise the cursor
    // ends up at the start instead of the end for some reason
    const { textarea } = this;
    invariant(textarea, 'textarea should be set');
    textarea.focus();

    // We reset the textarea to an empty string at the start so that the cursor
    // always ends up at the end, even if the text doesn't actually change
    textarea.value = '';
    const currentText = this.props.inputState.draft;
    if (!currentText.startsWith(text)) {
      const prependedText = text.concat(currentText);
      this.props.inputState.setDraft(prependedText);
      textarea.value = prependedText;
    } else {
      textarea.value = currentText;
    }

    // The above strategies make sure the cursor is at the end,
    // but we also need to make sure that we're scrolled to the bottom
    textarea.scrollTop = textarea.scrollHeight;
  };

  onKeyDown = (event: SyntheticKeyboardEvent<HTMLTextAreaElement>) => {
    const { accept, close, moveChoiceUp, moveChoiceDown } =
      this.props.inputState.typeaheadState;

    const actions = {
      Enter: accept,
      Tab: accept,
      ArrowDown: moveChoiceDown,
      ArrowUp: moveChoiceUp,
      Escape: close,
    };

    if (
      this.props.inputState.typeaheadState.canBeVisible &&
      actions[event.key]
    ) {
      event.preventDefault();
      actions[event.key]();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  };

  onSend = (event: SyntheticEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    this.send();
  };

  send() {
    let { nextLocalID } = this.props;

    const text = trimMessage(this.props.inputState.draft);
    if (text) {
      this.dispatchTextMessageAction(text, nextLocalID);
      nextLocalID++;
    }
    if (this.props.inputState.pendingUploads.length > 0) {
      this.props.inputState.createMultimediaMessage(
        nextLocalID,
        this.props.threadInfo,
      );
    }
  }

  dispatchTextMessageAction(text: string, nextLocalID: number) {
    this.props.inputState.setDraft('');

    const localID = `${localIDPrefix}${nextLocalID}`;
    const creatorID = this.props.viewerID;
    invariant(creatorID, 'should have viewer ID in order to send a message');

    void this.props.inputState.sendTextMessage(
      {
        type: messageTypes.TEXT,
        localID,
        threadID: this.props.threadInfo.id,
        text,
        creatorID,
        time: Date.now(),
      },
      this.props.threadInfo,
      this.props.parentThreadInfo,
    );
  }

  multimediaInputRef = (multimediaInput: ?HTMLInputElement) => {
    this.multimediaInput = multimediaInput;
  };

  onMultimediaClick = () => {
    if (this.multimediaInput) {
      this.multimediaInput.click();
    }
  };

  onMultimediaFileChange = async (
    event: SyntheticInputEvent<HTMLInputElement>,
  ) => {
    const result = await this.props.inputState.appendFiles(
      this.props.threadInfo,
      [...event.target.files],
    );
    if (!result && this.multimediaInput) {
      this.multimediaInput.value = '';
    }
  };

  onClickJoin = () => {
    void this.props.dispatchActionPromise(
      joinThreadActionTypes,
      this.joinAction(),
    );
  };

  async joinAction(): Promise<ThreadJoinPayload> {
    const query = this.props.calendarQuery();
    return await this.props.joinThread({
      threadID: this.props.threadInfo.id,
      calendarQuery: {
        startDate: query.startDate,
        endDate: query.endDate,
        filters: [
          ...query.filters,
          { type: 'threads', threadIDs: [this.props.threadInfo.id] },
        ],
      },
    });
  }
}

const joinThreadLoadingStatusSelector = createLoadingStatusSelector(
  joinThreadActionTypes,
);
const createThreadLoadingStatusSelector =
  createLoadingStatusSelector(newThreadActionTypes);

const ConnectedChatInputBar: React.ComponentType<BaseProps> =
  React.memo<BaseProps>(function ConnectedChatInputBar(props) {
    const viewerID = useSelector(
      state => state.currentUserInfo && state.currentUserInfo.id,
    );
    const nextLocalID = useSelector(state => state.nextLocalID);
    const isThreadActive = useSelector(
      state => props.threadInfo.id === state.navInfo.activeChatThreadID,
    );
    const userInfos = useSelector(state => state.userStore.userInfos);
    const joinThreadLoadingStatus = useSelector(
      joinThreadLoadingStatusSelector,
    );
    const createThreadLoadingStatus = useSelector(
      createThreadLoadingStatusSelector,
    );
    const threadCreationInProgress = createThreadLoadingStatus === 'loading';
    const calendarQuery = useSelector(nonThreadCalendarQuery);
    const dispatchActionPromise = useDispatchActionPromise();
    const callJoinThread = useJoinThread();
    const { getChatMentionSearchIndex } = useChatMentionContext();
    const chatMentionSearchIndex = getChatMentionSearchIndex(props.threadInfo);

    const { parentThreadID } = props.threadInfo;
    const parentThreadInfo = useSelector(state =>
      parentThreadID ? threadInfoSelector(state)[parentThreadID] : null,
    );

    const userMentionsCandidates = useUserMentionsCandidates(
      props.threadInfo,
      parentThreadInfo,
    );

    const chatMentionCandidates = useThreadChatMentionCandidates(
      props.threadInfo,
    );

    const typeaheadRegexMatches = React.useMemo(
      () =>
        getTypeaheadRegexMatches(
          props.inputState.draft,
          {
            start: props.inputState.textCursorPosition,
            end: props.inputState.textCursorPosition,
          },
          webMentionTypeaheadRegex,
        ),
      [props.inputState.textCursorPosition, props.inputState.draft],
    );

    const typeaheadMatchedStrings: ?TypeaheadMatchedStrings =
      React.useMemo(() => {
        if (typeaheadRegexMatches === null) {
          return null;
        }
        return {
          textBeforeAtSymbol: typeaheadRegexMatches.groups?.textPrefix ?? '',
          query: typeaheadRegexMatches.groups?.mentionText ?? '',
        };
      }, [typeaheadRegexMatches]);

    React.useEffect(() => {
      if (props.inputState.typeaheadState.keepUpdatingThreadMembers) {
        const setter = props.inputState.setTypeaheadState;
        setter({
          frozenUserMentionsCandidates: userMentionsCandidates,
          frozenChatMentionsCandidates: chatMentionCandidates,
        });
      }
    }, [
      userMentionsCandidates,
      props.inputState.setTypeaheadState,
      props.inputState.typeaheadState.keepUpdatingThreadMembers,
      chatMentionCandidates,
    ]);

    const suggestedUsers = useMentionTypeaheadUserSuggestions(
      props.inputState.typeaheadState.frozenUserMentionsCandidates,
      typeaheadMatchedStrings,
    );

    const suggestedChats = useMentionTypeaheadChatSuggestions(
      chatMentionSearchIndex,
      props.inputState.typeaheadState.frozenChatMentionsCandidates,
      typeaheadMatchedStrings,
    );

    const suggestions: $ReadOnlyArray<MentionTypeaheadSuggestionItem> =
      React.useMemo(
        () => [...suggestedUsers, ...suggestedChats],
        [suggestedUsers, suggestedChats],
      );

    return (
      <ChatInputBar
        {...props}
        viewerID={viewerID}
        joinThreadLoadingStatus={joinThreadLoadingStatus}
        threadCreationInProgress={threadCreationInProgress}
        calendarQuery={calendarQuery}
        nextLocalID={nextLocalID}
        isThreadActive={isThreadActive}
        userInfos={userInfos}
        dispatchActionPromise={dispatchActionPromise}
        joinThread={callJoinThread}
        typeaheadMatchedStrings={typeaheadMatchedStrings}
        suggestions={suggestions}
        parentThreadInfo={parentThreadInfo}
      />
    );
  });

export default ConnectedChatInputBar;
