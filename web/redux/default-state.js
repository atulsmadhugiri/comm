// @flow

import { defaultWebEnabledApps } from 'lib/types/enabled-apps.js';
import { defaultCalendarFilters } from 'lib/types/filter-types.js';
import { defaultKeyserverInfo } from 'lib/types/keyserver-types.js';
import { defaultGlobalThemeInfo } from 'lib/types/theme-types.js';
import { defaultNotifPermissionAlertInfo } from 'lib/utils/push-alerts.js';

import type { AppState } from './redux-setup.js';
import { authoritativeKeyserverID } from '../authoritative-keyserver.js';
import electron from '../electron.js';

declare var keyserverURL: string;

const defaultWebState: AppState = Object.freeze({
  navInfo: {
    activeChatThreadID: null,
    startDate: '',
    endDate: '',
    tab: 'chat',
  },
  currentUserInfo: null,
  draftStore: { drafts: {} },
  entryStore: {
    entryInfos: {},
    daysToEntries: {},
    lastUserInteractionCalendar: 0,
  },
  threadStore: {
    threadInfos: {},
  },
  userStore: {
    userInfos: {},
  },
  messageStore: {
    messages: {},
    threads: {},
    local: {},
    currentAsOf: { [authoritativeKeyserverID]: 0 },
  },
  windowActive: true,
  pushApiPublicKey: null,
  cryptoStore: null,
  windowDimensions: { width: window.width, height: window.height },
  loadingStatuses: {},
  calendarFilters: defaultCalendarFilters,
  dataLoaded: false,
  notifPermissionAlertInfo: defaultNotifPermissionAlertInfo,
  watchedThreadIDs: [],
  lifecycleState: 'active',
  enabledApps: defaultWebEnabledApps,
  reportStore: {
    enabledReports: {
      crashReports: false,
      inconsistencyReports: false,
      mediaReports: false,
    },
    queuedReports: [],
  },
  nextLocalID: 0,
  _persist: null,
  userPolicies: {},
  commServicesAccessToken: null,
  inviteLinksStore: {
    links: {},
  },
  communityPickerStore: { chat: null, calendar: null },
  keyserverStore: {
    keyserverInfos: {
      [authoritativeKeyserverID]: defaultKeyserverInfo(
        keyserverURL,
        electron?.platform ?? 'web',
      ),
    },
  },
  threadActivityStore: {},
  initialStateLoaded: false,
  integrityStore: { threadHashes: {}, threadHashingStatus: 'starting' },
  globalThemeInfo: defaultGlobalThemeInfo,
  customServer: null,
});

export { defaultWebState };
