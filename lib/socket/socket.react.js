// @flow

import invariant from 'invariant';
import _isEqual from 'lodash/fp/isEqual.js';
import _throttle from 'lodash/throttle.js';
import * as React from 'react';

import ActivityHandler from './activity-handler.react.js';
import APIRequestHandler from './api-request-handler.react.js';
import CalendarQueryHandler from './calendar-query-handler.react.js';
import { InflightRequests } from './inflight-requests.js';
import MessageHandler from './message-handler.react.js';
import ReportHandler from './report-handler.react.js';
import RequestResponseHandler from './request-response-handler.react.js';
import UpdateHandler from './update-handler.react.js';
import { updateActivityActionTypes } from '../actions/activity-actions.js';
import { updateLastCommunicatedPlatformDetailsActionType } from '../actions/device-actions.js';
import {
  setNewSessionActionType,
  setConnectionIssueActionType,
  updateConnectionStatusActionType,
  setLateResponseActionType,
} from '../keyserver-conn/keyserver-conn-types.js';
import { resolveKeyserverSessionInvalidation } from '../keyserver-conn/recovery-utils.js';
import { unsupervisedBackgroundActionType } from '../reducers/lifecycle-state-reducer.js';
import type { InitialNotifMessageOptions } from '../shared/crypto-utils.js';
import {
  pingFrequency,
  serverRequestSocketTimeout,
  clientRequestVisualTimeout,
  clientRequestSocketTimeout,
} from '../shared/timeouts.js';
import { logInActionSources } from '../types/account-types.js';
import type { CompressedData } from '../types/compression-types.js';
import { type PlatformDetails } from '../types/device-types.js';
import type { CalendarQuery } from '../types/entry-types.js';
import { forcePolicyAcknowledgmentActionType } from '../types/policy-types.js';
import type { Dispatch } from '../types/redux-types.js';
import {
  serverRequestTypes,
  type ClientClientResponse,
  type ClientServerRequest,
} from '../types/request-types.js';
import {
  type SessionState,
  type SessionIdentification,
  type PreRequestUserState,
} from '../types/session-types.js';
import {
  clientSocketMessageTypes,
  type ClientClientSocketMessage,
  serverSocketMessageTypes,
  type ClientServerSocketMessage,
  stateSyncPayloadTypes,
  fullStateSyncActionType,
  incrementalStateSyncActionType,
  type ConnectionInfo,
  type ClientInitialClientSocketMessage,
  type ClientResponsesClientSocketMessage,
  type PingClientSocketMessage,
  type AckUpdatesClientSocketMessage,
  type APIRequestClientSocketMessage,
  type ClientSocketMessageWithoutID,
  type SocketListener,
  type ConnectionStatus,
  type CommTransportLayer,
  type ActivityUpdateResponseServerSocketMessage,
  type ClientStateSyncServerSocketMessage,
  type PongServerSocketMessage,
} from '../types/socket-types.js';
import { actionLogger } from '../utils/action-logger.js';
import { getConfig } from '../utils/config.js';
import { ServerError, SocketTimeout, SocketOffline } from '../utils/errors.js';
import { promiseAll } from '../utils/promises.js';
import type { DispatchActionPromise } from '../utils/redux-promise-utils.js';
import sleep from '../utils/sleep.js';

const remainingTimeAfterVisualTimeout =
  clientRequestSocketTimeout - clientRequestVisualTimeout;

