// @flow

import invariant from 'invariant';

import {
  type CreateMessageInfoParams,
  type MessageSpec,
  pushTypes,
} from './message-spec.js';
import { assertSingleMessageInfo } from './utils.js';
import { messageTypes } from '../../types/message-types-enum.js';
import type {
  ClientDBMessageInfo,
  MessageInfo,
} from '../../types/message-types.js';
import {
  type RawUpdateRelationshipMessageInfo,
  rawUpdateRelationshipMessageInfoValidator,
  type UpdateRelationshipMessageData,
  type UpdateRelationshipMessageInfo,
} from '../../types/messages/update-relationship.js';
import type { ThreadInfo } from '../../types/minimally-encoded-thread-permissions-types.js';
import type { NotifTexts } from '../../types/notif-types.js';
import type { RelativeUserInfo } from '../../types/user-types.js';
import { type EntityText, ET } from '../../utils/entity-text.js';

type UpdateRelationshipMessageSpec = MessageSpec<
  UpdateRelationshipMessageData,
  RawUpdateRelationshipMessageInfo,
  UpdateRelationshipMessageInfo,
> & {
  // We need to explicitly type this as non-optional so that
  // it can be referenced from messageContentForClientDB below
  +messageContentForServerDB: (
    data: UpdateRelationshipMessageData | RawUpdateRelationshipMessageInfo,
  ) => string,
  ...
};

export const updateRelationshipMessageSpec: UpdateRelationshipMessageSpec =
  Object.freeze({
    messageContentForServerDB(
      data: UpdateRelationshipMessageData | RawUpdateRelationshipMessageInfo,
    ): string {
      return JSON.stringify({
        operation: data.operation,
        targetID: data.targetID,
      });
    },

    messageContentForClientDB(data: RawUpdateRelationshipMessageInfo): string {
      return updateRelationshipMessageSpec.messageContentForServerDB(data);
    },

    rawMessageInfoFromServerDBRow(
      row: Object,
    ): RawUpdateRelationshipMessageInfo {
      const content = JSON.parse(row.content);
      return {
        type: messageTypes.UPDATE_RELATIONSHIP,
        id: row.id.toString(),
        threadID: row.threadID.toString(),
        time: row.time,
        creatorID: row.creatorID.toString(),
        targetID: content.targetID,
        operation: content.operation,
      };
    },

    rawMessageInfoFromClientDB(
      clientDBMessageInfo: ClientDBMessageInfo,
    ): RawUpdateRelationshipMessageInfo {
      invariant(
        clientDBMessageInfo.content !== undefined &&
          clientDBMessageInfo.content !== null,
        'content must be defined for UpdateRelationship',
      );
      const content = JSON.parse(clientDBMessageInfo.content);
      const rawUpdateRelationshipMessageInfo: RawUpdateRelationshipMessageInfo =
        {
          type: messageTypes.UPDATE_RELATIONSHIP,
          id: clientDBMessageInfo.id,
          threadID: clientDBMessageInfo.thread,
          time: parseInt(clientDBMessageInfo.time),
          creatorID: clientDBMessageInfo.user,
          targetID: content.targetID,
          operation: content.operation,
        };
      return rawUpdateRelationshipMessageInfo;
    },

    createMessageInfo(
      rawMessageInfo: RawUpdateRelationshipMessageInfo,
      creator: RelativeUserInfo,
      params: CreateMessageInfoParams,
    ): ?UpdateRelationshipMessageInfo {
      const target = params.createRelativeUserInfos([
        rawMessageInfo.targetID,
      ])[0];
      if (!target) {
        return null;
      }
      return {
        type: messageTypes.UPDATE_RELATIONSHIP,
        id: rawMessageInfo.id,
        threadID: rawMessageInfo.threadID,
        creator,
        target,
        time: rawMessageInfo.time,
        operation: rawMessageInfo.operation,
      };
    },

    rawMessageInfoFromMessageData(
      messageData: UpdateRelationshipMessageData,
      id: ?string,
    ): RawUpdateRelationshipMessageInfo {
      invariant(id, 'RawUpdateRelationshipMessageInfo needs id');
      return { ...messageData, id };
    },

    // ESLint doesn't recognize that invariant always throws
    // eslint-disable-next-line consistent-return
    robotext(messageInfo: UpdateRelationshipMessageInfo): EntityText {
      const creator = ET.user({ userInfo: messageInfo.creator });
      if (messageInfo.operation === 'request_sent') {
        const target = ET.user({ userInfo: messageInfo.target });
        return ET`${creator} sent ${target} a friend request`;
      } else if (messageInfo.operation === 'request_accepted') {
        const targetPossessive = ET.user({
          userInfo: messageInfo.target,
          possessive: true,
        });
        return ET`${creator} accepted ${targetPossessive} friend request`;
      }
      invariant(
        false,
        `Invalid operation ${messageInfo.operation} ` +
          `of message with type ${messageInfo.type}`,
      );
    },

    unshimMessageInfo(
      unwrapped: RawUpdateRelationshipMessageInfo,
    ): RawUpdateRelationshipMessageInfo {
      return unwrapped;
    },

    async notificationTexts(
      messageInfos: $ReadOnlyArray<MessageInfo>,
      threadInfo: ThreadInfo,
    ): Promise<NotifTexts> {
      const messageInfo = assertSingleMessageInfo(messageInfos);
      const creator = ET.user({ userInfo: messageInfo.creator });
      const prefix = ET`${creator}`;
      const title = threadInfo.uiName;
      const body =
        messageInfo.operation === 'request_sent'
          ? 'sent you a friend request'
          : 'accepted your friend request';
      const merged = ET`${prefix} ${body}`;
      return {
        merged,
        body,
        title,
        prefix,
      };
    },

    generatesNotifs: async () => pushTypes.NOTIF,

    canBeSidebarSource: true,

    canBePinned: false,

    validator: rawUpdateRelationshipMessageInfoValidator,
  });
