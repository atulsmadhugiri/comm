// @flow

import storage from 'redux-persist/es/storage/index.js';

import { getDatabaseModule } from '../database/database-module-provider.js';
import { workerRequestMessageTypes } from '../types/worker-types.js';

const commReduxStorageEngine = {
  getItem: async (key: string): Promise<string> => {
    const databaseModule = await getDatabaseModule();
    const isSupported = await databaseModule.isDatabaseSupported();
    if (!isSupported) {
      return await storage.getItem(key);
    }

    const result = await databaseModule.schedule({
      type: workerRequestMessageTypes.GET_PERSIST_STORAGE_ITEM,
      key,
    });
    if (!result || typeof result.item !== 'string') {
      throw new Error('Wrong type returned for storage item');
    }
    return result.item;
  },
  setItem: async (key: string, item: string): Promise<void> => {
    const databaseModule = await getDatabaseModule();
    const isSupported = await databaseModule.isDatabaseSupported();
    if (!isSupported) {
      await storage.setItem(key, item);
      return;
    }

    await databaseModule.schedule({
      type: workerRequestMessageTypes.SET_PERSIST_STORAGE_ITEM,
      key,
      item,
    });
  },
  removeItem: async (key: string): Promise<void> => {
    const databaseModule = await getDatabaseModule();
    const isSupported = await databaseModule.isDatabaseSupported();
    if (!isSupported) {
      await storage.removeItem(key);
      return;
    }

    await databaseModule.schedule({
      type: workerRequestMessageTypes.REMOVE_PERSIST_STORAGE_ITEM,
      key,
    });
  },
};

export default commReduxStorageEngine;