export type BaseSocketProps = {
  +keyserverID: string,
  +detectUnsupervisedBackgroundRef?: (
    detectUnsupervisedBackground: (alreadyClosed: boolean) => boolean,
  ) => void,
};
type Props = {
  ...BaseSocketProps,
  // Redux state
  +active: boolean,
  +openSocket: () => CommTransportLayer,
  +getClientResponses: (
    activeServerRequests: $ReadOnlyArray<ClientServerRequest>,
  ) => Promise<$ReadOnlyArray<ClientClientResponse>>,
  +activeThread: ?string,
  +sessionStateFunc: () => SessionState,
  +sessionIdentification: SessionIdentification,
  +cookie: ?string,
  +urlPrefix: string,
  +connection: ConnectionInfo,
  +currentCalendarQuery: () => CalendarQuery,
  +canSendReports: boolean,
  +frozen: boolean,
  +preRequestUserState: PreRequestUserState,
  +noDataAfterPolicyAcknowledgment?: boolean,
  +lastCommunicatedPlatformDetails: ?PlatformDetails,
  +decompressSocketMessage: CompressedData => string,
  // Redux dispatch functions
  +dispatch: Dispatch,
  +dispatchActionPromise: DispatchActionPromise,
  // async functions that hit server APIs
  +socketCrashLoopRecovery?: () => Promise<void>,
  // keyserver olm sessions specific props
  +getInitialNotificationsEncryptedMessage?: (
    keyserverID: string,
    options?: ?InitialNotifMessageOptions,
  ) => Promise<string>,
};
type State = {
  +inflightRequests: ?InflightRequests,
};
class Socket extends React.PureComponent<Props, State> {
  state: State = {
    inflightRequests: null,
  };
  socket: ?CommTransportLayer;
  nextClientMessageID: number = 0;
  listeners: Set<SocketListener> = new Set();
  pingTimeoutID: ?TimeoutID;
  messageLastReceived: ?number;
  reopenConnectionAfterClosing: boolean = false;
  invalidationRecoveryInProgress: boolean = false;
  initializedWithUserState: ?PreRequestUserState;
  failuresAfterPolicyAcknowledgment: number = 0;

  openSocket(newStatus: ConnectionStatus) {
    if (
      this.props.frozen ||
      !this.props.cookie ||
      !this.props.cookie.startsWith('user=')
    ) {
      return;
    }
    if (this.socket) {
      const { status } = this.props.connection;
      if (status === 'forcedDisconnecting') {
        this.reopenConnectionAfterClosing = true;
        return;
      } else if (status === 'disconnecting' && this.socket.readyState === 1) {
        this.markSocketInitialized();
        return;
      } else if (
        status === 'connected' ||
        status === 'connecting' ||
        status === 'reconnecting'
      ) {
        return;
      }
      if (this.socket.readyState < 2) {
        this.socket.close();
        console.log(`this.socket seems open, but Redux thinks it's ${status}`);
      }
    }
    this.props.dispatch({
      type: updateConnectionStatusActionType,
      payload: { status: newStatus, keyserverID: this.props.keyserverID },
    });

    const socket = this.props.openSocket();
    const openObject: { initializeMessageSent?: true } = {};
    socket.onopen = () => {
      if (this.socket === socket) {
        void this.initializeSocket();
        openObject.initializeMessageSent = true;
      }
    };
    socket.onmessage = this.receiveMessage;
    socket.onclose = () => {
      if (this.socket === socket) {
        this.onClose();
      }
    };
    this.socket = socket;

    void (async () => {
      await sleep(clientRequestVisualTimeout);
      if (this.socket !== socket || openObject.initializeMessageSent) {
        return;
      }
      this.setLateResponse(-1, true);
      await sleep(remainingTimeAfterVisualTimeout);
      if (this.socket !== socket || openObject.initializeMessageSent) {
        return;
      }
      this.finishClosingSocket();
    })();

    this.setState({
      inflightRequests: new InflightRequests({
        timeout: () => {
          if (this.socket === socket) {
            this.finishClosingSocket();
          }
        },
        setLateResponse: (messageID: number, isLate: boolean) => {
          if (this.socket === socket) {
            this.setLateResponse(messageID, isLate);
          }
        },
      }),
    });
  }

  markSocketInitialized() {
    this.props.dispatch({
      type: updateConnectionStatusActionType,
      payload: { status: 'connected', keyserverID: this.props.keyserverID },
    });
    this.resetPing();
  }

