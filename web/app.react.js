// @flow

import 'basscss/css/basscss.min.css';
import './theme.css';
import { config as faConfig } from '@fortawesome/fontawesome-svg-core';
import classnames from 'classnames';
import _isEqual from 'lodash/fp/isEqual.js';
import * as React from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { WagmiConfig } from 'wagmi';

import {
  fetchEntriesActionTypes,
  updateCalendarQueryActionTypes,
} from 'lib/actions/entry-actions.js';
import { ChatMentionContextProvider } from 'lib/components/chat-mention-provider.react.js';
import { EditUserAvatarProvider } from 'lib/components/edit-user-avatar-provider.react.js';
import {
  ModalProvider,
  useModalContext,
} from 'lib/components/modal-provider.react.js';
import { StaffContextProvider } from 'lib/components/staff-provider.react.js';
import { IdentitySearchProvider } from 'lib/identity-search/identity-search-context.js';
import {
  createLoadingStatusSelector,
  combineLoadingStatuses,
} from 'lib/selectors/loading-selectors.js';
import { isLoggedIn } from 'lib/selectors/user-selectors.js';
import { extractMajorDesktopVersion } from 'lib/shared/version-utils.js';
import { TunnelbrokerProvider } from 'lib/tunnelbroker/tunnelbroker-context.js';
import type { LoadingStatus } from 'lib/types/loading-types.js';
import type { WebNavInfo } from 'lib/types/nav-types.js';
import type { Dispatch } from 'lib/types/redux-types.js';
import { getConfig, registerConfig } from 'lib/utils/config.js';
import { useDispatch } from 'lib/utils/redux-utils.js';
import { infoFromURL } from 'lib/utils/url-utils.js';
import { AlchemyENSCacheProvider, wagmiConfig } from 'lib/utils/wagmi-utils.js';

import QrCodeLogin from './account/qr-code-login.react.js';
import AppThemeWrapper from './app-theme-wrapper.react.js';
import { authoritativeKeyserverID } from './authoritative-keyserver.js';
import WebEditThreadAvatarProvider from './avatars/web-edit-thread-avatar-provider.react.js';
import Calendar from './calendar/calendar.react.js';
import Chat from './chat/chat.react.js';
import { EditModalProvider } from './chat/edit-message-provider.js';
import { MemberListSidebarProvider } from './chat/member-list-sidebar/member-list-sidebar-provider.react.js';
import NavigationArrows from './components/navigation-arrows.react.js';
import { olmAPI } from './crypto/olm-api.js';
import { initOpaque } from './crypto/opaque-utils.js';
import { getDatabaseModule } from './database/database-module-provider.js';
import electron from './electron.js';
import InputStateContainer from './input/input-state-container.react.js';
import InviteLinkHandler from './invite-links/invite-link-handler.react.js';
import InviteLinksRefresher from './invite-links/invite-links-refresher.react.js';
import LoadingIndicator from './loading-indicator.react.js';
import { MenuProvider } from './menu-provider.react.js';
import UpdateModalHandler from './modals/update-modal.react.js';
import SettingsSwitcher from './navigation-panels/settings-switcher.react.js';
import Topbar from './navigation-panels/topbar.react.js';
import useBadgeHandler from './push-notif/badge-handler.react.js';
import { PushNotificationsHandler } from './push-notif/push-notifs-handler.js';
import { updateNavInfoActionType } from './redux/action-types.js';
import DisconnectedBar from './redux/disconnected-bar.js';
import FocusHandler from './redux/focus-handler.react.js';
import { KeyserverReachabilityHandler } from './redux/keyserver-reachability-handler.js';
import { persistConfig } from './redux/persist.js';
import PolicyAcknowledgmentHandler from './redux/policy-acknowledgment-handler.js';
import { useSelector } from './redux/redux-utils.js';
import VisibilityHandler from './redux/visibility-handler.react.js';
import history from './router-history.js';
import { MessageSearchStateProvider } from './search/message-search-state-provider.react.js';
import { createTunnelbrokerInitMessage } from './selectors/tunnelbroker-selectors.js';
import AccountSettings from './settings/account-settings.react.js';
import DangerZone from './settings/danger-zone.react.js';
import KeyserverSelectionList from './settings/keyserver-selection-list.react.js';
import CommunityPicker from './sidebar/community-picker.react.js';
import Splash from './splash/splash.react.js';
import './typography.css';
import css from './style.css';
import { TooltipProvider } from './tooltips/tooltip-provider.js';
import { canonicalURLFromReduxState, navInfoFromURL } from './url-utils.js';

void initOpaque();

// We want Webpack's css-loader and style-loader to handle the Fontawesome CSS,
// so we disable the autoAddCss logic and import the CSS file. Otherwise every
// icon flashes huge for a second before the CSS is loaded.
import '@fortawesome/fontawesome-svg-core/styles.css';

faConfig.autoAddCss = false;
const desktopDetails = electron?.version
  ? { majorDesktopVersion: extractMajorDesktopVersion(electron?.version) }
  : null;

