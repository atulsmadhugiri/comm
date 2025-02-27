// @flow

import invariant from 'invariant';
import * as React from 'react';

import {
  keyserverAuthActionTypes,
  logOutActionTypes,
  useKeyserverAuth,
  useLogOut,
} from '../actions/user-actions.js';
import { extractKeyserverIDFromID } from '../keyserver-conn/keyserver-call-utils.js';
import { filterThreadIDsInFilterList } from '../reducers/calendar-filters-reducer.js';
import {
  connectionSelector,
  cookieSelector,
  deviceTokenSelector,
} from '../selectors/keyserver-selectors.js';
import { isLoggedInToKeyserver } from '../selectors/user-selectors.js';
import { IdentityClientContext } from '../shared/identity-client-context.js';
import { OlmSessionCreatorContext } from '../shared/olm-session-creator-context.js';
import type { BaseSocketProps } from '../socket/socket.react.js';
import { logInActionSources } from '../types/account-types.js';
import { authoritativeKeyserverID } from '../utils/authoritative-keyserver.js';
import { useDispatchActionPromise } from '../utils/redux-promise-utils.js';
import { useSelector } from '../utils/redux-utils.js';
import { usingCommServicesAccessToken } from '../utils/services-utils.js';
import sleep from '../utils/sleep.js';

type Props = {
  ...BaseSocketProps,
  +socketComponent: React.ComponentType<BaseSocketProps>,
};

const AUTH_RETRY_DELAY_MS = 60000;
const CANCELLED_ERROR = 'cancelled';

function KeyserverConnectionHandler(props: Props) {
  const { socketComponent: Socket, ...socketProps } = props;
  const { keyserverID } = props;

  const dispatchActionPromise = useDispatchActionPromise();
  const callLogOut = useLogOut();
  const keyserverAuth = useKeyserverAuth();

  const hasConnectionIssue = useSelector(
    state => !!connectionSelector(keyserverID)(state)?.connectionIssue,
  );
  const cookie = useSelector(cookieSelector(keyserverID));
  const dataLoaded = useSelector(state => state.dataLoaded);

  const keyserverDeviceToken = useSelector(deviceTokenSelector(keyserverID));
  // We have an assumption that we should be always connected to Ashoat's
  // keyserver. It is possible that a token which it has is correct, so we can
  // try to use it. In worst case it is invalid and our push-handler will try
  // to fix it.
  const ashoatKeyserverDeviceToken = useSelector(
    deviceTokenSelector(authoritativeKeyserverID()),
  );
  const deviceToken = keyserverDeviceToken ?? ashoatKeyserverDeviceToken;

  const navInfo = useSelector(state => state.navInfo);
  const calendarFilters = useSelector(state => state.calendarFilters);
  const calendarQuery = React.useMemo(() => {
    const filters = filterThreadIDsInFilterList(
      calendarFilters,
      (threadID: string) => extractKeyserverIDFromID(threadID) === keyserverID,
    );
    return {
      startDate: navInfo.startDate,
      endDate: navInfo.endDate,
      filters,
    };
  }, [calendarFilters, keyserverID, navInfo.endDate, navInfo.startDate]);

  React.useEffect(() => {
    if (hasConnectionIssue && !usingCommServicesAccessToken) {
      void dispatchActionPromise(logOutActionTypes, callLogOut());
    }
  }, [callLogOut, hasConnectionIssue, dispatchActionPromise]);

  const identityContext = React.useContext(IdentityClientContext);
  invariant(identityContext, 'Identity context should be set');
  const { identityClient, getAuthMetadata } = identityContext;

  const olmSessionCreator = React.useContext(OlmSessionCreatorContext);
  invariant(olmSessionCreator, 'Olm session creator should be set');

  const [authInProgress, setAuthInProgress] = React.useState(false);
  const performAuth = React.useCallback(() => {
    setAuthInProgress(true);

    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      setAuthInProgress(false);
    };

    const promise = (async () => {
      try {
        const keyserverKeys =
          await identityClient.getKeyserverKeys(keyserverID);

        if (cancelled) {
          throw new Error(CANCELLED_ERROR);
        }

        const [notifsSession, contentSession, { userID, deviceID }] =
          await Promise.all([
            olmSessionCreator.notificationsSessionCreator(
              cookie,
              keyserverKeys.identityKeysBlob.notificationIdentityPublicKeys,
              keyserverKeys.notifInitializationInfo,
              keyserverID,
            ),
            olmSessionCreator.contentSessionCreator(
              keyserverKeys.identityKeysBlob.primaryIdentityPublicKeys,
              keyserverKeys.contentInitializationInfo,
            ),
            getAuthMetadata(),
          ]);

        invariant(userID, 'userID should be set');
        invariant(deviceID, 'deviceID should be set');

        const deviceTokenUpdateInput = deviceToken
          ? { [keyserverID]: { deviceToken } }
          : {};

        if (cancelled) {
          throw new Error(CANCELLED_ERROR);
        }

        await dispatchActionPromise(
          keyserverAuthActionTypes,
          (async () => {
            const result = await keyserverAuth({
              userID,
              deviceID,
              doNotRegister: false,
              calendarQuery,
              deviceTokenUpdateInput,
              logInActionSource: process.env.BROWSER
                ? logInActionSources.keyserverAuthFromWeb
                : logInActionSources.keyserverAuthFromNative,
              keyserverData: {
                [keyserverID]: {
                  initialContentEncryptedMessage: contentSession,
                  initialNotificationsEncryptedMessage: notifsSession,
                },
              },
            });
            if (cancelled) {
              throw new Error(CANCELLED_ERROR);
            }
            return result;
          })(),
        );
      } catch (e) {
        if (cancelled) {
          return;
        }

        console.log(
          `Error while authenticating to keyserver with id ${keyserverID}`,
          e,
        );

        if (!dataLoaded && keyserverID === authoritativeKeyserverID()) {
          await dispatchActionPromise(logOutActionTypes, callLogOut());
        }
      } finally {
        if (!cancelled) {
          await sleep(AUTH_RETRY_DELAY_MS);
          setAuthInProgress(false);
        }
      }
    })();
    return [promise, cancel];
  }, [
    calendarQuery,
    callLogOut,
    cookie,
    dataLoaded,
    deviceToken,
    dispatchActionPromise,
    getAuthMetadata,
    identityClient,
    keyserverAuth,
    keyserverID,
    olmSessionCreator,
  ]);

  const cancelPendingAuth = React.useRef<?() => void>(null);
  const prevPerformAuth = React.useRef(performAuth);
  const isUserAuthenticated = useSelector(isLoggedInToKeyserver(keyserverID));
  const hasAccessToken = useSelector(state => !!state.commServicesAccessToken);

  React.useEffect(() => {
    if (!hasAccessToken) {
      cancelPendingAuth.current?.();
      cancelPendingAuth.current = null;
    }

    if (
      !usingCommServicesAccessToken ||
      isUserAuthenticated ||
      !hasAccessToken
    ) {
      return;
    }

    if (prevPerformAuth.current !== performAuth) {
      cancelPendingAuth.current?.();
      cancelPendingAuth.current = null;
    }
    prevPerformAuth.current = performAuth;

    if (authInProgress) {
      return;
    }

    const [, cancel] = performAuth();
    cancelPendingAuth.current = cancel;
  }, [authInProgress, hasAccessToken, isUserAuthenticated, performAuth]);

  if (keyserverID !== authoritativeKeyserverID()) {
    return null;
  }
  return <Socket {...socketProps} />;
}

const Handler: React.ComponentType<Props> = React.memo<Props>(
  KeyserverConnectionHandler,
);

export default Handler;
