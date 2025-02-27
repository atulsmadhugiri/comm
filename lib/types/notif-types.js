// @flow

import t, { type TInterface } from 'tcomb';

import type { EntityText, ThreadEntity } from '../utils/entity-text.js';
import { tShape } from '../utils/validation-utils.js';

export type NotifTexts = {
  +merged: string | EntityText,
  +body: string | EntityText,
  +title: string | ThreadEntity,
  +prefix?: string | EntityText,
};

export type ResolvedNotifTexts = {
  +merged: string,
  +body: string,
  +title: string,
  +prefix?: string,
};
export const resolvedNotifTextsValidator: TInterface<ResolvedNotifTexts> =
  tShape<ResolvedNotifTexts>({
    merged: t.String,
    body: t.String,
    title: t.String,
    prefix: t.maybe(t.String),
  });

export type PlainTextWebNotificationPayload = {
  +body: string,
  +prefix?: string,
  +title: string,
  +unreadCount: number,
  +threadID: string,
  +encryptionFailed?: '1',
};

export type PlainTextWebNotification = {
  +id: string,
  ...PlainTextWebNotificationPayload,
};

export type EncryptedWebNotification = {
  +id: string,
  +encryptedPayload: string,
};

export type WebNotification =
  | PlainTextWebNotification
  | EncryptedWebNotification;

export type PlainTextWNSNotification = {
  +body: string,
  +prefix?: string,
  +title: string,
  +unreadCount: number,
  +threadID: string,
  +encryptionFailed?: '1',
};

export type EncryptedWNSNotification = {
  +encryptedPayload: string,
};

export type WNSNotification =
  | PlainTextWNSNotification
  | EncryptedWNSNotification;
