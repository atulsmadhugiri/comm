#include "NotificationsCryptoModule.h"
#include "../../CryptoTools/Persist.h"
#include "../../CryptoTools/Tools.h"
#include "../../Tools/CommSecureStore.h"
#include "../../Tools/PlatformSpecificTools.h"

#include <fcntl.h>
#include <folly/String.h>
#include <folly/dynamic.h>
#include <folly/json.h>
#include <unistd.h>
#include <fstream>
#include <memory>
#include <sstream>

namespace comm {

const std::string
    NotificationsCryptoModule::secureStoreNotificationsAccountDataKey =
        "notificationsCryptoAccountDataKey";
const std::string NotificationsCryptoModule::notificationsCryptoAccountID =
    "notificationsCryptoAccountDataID";
const std::string NotificationsCryptoModule::keyserverHostedNotificationsID =
    "keyserverHostedNotificationsID";
const std::string NotificationsCryptoModule::initialEncryptedMessageContent =
    "{\"type\": \"init\"}";
const int NotificationsCryptoModule::olmEncryptedTypeMessage = 1;
const int temporaryFilePathRandomSuffixLength = 32;

std::unique_ptr<crypto::CryptoModule>
NotificationsCryptoModule::deserializeCryptoModule(
    const std::string &path,
    const std::string &picklingKey) {
  std::ifstream pickledPersistStream(path, std::ifstream::in);
  if (!pickledPersistStream.good()) {
    throw std::runtime_error(
        "Attempt to deserialize non-existing notifications crypto account");
  }
  std::stringstream pickledPersistStringStream;
  pickledPersistStringStream << pickledPersistStream.rdbuf();
  pickledPersistStream.close();
  std::string pickledPersist = pickledPersistStringStream.str();

  folly::dynamic persistJSON;
  try {
    persistJSON = folly::parseJson(pickledPersist);
  } catch (const folly::json::parse_error &e) {
    throw std::runtime_error(
        "Notifications crypto account JSON deserialization failed with "
        "reason: " +
        std::string(e.what()));
  }

  std::string accountString = persistJSON["account"].asString();
  crypto::OlmBuffer account =
      std::vector<uint8_t>(accountString.begin(), accountString.end());
  std::unordered_map<std::string, crypto::OlmBuffer> sessions;

  if (persistJSON["sessions"].isNull()) {
    return std::make_unique<crypto::CryptoModule>(
        notificationsCryptoAccountID,
        picklingKey,
        crypto::Persist({account, sessions}));
  }
  for (auto &sessionKeyValuePair : persistJSON["sessions"].items()) {
    std::string targetUserID = sessionKeyValuePair.first.asString();
    std::string sessionData = sessionKeyValuePair.second.asString();
    sessions[targetUserID] =
        std::vector<uint8_t>(sessionData.begin(), sessionData.end());
  }
  return std::make_unique<crypto::CryptoModule>(
      notificationsCryptoAccountID,
      picklingKey,
      crypto::Persist({account, sessions}));
}

void NotificationsCryptoModule::serializeAndFlushCryptoModule(
    std::unique_ptr<crypto::CryptoModule> cryptoModule,
    const std::string &path,
    const std::string &picklingKey,
    const std::string &callingProcessName) {
  crypto::Persist persist = cryptoModule->storeAsB64(picklingKey);

  folly::dynamic sessions = folly::dynamic::object;
  for (auto &sessionKeyValuePair : persist.sessions) {
    std::string targetUserID = sessionKeyValuePair.first;
    crypto::OlmBuffer sessionData = sessionKeyValuePair.second;
    sessions[targetUserID] =
        std::string(sessionData.begin(), sessionData.end());
  }

  std::string account =
      std::string(persist.account.begin(), persist.account.end());
  folly::dynamic persistJSON =
      folly::dynamic::object("account", account)("sessions", sessions);
  std::string pickledPersist = folly::toJson(persistJSON);

  std::string temporaryFilePathRandomSuffix =
      crypto::Tools::generateRandomHexString(
          temporaryFilePathRandomSuffixLength);
  std::string temporaryPath =
      path + callingProcessName + temporaryFilePathRandomSuffix;

  mode_t readWritePermissionsMode = 0666;
  int temporaryFD =
      open(temporaryPath.c_str(), O_CREAT | O_WRONLY, readWritePermissionsMode);
  if (temporaryFD == -1) {
    throw std::runtime_error(
        "Failed to create temporary file. Unable to atomically update "
        "notifications crypto account. Details: " +
        std::string(strerror(errno)));
  }
  ssize_t bytesWritten =
      write(temporaryFD, pickledPersist.c_str(), pickledPersist.length());
  if (bytesWritten == -1 || bytesWritten != pickledPersist.length()) {
    remove(temporaryPath.c_str());
    throw std::runtime_error(
        "Failed to write all data to temporary file. Unable to atomically "
        "update notifications crypto account. Details: " +
        std::string(strerror(errno)));
  }
  if (fsync(temporaryFD) == -1) {
    remove(temporaryPath.c_str());
    throw std::runtime_error(
        "Failed to synchronize temporary file data with hardware storage. "
        "Unable to atomically update notifications crypto account. Details: " +
        std::string(strerror(errno)));
  };
  close(temporaryFD);
  if (rename(temporaryPath.c_str(), path.c_str()) == -1) {
    remove(temporaryPath.c_str());
    throw std::runtime_error(
        "Failed to replace temporary file content with notifications crypto "
        "account. Unable to atomically update notifications crypto account. "
        "Details: " +
        std::string(strerror(errno)));
  }
  remove(temporaryPath.c_str());
}

std::string NotificationsCryptoModule::getPicklingKey() {
  folly::Optional<std::string> picklingKey = CommSecureStore::get(
      NotificationsCryptoModule::secureStoreNotificationsAccountDataKey);
  if (!picklingKey.hasValue()) {
    throw std::runtime_error(
        "Attempt to retrieve notifications crypto account before it was "
        "correctly initialized.");
  }
  return picklingKey.value();
}

void NotificationsCryptoModule::callCryptoModule(
    std::function<
        void(const std::unique_ptr<crypto::CryptoModule> &cryptoModule)> caller,
    const std::string &callingProcessName) {
  const std::string picklingKey = NotificationsCryptoModule::getPicklingKey();
  const std::string path =
      PlatformSpecificTools::getNotificationsCryptoAccountPath();
  std::unique_ptr<crypto::CryptoModule> cryptoModule =
      NotificationsCryptoModule::deserializeCryptoModule(path, picklingKey);
  caller(cryptoModule);
  NotificationsCryptoModule::serializeAndFlushCryptoModule(
      std::move(cryptoModule), path, picklingKey, callingProcessName);
}

void NotificationsCryptoModule::initializeNotificationsCryptoAccount(
    const std::string &callingProcessName) {
  const std::string notificationsCryptoAccountPath =
      PlatformSpecificTools::getNotificationsCryptoAccountPath();
  std::ifstream notificationCryptoAccountCheck(notificationsCryptoAccountPath);
  if (notificationCryptoAccountCheck.good()) {
    // Implemented in CommmCoreModule semantics regarding public olm account
    // initialization is idempotent. We should follow the same approach when it
    // comes to notifications
    notificationCryptoAccountCheck.close();
    return;
  }
  // There is no reason to check if the key is already present since if we are
  // in this place in the code we are about to create new account
  std::string picklingKey = crypto::Tools::generateRandomString(64);
  CommSecureStore::set(
      NotificationsCryptoModule::secureStoreNotificationsAccountDataKey,
      picklingKey);

  std::unique_ptr<crypto::CryptoModule> cryptoModule =
      std::make_unique<crypto::CryptoModule>(
          NotificationsCryptoModule::notificationsCryptoAccountID);
  NotificationsCryptoModule::serializeAndFlushCryptoModule(
      std::move(cryptoModule),
      notificationsCryptoAccountPath,
      picklingKey,
      callingProcessName);
}

std::string NotificationsCryptoModule::getNotificationsIdentityKeys(
    const std::string &callingProcessName) {
  std::string identityKeys;
  auto caller = [&identityKeys](
                    const std::unique_ptr<crypto::CryptoModule> &cryptoModule) {
    identityKeys = cryptoModule->getIdentityKeys();
  };
  NotificationsCryptoModule::callCryptoModule(caller, callingProcessName);
  return identityKeys;
}

std::string NotificationsCryptoModule::getNotificationsPrekey(
    const std::string &callingProcessName) {
  std::string prekey;
  auto caller =
      [&prekey](const std::unique_ptr<crypto::CryptoModule> &cryptoModule) {
        prekey = cryptoModule->getPrekey();
      };
  NotificationsCryptoModule::callCryptoModule(caller, callingProcessName);
  return prekey;
}

std::string NotificationsCryptoModule::getNotificationsPrekeySignature(
    const std::string &callingProcessName) {
  std::string prekeySignature;
  auto caller = [&prekeySignature](
                    const std::unique_ptr<crypto::CryptoModule> &cryptoModule) {
    prekeySignature = cryptoModule->getPrekeySignature();
  };
  NotificationsCryptoModule::callCryptoModule(caller, callingProcessName);
  return prekeySignature;
}

std::string NotificationsCryptoModule::getNotificationsOneTimeKeysForPublishing(
    const size_t oneTimeKeysAmount,
    const std::string &callingProcessName) {
  std::string oneTimeKeys;
  auto caller = [&oneTimeKeys, oneTimeKeysAmount](
                    const std::unique_ptr<crypto::CryptoModule> &cryptoModule) {
    oneTimeKeys = cryptoModule->getOneTimeKeysForPublishing(oneTimeKeysAmount);
  };
  NotificationsCryptoModule::callCryptoModule(caller, callingProcessName);
  return oneTimeKeys;
}

crypto::EncryptedData NotificationsCryptoModule::initializeNotificationsSession(
    const std::string &identityKeys,
    const std::string &prekey,
    const std::string &prekeySignature,
    const std::string &oneTimeKey,
    const std::string &callingProcessName) {
  crypto::EncryptedData initialEncryptedMessage;
  auto caller = [&](const std::unique_ptr<crypto::CryptoModule> &cryptoModule) {
    cryptoModule->initializeOutboundForSendingSession(
        NotificationsCryptoModule::keyserverHostedNotificationsID,
        std::vector<uint8_t>(identityKeys.begin(), identityKeys.end()),
        std::vector<uint8_t>(prekey.begin(), prekey.end()),
        std::vector<uint8_t>(prekeySignature.begin(), prekeySignature.end()),
        std::vector<uint8_t>(oneTimeKey.begin(), oneTimeKey.end()));
    initialEncryptedMessage = cryptoModule->encrypt(
        NotificationsCryptoModule::keyserverHostedNotificationsID,
        NotificationsCryptoModule::initialEncryptedMessageContent);
  };
  NotificationsCryptoModule::callCryptoModule(caller, callingProcessName);
  return initialEncryptedMessage;
}

bool NotificationsCryptoModule::isNotificationsSessionInitialized(
    const std::string &callingProcessName) {
  bool sessionInitialized;
  auto caller = [&sessionInitialized](
                    const std::unique_ptr<crypto::CryptoModule> &cryptoModule) {
    sessionInitialized = cryptoModule->hasSessionFor(
        NotificationsCryptoModule::keyserverHostedNotificationsID);
  };
  NotificationsCryptoModule::callCryptoModule(caller, callingProcessName);
  return sessionInitialized;
}

void NotificationsCryptoModule::clearSensitiveData() {
  std::string notificationsCryptoAccountPath =
      PlatformSpecificTools::getNotificationsCryptoAccountPath();
  if (remove(notificationsCryptoAccountPath.c_str()) == -1 && errno != ENOENT) {
    throw std::runtime_error(
        "Unable to remove notifications crypto account. Security requirements "
        "might be violated.");
  }
}

std::string NotificationsCryptoModule::decrypt(
    const std::string &data,
    const size_t messageType,
    const std::string &callingProcessName) {
  std::string decryptedData;
  auto caller = [&](const std::unique_ptr<crypto::CryptoModule> &cryptoModule) {
    crypto::EncryptedData encryptedData{
        std::vector<uint8_t>(data.begin(), data.end()), messageType};
    decryptedData = cryptoModule->decrypt(
        NotificationsCryptoModule::keyserverHostedNotificationsID,
        encryptedData);
  };
  NotificationsCryptoModule::callCryptoModule(caller, callingProcessName);
  return decryptedData;
}

NotificationsCryptoModule::StatefulDecryptResult::StatefulDecryptResult(
    std::unique_ptr<crypto::CryptoModule> cryptoModule,
    std::string decryptedData)
    : cryptoModuleState(std::move(cryptoModule)), decryptedData(decryptedData) {
}

std::string
NotificationsCryptoModule::StatefulDecryptResult::getDecryptedData() {
  return this->decryptedData;
}

std::unique_ptr<NotificationsCryptoModule::StatefulDecryptResult>
NotificationsCryptoModule::statefulDecrypt(
    const std::string &data,
    const size_t messageType) {
  std::string path = PlatformSpecificTools::getNotificationsCryptoAccountPath();
  std::string picklingKey = NotificationsCryptoModule::getPicklingKey();

  std::unique_ptr<crypto::CryptoModule> cryptoModule =
      NotificationsCryptoModule::deserializeCryptoModule(path, picklingKey);
  crypto::EncryptedData encryptedData{
      std::vector<uint8_t>(data.begin(), data.end()), messageType};
  std::string decryptedData = cryptoModule->decrypt(
      NotificationsCryptoModule::keyserverHostedNotificationsID, encryptedData);
  StatefulDecryptResult statefulDecryptResult(
      std::move(cryptoModule), decryptedData);

  return std::make_unique<StatefulDecryptResult>(
      std::move(statefulDecryptResult));
}

void NotificationsCryptoModule::flushState(
    std::unique_ptr<StatefulDecryptResult> statefulDecryptResult,
    const std::string &callingProcessName) {

  std::string path = PlatformSpecificTools::getNotificationsCryptoAccountPath();
  std::string picklingKey = NotificationsCryptoModule::getPicklingKey();

  NotificationsCryptoModule::serializeAndFlushCryptoModule(
      std::move(statefulDecryptResult->cryptoModuleState),
      path,
      picklingKey,
      callingProcessName);
}
} // namespace comm