  closeSocket(
    // This param is a hack. When closing a socket there is a race between this
    // function and the one to propagate the activity update. We make sure that
    // the activity update wins the race by passing in this param.
    activityUpdatePending: boolean,
  ) {
    const { status } = this.props.connection;
    if (status === 'disconnected') {
      return;
    } else if (status === 'disconnecting' || status === 'forcedDisconnecting') {
      this.reopenConnectionAfterClosing = false;
      return;
    }
    this.stopPing();
    this.props.dispatch({
      type: updateConnectionStatusActionType,
      payload: { status: 'disconnecting', keyserverID: this.props.keyserverID },
    });
    if (!activityUpdatePending) {
      this.finishClosingSocket();
    }
  }

  forceCloseSocket() {
    this.stopPing();
    const { status } = this.props.connection;
    if (status !== 'forcedDisconnecting' && status !== 'disconnected') {
      this.props.dispatch({
        type: updateConnectionStatusActionType,
        payload: {
          status: 'forcedDisconnecting',
          keyserverID: this.props.keyserverID,
        },
      });
    }
    this.finishClosingSocket();
  }

  finishClosingSocket(receivedResponseTo?: ?number) {
    const { inflightRequests } = this.state;
    if (
      inflightRequests &&
      !inflightRequests.allRequestsResolvedExcept(receivedResponseTo)
    ) {
      return;
    }
    if (this.socket && this.socket.readyState < 2) {
      // If it's not closing already, close it
      this.socket.close();
    }
    this.socket = null;
    this.stopPing();
    this.setState({ inflightRequests: null });
    if (this.props.connection.status !== 'disconnected') {
      this.props.dispatch({
        type: updateConnectionStatusActionType,
        payload: {
          status: 'disconnected',
          keyserverID: this.props.keyserverID,
        },
      });
    }
    if (this.reopenConnectionAfterClosing) {
      this.reopenConnectionAfterClosing = false;
      if (this.props.active) {
        this.openSocket('connecting');
      }
    }
  }

  reconnect: $Call<typeof _throttle, () => void, number> = _throttle(
    () => this.openSocket('reconnecting'),
    2000,
  );

  componentDidMount() {
    if (this.props.detectUnsupervisedBackgroundRef) {
      this.props.detectUnsupervisedBackgroundRef(
        this.detectUnsupervisedBackground,
      );
    }
    if (this.props.active) {
      this.openSocket('connecting');
    }
  }