registerConfig({
  // We can't securely cache credentials on web
  resolveKeyserverSessionInvalidationUsingNativeCredentials: null,
  setSessionIDOnRequest: true,
  // Never reset the calendar range
  calendarRangeInactivityLimit: null,
  platformDetails: {
    platform: electron?.platform ?? 'web',
    codeVersion: 72,
    stateVersion: persistConfig.version,
    ...desktopDetails,
  },
  authoritativeKeyserverID,
  olmAPI,
});

const versionBroadcast = new BroadcastChannel('comm_version');
versionBroadcast.postMessage(getConfig().platformDetails.codeVersion);
versionBroadcast.onmessage = (event: MessageEvent) => {
  if (event.data && event.data !== getConfig().platformDetails.codeVersion) {
    location.reload();
  }
};

// Start initializing the database immediately
void getDatabaseModule();

type BaseProps = {
  +location: {
    +pathname: string,
    ...
  },
};
type Props = {
  ...BaseProps,
  // Redux state
  +navInfo: WebNavInfo,
  +entriesLoadingStatus: LoadingStatus,
  +loggedIn: boolean,
  +activeThreadCurrentlyUnread: boolean,
  // Redux dispatch functions
  +dispatch: Dispatch,
  +modals: $ReadOnlyArray<React.Node>,
};

class App extends React.PureComponent<Props> {
  componentDidMount() {
    const {
      navInfo,
      location: { pathname },
      loggedIn,
    } = this.props;
    const newURL = canonicalURLFromReduxState(navInfo, pathname, loggedIn);
    if (pathname !== newURL) {
      history.replace(newURL);
    }
  }

  componentDidUpdate(prevProps: Props) {
    const {
      navInfo,
      location: { pathname },
      loggedIn,
    } = this.props;
    if (!_isEqual(navInfo)(prevProps.navInfo)) {
      const newURL = canonicalURLFromReduxState(navInfo, pathname, loggedIn);
      if (newURL !== pathname) {
        history.push(newURL);
      }
    } else if (pathname !== prevProps.location.pathname) {
      const urlInfo = infoFromURL(pathname);
      const newNavInfo = navInfoFromURL(urlInfo, { navInfo });
      if (!_isEqual(newNavInfo)(navInfo)) {
        this.props.dispatch({
          type: updateNavInfoActionType,
          payload: newNavInfo,
        });
      }
    } else if (loggedIn !== prevProps.loggedIn) {
      const newURL = canonicalURLFromReduxState(navInfo, pathname, loggedIn);
      if (newURL !== pathname) {
        history.replace(newURL);
      }
    }
    if (loggedIn !== prevProps.loggedIn) {
      electron?.clearHistory();
    }
  }

  onWordmarkClicked = () => {
    this.props.dispatch({
      type: updateNavInfoActionType,
      payload: { tab: 'chat' },
    });
  };

  render(): React.Node {
    let content;
    if (this.props.loggedIn) {
      content = (
        <>
          <WebEditThreadAvatarProvider>
            <EditUserAvatarProvider>
              <StaffContextProvider>
                <MemberListSidebarProvider>
                  {this.renderMainContent()}
                  {this.props.modals}
                </MemberListSidebarProvider>
              </StaffContextProvider>
            </EditUserAvatarProvider>
          </WebEditThreadAvatarProvider>
        </>
      );
    } else {
      content = (
        <>
          {this.renderLoginPage()}
          {this.props.modals}
        </>
      );
    }
    return (
      <DndProvider backend={HTML5Backend}>
        <EditModalProvider>
          <MenuProvider>
            <WagmiConfig config={wagmiConfig}>
              <AlchemyENSCacheProvider>
                <TooltipProvider>
                  <MessageSearchStateProvider>
                    <ChatMentionContextProvider>
                      <FocusHandler />
                      <VisibilityHandler />
                      <PolicyAcknowledgmentHandler />
                      <PushNotificationsHandler />
                      <InviteLinkHandler />
                      <InviteLinksRefresher />
                      {content}
                    </ChatMentionContextProvider>
                  </MessageSearchStateProvider>
                </TooltipProvider>
              </AlchemyENSCacheProvider>
            </WagmiConfig>
          </MenuProvider>
        </EditModalProvider>
      </DndProvider>
    );
  }

  onHeaderDoubleClick = (): void => electron?.doubleClickTopBar();
  stopDoubleClickPropagation: ?(SyntheticEvent<HTMLAnchorElement>) => void =
    electron ? e => e.stopPropagation() : null;

  renderLoginPage(): React.Node {
    const { loginMethod } = this.props.navInfo;

    if (loginMethod === 'qr-code') {
      return <QrCodeLogin />;
    }

    return <Splash />;
  }

