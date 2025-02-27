// @flow

import type { Orientations } from 'react-native-orientation-locker';
import type { PersistState } from 'redux-persist/es/types.js';

import type { DraftStore } from 'lib/types/draft-types.js';
import type { EnabledApps } from 'lib/types/enabled-apps.js';
import type { EntryStore } from 'lib/types/entry-types.js';
import type { CalendarFilter } from 'lib/types/filter-types.js';
import type { IntegrityStore } from 'lib/types/integrity-types.js';
import type { KeyserverStore } from 'lib/types/keyserver-types.js';
import type { LifecycleState } from 'lib/types/lifecycle-state-types.js';
import type { InviteLinksStore } from 'lib/types/link-types.js';
import type { LoadingStatus } from 'lib/types/loading-types.js';
import type { MessageStore } from 'lib/types/message-types.js';
import type { UserPolicies } from 'lib/types/policy-types.js';
import type { ReportStore } from 'lib/types/report-types.js';
import type { GlobalThemeInfo } from 'lib/types/theme-types.js';
import type { ThreadActivityStore } from 'lib/types/thread-activity-types';
import type { ThreadStore } from 'lib/types/thread-types.js';
import type { CurrentUserInfo, UserStore } from 'lib/types/user-types.js';
import type { NotifPermissionAlertInfo } from 'lib/utils/push-alerts.js';

import type { DimensionsInfo } from './dimensions-updater.react.js';
import type { NavInfo } from '../navigation/default-state.js';
import type { DeviceCameraInfo } from '../types/camera.js';
import type { ConnectivityInfo } from '../types/connectivity.js';
import type { LocalSettings } from '../types/local-settings-types.js';

const nonUserSpecificFieldsNative = [
  'storeLoaded',
  'loadingStatuses',
  'customServer',
  'lifecycleState',
  'nextLocalID',
  'dimensions',
  'connectivity',
  'deviceCameraInfo',
  'deviceOrientation',
  'frozen',
  'keyserverStore',
  '_persist',
];

export type AppState = {
  +navInfo: NavInfo,
  +currentUserInfo: ?CurrentUserInfo,
  +draftStore: DraftStore,
  +entryStore: EntryStore,
  +threadStore: ThreadStore,
  +userStore: UserStore,
  +messageStore: MessageStore,
  +storeLoaded: boolean,
  +loadingStatuses: { [key: string]: { [idx: number]: LoadingStatus } },
  +calendarFilters: $ReadOnlyArray<CalendarFilter>,
  +dataLoaded: boolean,
  +customServer: ?string,
  +notifPermissionAlertInfo: NotifPermissionAlertInfo,
  +watchedThreadIDs: $ReadOnlyArray<string>,
  +lifecycleState: LifecycleState,
  +enabledApps: EnabledApps,
  +reportStore: ReportStore,
  +nextLocalID: number,
  +_persist: ?PersistState,
  +dimensions: DimensionsInfo,
  +connectivity: ConnectivityInfo,
  +globalThemeInfo: GlobalThemeInfo,
  +deviceCameraInfo: DeviceCameraInfo,
  +deviceOrientation: Orientations,
  +frozen: boolean,
  +userPolicies: UserPolicies,
  +commServicesAccessToken: ?string,
  +inviteLinksStore: InviteLinksStore,
  +keyserverStore: KeyserverStore,
  +threadActivityStore: ThreadActivityStore,
  +localSettings: LocalSettings,
  +integrityStore: IntegrityStore,
};

export { nonUserSpecificFieldsNative };
