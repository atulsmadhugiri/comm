// @flow

import * as React from 'react';

import {
  IdentityClientContext,
  type AuthMetadata,
} from 'lib/shared/identity-client-context.js';

import { IdentityServiceClientWrapper } from './identity-service-client-wrapper.js';
import { useGetDeviceKeyUpload } from '../account/account-hooks.js';
import { useSelector } from '../redux/redux-utils.js';

type Props = {
  +children: React.Node,
};
function IdentityServiceContextProvider(props: Props): React.Node {
  const { children } = props;

  const userID = useSelector(state => state.currentUserInfo?.id);
  const accessToken = useSelector(state => state.commServicesAccessToken);
  const deviceID = useSelector(
    state => state.cryptoStore?.primaryIdentityKeys.ed25519,
  );
  const getDeviceKeyUpload = useGetDeviceKeyUpload();

  const client = React.useMemo(() => {
    let authLayer = null;
    if (userID && deviceID && accessToken) {
      authLayer = {
        userID,
        deviceID,
        commServicesAccessToken: accessToken,
      };
    }
    return new IdentityServiceClientWrapper(authLayer, getDeviceKeyUpload);
  }, [accessToken, deviceID, getDeviceKeyUpload, userID]);

  const getAuthMetadata = React.useCallback<() => Promise<AuthMetadata>>(
    async () => ({
      userID,
      deviceID,
      accessToken,
    }),
    [accessToken, deviceID, userID],
  );

  const value = React.useMemo(
    () => ({
      identityClient: client,
      getAuthMetadata,
    }),
    [client, getAuthMetadata],
  );

  return (
    <IdentityClientContext.Provider value={value}>
      {children}
    </IdentityClientContext.Provider>
  );
}

export default IdentityServiceContextProvider;
