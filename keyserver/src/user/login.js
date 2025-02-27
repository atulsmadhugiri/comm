// @flow

import type { Account as OlmAccount } from '@commapp/olm';
import { getRustAPI } from 'rust-node-addon';

import { getCommConfig } from 'lib/utils/comm-config.js';
import { ServerError } from 'lib/utils/errors.js';
import { retrieveAccountKeysSet } from 'lib/utils/olm-utils.js';

import {
  saveIdentityInfo,
  fetchIdentityInfo,
  type IdentityInfo,
} from './identity.js';
import { getMessageForException } from '../responders/utils.js';
import { fetchCallUpdateOlmAccount } from '../updaters/olm-account-updater.js';

type UserCredentials = { +username: string, +password: string };

// After register or login is successful
function markKeysAsPublished(account: OlmAccount) {
  account.mark_prekey_as_published();
  account.mark_keys_as_published();
}

async function verifyUserLoggedIn(): Promise<IdentityInfo> {
  const result = await fetchIdentityInfo();

  if (result) {
    return result;
  }

  const identityInfo = await registerOrLogIn();
  await saveIdentityInfo(identityInfo);
  return identityInfo;
}

async function registerOrLogIn(): Promise<IdentityInfo> {
  const rustAPIPromise = getRustAPI();

  const userInfo = await getCommConfig<UserCredentials>({
    folder: 'secrets',
    name: 'user_credentials',
  });

  if (!userInfo) {
    throw new ServerError('missing_user_credentials');
  }

  const {
    identityKeys: notificationsIdentityKeys,
    prekey: notificationsPrekey,
    prekeySignature: notificationsPrekeySignature,
    oneTimeKeys: notificationsOneTimeKeys,
  } = await fetchCallUpdateOlmAccount('notifications', retrieveAccountKeysSet);

  const contentAccountCallback = async (account: OlmAccount) => {
    const {
      identityKeys: contentIdentityKeys,
      oneTimeKeys,
      prekey,
      prekeySignature,
    } = await retrieveAccountKeysSet(account);

    const identityKeysBlob = {
      primaryIdentityPublicKeys: JSON.parse(contentIdentityKeys),
      notificationIdentityPublicKeys: JSON.parse(notificationsIdentityKeys),
    };
    const identityKeysBlobPayload = JSON.stringify(identityKeysBlob);
    const signedIdentityKeysBlob = {
      payload: identityKeysBlobPayload,
      signature: account.sign(identityKeysBlobPayload),
    };

    return {
      signedIdentityKeysBlob,
      oneTimeKeys,
      prekey,
      prekeySignature,
    };
  };

  const [
    rustAPI,
    {
      signedIdentityKeysBlob,
      prekey: contentPrekey,
      prekeySignature: contentPrekeySignature,
      oneTimeKeys: contentOneTimeKeys,
    },
  ] = await Promise.all([
    rustAPIPromise,
    fetchCallUpdateOlmAccount('content', contentAccountCallback),
  ]);

  try {
    const identity_info = await rustAPI.loginUser(
      userInfo.username,
      userInfo.password,
      signedIdentityKeysBlob,
      contentPrekey,
      contentPrekeySignature,
      notificationsPrekey,
      notificationsPrekeySignature,
      contentOneTimeKeys,
      notificationsOneTimeKeys,
    );
    await Promise.all([
      fetchCallUpdateOlmAccount('content', markKeysAsPublished),
      fetchCallUpdateOlmAccount('notifications', markKeysAsPublished),
    ]);
    return identity_info;
  } catch (e) {
    console.warn('Failed to login user: ' + getMessageForException(e));
    try {
      const identity_info = await rustAPI.registerUser(
        userInfo.username,
        userInfo.password,
        signedIdentityKeysBlob,
        contentPrekey,
        contentPrekeySignature,
        notificationsPrekey,
        notificationsPrekeySignature,
        contentOneTimeKeys,
        notificationsOneTimeKeys,
      );
      await Promise.all([
        fetchCallUpdateOlmAccount('content', markKeysAsPublished),
        fetchCallUpdateOlmAccount('notifications', markKeysAsPublished),
      ]);
      return identity_info;
    } catch (err) {
      console.warn('Failed to register user: ' + getMessageForException(err));
      throw new ServerError('identity_auth_failed');
    }
  }
}

export { verifyUserLoggedIn };
