#pragma once

#include "../CryptoTools/CryptoModule.h"
#include "../Tools/CommSecureStore.h"
#include "../Tools/WorkerThread.h"
#include "../_generated/commJSI.h"
#include "PersistentStorageUtilities/DataStores/CommunityStore.h"
#include "PersistentStorageUtilities/DataStores/DraftStore.h"
#include "PersistentStorageUtilities/DataStores/KeyserverStore.h"
#include "PersistentStorageUtilities/DataStores/MessageStore.h"
#include "PersistentStorageUtilities/DataStores/ReportStore.h"
#include "PersistentStorageUtilities/DataStores/ThreadStore.h"
#include "PersistentStorageUtilities/DataStores/UserStore.h"
#include <ReactCommon/TurboModuleUtils.h>
#include <jsi/jsi.h>
#include <memory>
#include <string>

namespace comm {

namespace jsi = facebook::jsi;

class CommCoreModule : public facebook::react::CommCoreModuleSchemaCxxSpecJSI {
  const int codeVersion{324};
  std::unique_ptr<WorkerThread> cryptoThread;

  const std::string secureStoreAccountDataKey = "cryptoAccountDataKey";
  const std::string publicCryptoAccountID = "publicCryptoAccountID";
  std::unique_ptr<crypto::CryptoModule> cryptoModule;
  DraftStore draftStore;
  ThreadStore threadStore;
  MessageStore messageStore;
  ReportStore reportStore;
  UserStore userStore;
  KeyserverStore keyserverStore;
  CommunityStore communityStore;

  void persistCryptoModule();

  virtual jsi::Value getDraft(jsi::Runtime &rt, jsi::String key) override;
  virtual jsi::Value
  updateDraft(jsi::Runtime &rt, jsi::String key, jsi::String text) override;
  virtual jsi::Value
  moveDraft(jsi::Runtime &rt, jsi::String oldKey, jsi::String newKey) override;
  virtual jsi::Value getClientDBStore(jsi::Runtime &rt) override;
  virtual jsi::Value removeAllDrafts(jsi::Runtime &rt) override;
  virtual jsi::Array getAllMessagesSync(jsi::Runtime &rt) override;
  virtual jsi::Value
  processDraftStoreOperations(jsi::Runtime &rt, jsi::Array operations) override;
  virtual jsi::Value processReportStoreOperations(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual void processReportStoreOperationsSync(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual jsi::Value processMessageStoreOperations(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual void processMessageStoreOperationsSync(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual jsi::Array getAllThreadsSync(jsi::Runtime &rt) override;
  virtual jsi::Value processThreadStoreOperations(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual void processThreadStoreOperationsSync(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual jsi::Value
  processUserStoreOperations(jsi::Runtime &rt, jsi::Array operations) override;
  virtual jsi::Value processKeyserverStoreOperations(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual jsi::Value processCommunityStoreOperations(
      jsi::Runtime &rt,
      jsi::Array operations) override;
  virtual jsi::Value initializeCryptoAccount(jsi::Runtime &rt) override;
  virtual jsi::Value getUserPublicKey(jsi::Runtime &rt) override;
  virtual jsi::Value
  getOneTimeKeys(jsi::Runtime &rt, double oneTimeKeysAmount) override;
  virtual jsi::Value validateAndUploadPrekeys(
      jsi::Runtime &rt,
      jsi::String authUserID,
      jsi::String authDeviceID,
      jsi::String authAccessToken) override;
  virtual jsi::Value validateAndGetPrekeys(jsi::Runtime &rt) override;
  virtual jsi::Value initializeNotificationsSession(
      jsi::Runtime &rt,
      jsi::String identityKeys,
      jsi::String prekey,
      jsi::String prekeySignature,
      jsi::String oneTimeKeys,
      jsi::String keyserverID) override;
  virtual jsi::Value
  isNotificationsSessionInitialized(jsi::Runtime &rt) override;
  virtual jsi::Value initializeContentOutboundSession(
      jsi::Runtime &rt,
      jsi::String identityKeys,
      jsi::String prekey,
      jsi::String prekeySignature,
      jsi::String oneTimeKeys,
      jsi::String deviceID) override;
  virtual jsi::Value initializeContentInboundSession(
      jsi::Runtime &rt,
      jsi::String identityKeys,
      jsi::String encryptedMessage,
      jsi::String deviceID) override;
  virtual jsi::Value
  encrypt(jsi::Runtime &rt, jsi::String message, jsi::String deviceID) override;
  virtual jsi::Value
  decrypt(jsi::Runtime &rt, jsi::String message, jsi::String deviceID) override;
  virtual jsi::Value
  signMessage(jsi::Runtime &rt, jsi::String message) override;
  virtual void terminate(jsi::Runtime &rt) override;
  virtual double getCodeVersion(jsi::Runtime &rt) override;
  virtual jsi::Value
  setNotifyToken(jsi::Runtime &rt, jsi::String token) override;
  virtual jsi::Value clearNotifyToken(jsi::Runtime &rt) override;
  virtual jsi::Value
  setCurrentUserID(jsi::Runtime &rt, jsi::String userID) override;
  virtual jsi::Value getCurrentUserID(jsi::Runtime &rt) override;
  virtual jsi::Value clearSensitiveData(jsi::Runtime &rt) override;
  virtual bool checkIfDatabaseNeedsDeletion(jsi::Runtime &rt) override;
  virtual void reportDBOperationsFailure(jsi::Runtime &rt) override;
  virtual jsi::Value computeBackupKey(
      jsi::Runtime &rt,
      jsi::String password,
      jsi::String backupID) override;
  virtual jsi::Value
  generateRandomString(jsi::Runtime &rt, double size) override;
  virtual jsi::Value setCommServicesAuthMetadata(
      jsi::Runtime &rt,
      jsi::String userID,
      jsi::String deviceID,
      jsi::String accessToken) override;
  virtual jsi::Value getCommServicesAuthMetadata(jsi::Runtime &rt) override;
  virtual jsi::Value setCommServicesAccessToken(
      jsi::Runtime &rt,
      jsi::String accessToken) override;
  virtual jsi::Value clearCommServicesAccessToken(jsi::Runtime &rt) override;
  virtual void startBackupHandler(jsi::Runtime &rt) override;
  virtual void stopBackupHandler(jsi::Runtime &rt) override;
  virtual jsi::Value
  createNewBackup(jsi::Runtime &rt, jsi::String backupSecret) override;
  virtual jsi::Value
  restoreBackup(jsi::Runtime &rt, jsi::String backupSecret) override;

public:
  CommCoreModule(std::shared_ptr<facebook::react::CallInvoker> jsInvoker);
};

} // namespace comm
