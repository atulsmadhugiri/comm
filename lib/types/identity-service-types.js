// @flow

import t, { type TInterface } from 'tcomb';

import {
  identityKeysBlobValidator,
  type IdentityKeysBlob,
  signedPrekeysValidator,
  type SignedPrekeys,
  type OneTimeKeysResultValues,
} from './crypto-types.js';
import {
  type OlmSessionInitializationInfo,
  olmSessionInitializationInfoValidator,
} from './request-types.js';
import { tShape } from '../utils/validation-utils.js';

export type UserAuthMetadata = {
  +userID: string,
  +accessToken: string,
};

// This type should not be altered without also updating
// OutboundKeyInfoResponse in native/native_rust_library/src/lib.rs
export type OutboundKeyInfoResponse = {
  +payload: string,
  +payloadSignature: string,
  +socialProof: ?string,
  +contentPrekey: string,
  +contentPrekeySignature: string,
  +notifPrekey: string,
  +notifPrekeySignature: string,
  +oneTimeContentPrekey: ?string,
  +oneTimeNotifPrekey: ?string,
};

// This type should not be altered without also updating
// InboundKeyInfoResponse in native/native_rust_library/src/lib.rs
export type InboundKeyInfoResponse = {
  +payload: string,
  +payloadSignature: string,
  +socialProof?: ?string,
  +contentPrekey: string,
  +contentPrekeySignature: string,
  +notifPrekey: string,
  +notifPrekeySignature: string,
  +username?: ?string,
  +walletAddress?: ?string,
};

export type DeviceOlmOutboundKeys = {
  +identityKeysBlob: IdentityKeysBlob,
  +contentInitializationInfo: OlmSessionInitializationInfo,
  +notifInitializationInfo: OlmSessionInitializationInfo,
  +payloadSignature: string,
  +socialProof: ?string,
};
export const deviceOlmOutboundKeysValidator: TInterface<DeviceOlmOutboundKeys> =
  tShape<DeviceOlmOutboundKeys>({
    identityKeysBlob: identityKeysBlobValidator,
    contentInitializationInfo: olmSessionInitializationInfoValidator,
    notifInitializationInfo: olmSessionInitializationInfoValidator,
    payloadSignature: t.String,
    socialProof: t.maybe(t.String),
  });

export type UserDevicesOlmOutboundKeys = {
  +deviceID: string,
  +keys: ?DeviceOlmOutboundKeys,
};

export type DeviceOlmInboundKeys = {
  +identityKeysBlob: IdentityKeysBlob,
  +signedPrekeys: SignedPrekeys,
  +payloadSignature: string,
};
export const deviceOlmInboundKeysValidator: TInterface<DeviceOlmInboundKeys> =
  tShape<DeviceOlmInboundKeys>({
    identityKeysBlob: identityKeysBlobValidator,
    signedPrekeys: signedPrekeysValidator,
    payloadSignature: t.String,
  });

export type UserDevicesOlmInboundKeys = {
  +keys: {
    +[deviceID: string]: ?DeviceOlmInboundKeys,
  },
  +username?: ?string,
  +walletAddress?: ?string,
};

export const userDeviceOlmInboundKeysValidator: TInterface<UserDevicesOlmInboundKeys> =
  tShape<UserDevicesOlmInboundKeys>({
    keys: t.dict(t.String, t.maybe(deviceOlmInboundKeysValidator)),
    username: t.maybe(t.String),
    walletAddress: t.maybe(t.String),
  });

export interface IdentityServiceClient {
  +deleteUser: () => Promise<void>;
  +getKeyserverKeys: string => Promise<DeviceOlmOutboundKeys>;
  +registerPasswordUser?: (
    username: string,
    password: string,
  ) => Promise<IdentityAuthResult>;
  +logInPasswordUser: (
    username: string,
    password: string,
  ) => Promise<IdentityAuthResult>;
  +getOutboundKeysForUser: (
    userID: string,
  ) => Promise<UserDevicesOlmOutboundKeys[]>;
  +getInboundKeysForUser: (
    userID: string,
  ) => Promise<UserDevicesOlmInboundKeys>;
  +uploadOneTimeKeys: (oneTimeKeys: OneTimeKeysResultValues) => Promise<void>;
  +generateNonce: () => Promise<string>;
  +registerWalletUser?: (
    walletAddress: string,
    siweMessage: string,
    siweSignature: string,
  ) => Promise<IdentityAuthResult>;
  +logInWalletUser: (
    walletAddress: string,
    siweMessage: string,
    siweSignature: string,
  ) => Promise<IdentityAuthResult>;
  +publishWebPrekeys?: (prekeys: SignedPrekeys) => Promise<void>;
}

export type IdentityServiceAuthLayer = {
  +userID: string,
  +deviceID: string,
  +commServicesAccessToken: string,
};

export type IdentityAuthResult = {
  +userID: string,
  +accessToken: string,
  +username: string,
};
export const identityAuthResultValidator: TInterface<IdentityAuthResult> =
  tShape<IdentityAuthResult>({
    userID: t.String,
    accessToken: t.String,
    username: t.String,
  });

export type IdentityDeviceKeyUpload = {
  +keyPayload: string,
  +keyPayloadSignature: string,
  +contentPrekey: string,
  +contentPrekeySignature: string,
  +notifPrekey: string,
  +notifPrekeySignature: string,
  +contentOneTimeKeys: $ReadOnlyArray<string>,
  +notifOneTimeKeys: $ReadOnlyArray<string>,
};

export const ONE_TIME_KEYS_NUMBER = 10;

export const identityDeviceTypes = Object.freeze({
  KEYSERVER: 0,
  WEB: 1,
  IOS: 2,
  ANDROID: 3,
  WINDOWS: 4,
  MAC_OS: 5,
});