  renderMainContent(): React.Node {
    const mainContent = this.getMainContentWithSwitcher();

    let navigationArrows = null;
    if (electron) {
      navigationArrows = <NavigationArrows />;
    }

    const headerClasses = classnames({
      [css.header]: true,
      [css['electron-draggable']]: electron,
    });

    const wordmarkClasses = classnames({
      [css.wordmark]: true,
      [css['electron-non-draggable']]: electron,
      [css['wordmark-macos']]: electron?.platform === 'macos',
    });

    return (
      <div className={css.layout}>
        <KeyserverReachabilityHandler />
        <DisconnectedBar />
        <UpdateModalHandler />
        <header
          className={headerClasses}
          onDoubleClick={this.onHeaderDoubleClick}
        >
          <div className={css['main-header']}>
            <h1 className={wordmarkClasses}>
              <a
                title="Comm Home"
                aria-label="Go to Comm Home"
                onClick={this.onWordmarkClicked}
                onDoubleClick={this.stopDoubleClickPropagation}
              >
                Comm
              </a>
            </h1>
            {navigationArrows}
            <div className={css['upper-right']}>
              <LoadingIndicator
                status={this.props.entriesLoadingStatus}
                size="medium"
                loadingClassName={css['page-loading']}
                errorClassName={css['page-error']}
              />
            </div>
          </div>
        </header>
        <InputStateContainer>{mainContent}</InputStateContainer>
        <div className={css.sidebar}>
          <CommunityPicker />
        </div>
      </div>
    );
  }

  getMainContentWithSwitcher(): React.Node {
    const { tab, settingsSection } = this.props.navInfo;
    let mainContent: React.Node;

    if (tab === 'settings') {
      if (settingsSection === 'account') {
        mainContent = <AccountSettings />;
      } else if (settingsSection === 'friend-list') {
        mainContent = null;
      } else if (settingsSection === 'block-list') {
        mainContent = null;
      } else if (settingsSection === 'keyservers') {
        mainContent = <KeyserverSelectionList />;
      } else if (settingsSection === 'build-info') {
        mainContent = null;
      } else if (settingsSection === 'danger-zone') {
        mainContent = <DangerZone />;
      }
      return (
        <div className={css['main-content-container']}>
          <div className={css.switcher}>
            <SettingsSwitcher />
          </div>
          <div className={css['main-content']}>{mainContent}</div>
        </div>
      );
    }

    if (tab === 'calendar') {
      mainContent = <Calendar url={this.props.location.pathname} />;
    } else if (tab === 'chat') {
      mainContent = <Chat />;
    }

    const mainContentClass = classnames(
      css['main-content-container'],
      css['main-content-container-column'],
    );
    return (
      <div className={mainContentClass}>
        <Topbar />
        <div className={css['main-content']}>{mainContent}</div>
      </div>
    );
  }
}

const fetchEntriesLoadingStatusSelector = createLoadingStatusSelector(
  fetchEntriesActionTypes,
);
const updateCalendarQueryLoadingStatusSelector = createLoadingStatusSelector(
  updateCalendarQueryActionTypes,
);

const ConnectedApp: React.ComponentType<BaseProps> = React.memo<BaseProps>(
  function ConnectedApp(props) {
    const activeChatThreadID = useSelector(
      state => state.navInfo.activeChatThreadID,
    );
    const navInfo = useSelector(state => state.navInfo);

    const fetchEntriesLoadingStatus = useSelector(
      fetchEntriesLoadingStatusSelector,
    );
    const updateCalendarQueryLoadingStatus = useSelector(
      updateCalendarQueryLoadingStatusSelector,
    );
    const entriesLoadingStatus = combineLoadingStatuses(
      fetchEntriesLoadingStatus,
      updateCalendarQueryLoadingStatus,
    );

    const loggedIn = useSelector(isLoggedIn);
    const activeThreadCurrentlyUnread = useSelector(
      state =>
        !activeChatThreadID ||
        !!state.threadStore.threadInfos[activeChatThreadID]?.currentUser.unread,
    );

    useBadgeHandler();

    const dispatch = useDispatch();
    const modalContext = useModalContext();
    const modals = React.useMemo(
      () =>
        modalContext.modals.map(([modal, key]) => (
          <React.Fragment key={key}>{modal}</React.Fragment>
        )),
      [modalContext.modals],
    );

    const tunnelbrokerInitMessage = useSelector(createTunnelbrokerInitMessage);

    return (
      <AppThemeWrapper>
        <TunnelbrokerProvider initMessage={tunnelbrokerInitMessage}>
          <IdentitySearchProvider>
            <App
              {...props}
              navInfo={navInfo}
              entriesLoadingStatus={entriesLoadingStatus}
              loggedIn={loggedIn}
              activeThreadCurrentlyUnread={activeThreadCurrentlyUnread}
              dispatch={dispatch}
              modals={modals}
            />
          </IdentitySearchProvider>
        </TunnelbrokerProvider>
      </AppThemeWrapper>
    );
  },
);

function AppWithProvider(props: BaseProps): React.Node {
  return (
    <ModalProvider>
      <ConnectedApp {...props} />
    </ModalProvider>
  );
}

export default AppWithProvider;