  componentWillUnmount() {
    this.closeSocket(false);
    this.reconnect.cancel();
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.active && !prevProps.active) {
      this.openSocket('connecting');
    } else if (!this.props.active && prevProps.active) {
      this.closeSocket(!!prevProps.activeThread);
    } else if (
      this.props.active &&
      prevProps.openSocket !== this.props.openSocket
    ) {
      // This case happens when the baseURL/urlPrefix is changed
      this.reopenConnectionAfterClosing = true;
      this.forceCloseSocket();
    } else if (
      this.props.active &&
      this.props.connection.status === 'disconnected' &&
      prevProps.connection.status !== 'disconnected' &&
      !this.invalidationRecoveryInProgress
    ) {
      this.reconnect();
    }
  }

  render(): React.Node {
    // It's important that APIRequestHandler get rendered first here. This is so
    // that it is registered with Redux first, so that its componentDidUpdate
    // processes before the other Handlers. This allows APIRequestHandler to
    // register itself with action-utils before other Handlers call
    // dispatchActionPromise in response to the componentDidUpdate triggered by
    // the same Redux change (state.connection.status).
    return (
      <React.Fragment>
        <APIRequestHandler
          inflightRequests={this.state.inflightRequests}
          sendMessage={this.sendMessageWithoutID}
          keyserverID={this.props.keyserverID}
        />
        <ActivityHandler
          activeThread={this.props.activeThread}
          frozen={this.props.frozen}
          keyserverID={this.props.keyserverID}
        />
        <RequestResponseHandler
          inflightRequests={this.state.inflightRequests}
          sendMessage={this.sendMessageWithoutID}
          addListener={this.addListener}
          removeListener={this.removeListener}
          getClientResponses={this.props.getClientResponses}
          currentCalendarQuery={this.props.currentCalendarQuery}
        />
        <UpdateHandler
          sendMessage={this.sendMessageWithoutID}
          addListener={this.addListener}
          removeListener={this.removeListener}
          keyserverID={this.props.keyserverID}
        />
        <MessageHandler
          addListener={this.addListener}
          removeListener={this.removeListener}
        />
        <CalendarQueryHandler
          currentCalendarQuery={this.props.currentCalendarQuery}
          frozen={this.props.frozen}
          keyserverID={this.props.keyserverID}
        />
        <ReportHandler canSendReports={this.props.canSendReports} />
      </React.Fragment>
    );
  }

  sendMessageWithoutID: (message: ClientSocketMessageWithoutID) => number =
    message => {
      const id = this.nextClientMessageID++;
      // These conditions all do the same thing and the runtime checks are only
      // necessary for Flow
      if (message.type === clientSocketMessageTypes.INITIAL) {
        this.sendMessage(
          ({ ...message, id }: ClientInitialClientSocketMessage),
        );
      } else if (message.type === clientSocketMessageTypes.RESPONSES) {
        this.sendMessage(
          ({ ...message, id }: ClientResponsesClientSocketMessage),
        );
      } else if (message.type === clientSocketMessageTypes.PING) {
        this.sendMessage(({ ...message, id }: PingClientSocketMessage));
      } else if (message.type === clientSocketMessageTypes.ACK_UPDATES) {
        this.sendMessage(({ ...message, id }: AckUpdatesClientSocketMessage));
      } else if (message.type === clientSocketMessageTypes.API_REQUEST) {
        this.sendMessage(({ ...message, id }: APIRequestClientSocketMessage));
      }
      return id;
    };

  sendMessage(message: ClientClientSocketMessage) {
    const socket = this.socket;
    invariant(socket, 'should be set');
    socket.send(JSON.stringify(message));
  }

  messageFromEvent(event: MessageEvent): ?ClientServerSocketMessage {
    if (typeof event.data !== 'string') {
      console.log('socket received a non-string message');
      return null;
    }

    let rawMessage;
    try {
      rawMessage = JSON.parse(event.data);
    } catch (e) {
      console.log(e);
      return null;
    }

    if (rawMessage.type !== serverSocketMessageTypes.COMPRESSED_MESSAGE) {
      return rawMessage;
    }

    const result = this.props.decompressSocketMessage(rawMessage.payload);
    try {
      return JSON.parse(result);
    } catch (e) {
      console.log(e);
      return null;
    }
  }

  receiveMessage: (event: MessageEvent) => Promise<void> = async event => {
    const message = this.messageFromEvent(event);
    if (!message) {
      return;
    }
    this.failuresAfterPolicyAcknowledgment = 0;

    const { inflightRequests } = this.state;
    if (!inflightRequests) {
      // inflightRequests can be falsey here if we receive a message after we've
      // begun shutting down the socket. It's possible for a React Native
      // WebSocket to deliver a message even after close() is called on it. In
      // this case the message is probably a PONG, which we can safely ignore.
      // If it's not a PONG, it has to be something server-initiated (like
      // UPDATES or MESSAGES), since InflightRequests.allRequestsResolvedExcept
      // will wait for all responses to client-initiated requests to be
      // delivered before closing a socket. UPDATES and MESSAGES are both
      // checkpointed on the client, so should be okay to just ignore here and
      // redownload them later, probably in an incremental STATE_SYNC.
      return;
    }

    // If we receive any message, that indicates that our connection is healthy,
    // so we can reset the ping timeout.
    this.resetPing();

    inflightRequests.resolveRequestsForMessage(message);
    const { status } = this.props.connection;
    if (status === 'disconnecting' || status === 'forcedDisconnecting') {
      this.finishClosingSocket(
        // We do this for Flow
        message.responseTo !== undefined ? message.responseTo : null,
      );
    }

    for (const listener of this.listeners) {
      listener(message);
    }

    if (message.type === serverSocketMessageTypes.ERROR) {
      const { message: errorMessage, payload } = message;
      if (payload) {
        console.log(`socket sent error ${errorMessage} with payload`, payload);
      } else {
        console.log(`socket sent error ${errorMessage}`);
      }
      if (errorMessage === 'policies_not_accepted' && this.props.active) {
        this.props.dispatch({
          type: forcePolicyAcknowledgmentActionType,
          payload,
        });
      }
    } else if (message.type === serverSocketMessageTypes.AUTH_ERROR) {
      const { sessionChange } = message;
      const cookie = sessionChange ? sessionChange.cookie : this.props.cookie;
      this.invalidationRecoveryInProgress = true;

      const recoverySessionChange = await resolveKeyserverSessionInvalidation(
        this.props.dispatch,
        cookie,
        this.props.urlPrefix,
        logInActionSources.socketAuthErrorResolutionAttempt,
        this.props.keyserverID,
        this.props.getInitialNotificationsEncryptedMessage,
      );

      if (!recoverySessionChange) {
        const { cookie: newerCookie, currentUserInfo } = sessionChange;
        this.props.dispatch({
          type: setNewSessionActionType,
          payload: {
            sessionChange: {
              cookieInvalidated: true,
              currentUserInfo,
              cookie: newerCookie,
            },
            preRequestUserState: this.initializedWithUserState,
            error: null,
            logInActionSource:
              logInActionSources.socketAuthErrorResolutionAttempt,
            keyserverID: this.props.keyserverID,
          },
        });
      }
      this.invalidationRecoveryInProgress = false;
    }
  };

  addListener: (listener: SocketListener) => void = listener => {
    this.listeners.add(listener);
  };

  removeListener: (listener: SocketListener) => void = listener => {
    this.listeners.delete(listener);
  };

  onClose: () => void = () => {
    const { status } = this.props.connection;
    this.socket = null;
    this.stopPing();
    if (this.state.inflightRequests) {
      this.state.inflightRequests.rejectAll(new Error('socket closed'));
      this.setState({ inflightRequests: null });
    }
    const handled = this.detectUnsupervisedBackground(true);
    if (!handled && status !== 'disconnected') {
      this.props.dispatch({
        type: updateConnectionStatusActionType,
        payload: {
          status: 'disconnected',
          keyserverID: this.props.keyserverID,
        },
      });
    }
  };

  async sendInitialMessage() {
    const { inflightRequests } = this.state;
    invariant(
      inflightRequests,
      'inflightRequests falsey inside sendInitialMessage',
    );
    const messageID = this.nextClientMessageID++;

    const shouldSendInitialPlatformDetails = !_isEqual(
      this.props.lastCommunicatedPlatformDetails,
    )(getConfig().platformDetails);

    const clientResponses: ClientClientResponse[] = [];
    if (shouldSendInitialPlatformDetails) {
      clientResponses.push({
        type: serverRequestTypes.PLATFORM_DETAILS,
        platformDetails: getConfig().platformDetails,
      });
    }

    let activityUpdatePromise;
    const { queuedActivityUpdates } = this.props.connection;
    if (queuedActivityUpdates.length > 0) {
      clientResponses.push({
        type: serverRequestTypes.INITIAL_ACTIVITY_UPDATES,
        activityUpdates: queuedActivityUpdates,
      });
      activityUpdatePromise =
        inflightRequests.fetchResponse<ActivityUpdateResponseServerSocketMessage>(
          messageID,
          serverSocketMessageTypes.ACTIVITY_UPDATE_RESPONSE,
        );
    }

    const sessionState = this.props.sessionStateFunc();
    const { sessionIdentification } = this.props;
    const initialMessage = {
      type: clientSocketMessageTypes.INITIAL,
      id: messageID,
      payload: {
        clientResponses,
        sessionState,
        sessionIdentification,
      },
    };
    this.initializedWithUserState = this.props.preRequestUserState;
    this.sendMessage(initialMessage);

    const stateSyncPromise =
      inflightRequests.fetchResponse<ClientStateSyncServerSocketMessage>(
        messageID,
        serverSocketMessageTypes.STATE_SYNC,
      );

    // https://flow.org/try/#1N4Igxg9gdgZglgcxALlAJwKYEMwBcD6aArlLnALYYrgA2WAzvXGCADQgYAeOBARgJ74AJhhhYiNXClzEM7DFCLl602QF92kEdQb8oYAAQwSeONAMAHNBHJx6GAII0aAHgAqyA8AMBqANoA1hj8nvQycFAIALqetpwYQgZqAHwAFAA6UAYGERZEuJ4AJABK2EIA8lA0-O7JrJkAlJ4ACta29i6F5bwAVgCyWBburAa4-BYYEDAGhVgA7lhwuMnJXpnZkFBhlm12GPQGALwGflEA3OsGm9tB-AfH3T0YeAB0t-SpufkNF1lGEGgDKkaBhcDkjgYAAxncEuAzvF4gyK4AAWMLgPh8DTWfw20BuwQh7z8cHOlzxWzBVhsewhX1wgWCZNxOxp9noLzy9BRqWp7QwP0uaku1zBmHoElw9wM80WYNabIwLywzl5u3Zgr+ooMAgAclhKJ5gH4wmgItFYnB4kI1BDgGpftkYACgSCwXAIdDYfDghykQhUejMdjgOSrviwbcib6Sczstk9QaMIz+FEIeLJfRY46kpdMLgiGgsonKL9hVBMrp9EYTGRzPYoEIAJJQJZwFV9fb0LAIDCpEOXN2jfa4BX8nNwaYZEAojDOCDpEAvMJYNBSgDqSx5i4Ci4aA5ZuBHY9pxxP9he4ogNAAbn2ZEQBTny5dZUtWfynDRUt4j2FzxgSSamobAgHeaBMNA1A3pCLwAEwAIwACwvJCIBqEAA
    // $FlowFixMe fixed in Flow 0.214
    const { stateSyncMessage, activityUpdateMessage } = await promiseAll({
      activityUpdateMessage: activityUpdatePromise,
      stateSyncMessage: stateSyncPromise,
    });

    if (shouldSendInitialPlatformDetails) {
      this.props.dispatch({
        type: updateLastCommunicatedPlatformDetailsActionType,
        payload: {
          platformDetails: getConfig().platformDetails,
          keyserverID: this.props.keyserverID,
        },
      });
    }

    if (activityUpdateMessage) {
      this.props.dispatch({
        type: updateActivityActionTypes.success,
        payload: {
          activityUpdates: { [this.props.keyserverID]: queuedActivityUpdates },
          result: activityUpdateMessage.payload,
        },
      });
    }

    if (stateSyncMessage.payload.type === stateSyncPayloadTypes.FULL) {
      const { sessionID, type, ...actionPayload } = stateSyncMessage.payload;
      this.props.dispatch({
        type: fullStateSyncActionType,
        payload: {
          ...actionPayload,
          calendarQuery: sessionState.calendarQuery,
          keyserverID: this.props.keyserverID,
        },
      });
      if (sessionID !== null && sessionID !== undefined) {
        invariant(
          this.initializedWithUserState,
          'initializedWithUserState should be set when state sync received',
        );
        this.props.dispatch({
          type: setNewSessionActionType,
          payload: {
            sessionChange: { cookieInvalidated: false, sessionID },
            preRequestUserState: this.initializedWithUserState,
            error: null,
            logInActionSource: undefined,
            keyserverID: this.props.keyserverID,
          },
        });
      }
    } else {
      const { type, ...actionPayload } = stateSyncMessage.payload;
      this.props.dispatch({
        type: incrementalStateSyncActionType,
        payload: {
          ...actionPayload,
          calendarQuery: sessionState.calendarQuery,
          keyserverID: this.props.keyserverID,
        },
      });
    }

    const currentAsOf =
      stateSyncMessage.payload.type === stateSyncPayloadTypes.FULL
        ? stateSyncMessage.payload.updatesCurrentAsOf
        : stateSyncMessage.payload.updatesResult.currentAsOf;
    this.sendMessageWithoutID({
      type: clientSocketMessageTypes.ACK_UPDATES,
      payload: { currentAsOf },
    });

    this.markSocketInitialized();
  }

  initializeSocket: (retriesLeft?: number) => Promise<void> = async (
    retriesLeft = 1,
  ) => {
    try {
      await this.sendInitialMessage();
    } catch (e) {
      if (this.props.noDataAfterPolicyAcknowledgment) {
        this.failuresAfterPolicyAcknowledgment++;
      } else {
        this.failuresAfterPolicyAcknowledgment = 0;
      }
      if (
        this.failuresAfterPolicyAcknowledgment >= 2 &&
        this.props.socketCrashLoopRecovery
      ) {
        this.failuresAfterPolicyAcknowledgment = 0;
        try {
          await this.props.socketCrashLoopRecovery();
        } catch (error) {
          console.log(error);
          this.props.dispatch({
            type: setConnectionIssueActionType,
            payload: {
              keyserverID: this.props.keyserverID,
              connectionIssue: 'policy_acknowledgement_socket_crash_loop',
            },
          });
        }
        return;
      }

      console.log(e);
      const { status } = this.props.connection;
      if (
        e instanceof SocketTimeout ||
        e instanceof SocketOffline ||
        (status !== 'connecting' && status !== 'reconnecting')
      ) {
        // This indicates that the socket will be closed. Do nothing, since the
        // connection status update will trigger a reconnect.
      } else if (
        retriesLeft === 0 ||
        (e instanceof ServerError && e.message !== 'unknown_error')
      ) {
        if (e.message === 'not_logged_in') {
          this.props.dispatch({
            type: setConnectionIssueActionType,
            payload: {
              keyserverID: this.props.keyserverID,
              connectionIssue: 'not_logged_in_error',
            },
          });
        } else if (this.socket) {
          this.socket.close();
        }
      } else {
        await this.initializeSocket(retriesLeft - 1);
      }
    }
  };

  stopPing() {
    if (this.pingTimeoutID) {
      clearTimeout(this.pingTimeoutID);
      this.pingTimeoutID = null;
    }
  }

  resetPing() {
    this.stopPing();
    const socket = this.socket;
    this.messageLastReceived = Date.now();
    this.pingTimeoutID = setTimeout(() => {
      if (this.socket === socket) {
        void this.sendPing();
      }
    }, pingFrequency);
  }

  async sendPing() {
    if (this.props.connection.status !== 'connected') {
      // This generally shouldn't happen because anything that changes the
      // connection status should call stopPing(), but it's good to make sure
      return;
    }
    const messageID = this.sendMessageWithoutID({
      type: clientSocketMessageTypes.PING,
    });
    try {
      invariant(
        this.state.inflightRequests,
        'inflightRequests falsey inside sendPing',
      );
      await this.state.inflightRequests.fetchResponse<PongServerSocketMessage>(
        messageID,
        serverSocketMessageTypes.PONG,
      );
    } catch (e) {}
  }

  setLateResponse: (messageID: number, isLate: boolean) => void = (
    messageID,
    isLate,
  ) => {
    this.props.dispatch({
      type: setLateResponseActionType,
      payload: { messageID, isLate, keyserverID: this.props.keyserverID },
    });
  };

  cleanUpServerTerminatedSocket() {
    if (this.socket && this.socket.readyState < 2) {
      this.socket.close();
    } else {
      this.onClose();
    }
  }

  detectUnsupervisedBackground: (alreadyClosed: boolean) => boolean =
    alreadyClosed => {
      // On native, sometimes the app is backgrounded without the proper
      // callbacks getting triggered. This leaves us in an incorrect state for
      // two reasons:
      // (1) The connection is still considered to be active, causing API
      //     requests to be processed via socket and failing.
      // (2) We rely on flipping foreground state in Redux to detect activity
      //     changes, and thus won't think we need to update activity.
      if (
        this.props.connection.status !== 'connected' ||
        !this.messageLastReceived ||
        this.messageLastReceived + serverRequestSocketTimeout >= Date.now() ||
        (actionLogger.mostRecentActionTime &&
          actionLogger.mostRecentActionTime + 3000 < Date.now())
      ) {
        return false;
      }
      if (!alreadyClosed) {
        this.cleanUpServerTerminatedSocket();
      }
      this.props.dispatch({
        type: unsupervisedBackgroundActionType,
        payload: { keyserverID: this.props.keyserverID },
      });
      return true;
    };
}

export default Socket;
