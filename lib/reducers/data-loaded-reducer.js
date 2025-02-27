// @flow

import { setDataLoadedActionType } from '../actions/client-db-store-actions.js';
import {
  keyserverAuthActionTypes,
  logOutActionTypes,
  logInActionTypes,
} from '../actions/user-actions.js';
import { setNewSessionActionType } from '../keyserver-conn/keyserver-conn-types.js';
import type { BaseAction } from '../types/redux-types.js';
import { authoritativeKeyserverID } from '../utils/authoritative-keyserver.js';
import { usingCommServicesAccessToken } from '../utils/services-utils.js';

export default function reduceDataLoaded(
  state: boolean,
  action: BaseAction,
): boolean {
  if (action.type === setDataLoadedActionType) {
    return action.payload.dataLoaded;
  } else if (action.type === logInActionTypes.success) {
    return true;
  } else if (
    action.type === setNewSessionActionType &&
    action.payload.sessionChange.currentUserInfo &&
    action.payload.sessionChange.currentUserInfo.anonymous &&
    !usingCommServicesAccessToken
  ) {
    return false;
  } else if (action.type === logOutActionTypes.started) {
    return false;
  } else if (action.type === keyserverAuthActionTypes.success) {
    if (authoritativeKeyserverID() in action.payload.updatesCurrentAsOf) {
      return true;
    }
  }
  return state;
}
