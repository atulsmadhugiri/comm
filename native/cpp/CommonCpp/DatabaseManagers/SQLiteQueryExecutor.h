#pragma once

#include "../CryptoTools/Persist.h"
#include "DatabaseQueryExecutor.h"
#include "entities/Draft.h"
#include "entities/UserInfo.h"

#include <mutex>
#include <string>

namespace comm {

class SQLiteQueryExecutor : public DatabaseQueryExecutor {
  static void migrate();
  static auto &getStorage();

  static std::once_flag initialized;
  static int sqlcipherEncryptionKeySize;
  static std::string secureStoreEncryptionKeyID;

#ifndef EMSCRIPTEN
  static void assign_encryption_key();
#endif

public:
  static std::string sqliteFilePath;
  static std::string encryptionKey;

  SQLiteQueryExecutor();
  SQLiteQueryExecutor(std::string sqliteFilePath);
  std::unique_ptr<Thread> getThread(std::string threadID) const override;
  std::string getDraft(std::string key) const override;
  void updateDraft(std::string key, std::string text) const override;
  bool moveDraft(std::string oldKey, std::string newKey) const override;
  std::vector<Draft> getAllDrafts() const override;
  void removeAllDrafts() const override;
  void removeAllMessages() const override;
  std::vector<std::pair<Message, std::vector<Media>>>
  getAllMessages() const override;
  void removeMessages(const std::vector<std::string> &ids) const override;
  void removeMessagesForThreads(
      const std::vector<std::string> &threadIDs) const override;
  void replaceMessage(const Message &message) const override;
  void rekeyMessage(std::string from, std::string to) const override;
  void replaceMessageStoreThreads(
      const std::vector<MessageStoreThread> &threads) const override;
  void
  removeMessageStoreThreads(const std::vector<std::string> &ids) const override;
  void removeAllMessageStoreThreads() const override;
  std::vector<MessageStoreThread> getAllMessageStoreThreads() const override;
  void removeAllMedia() const override;
  void removeMediaForMessages(
      const std::vector<std::string> &msg_ids) const override;
  void removeMediaForMessage(std::string msg_id) const override;
  void removeMediaForThreads(
      const std::vector<std::string> &thread_ids) const override;
  void replaceMedia(const Media &media) const override;
  void rekeyMediaContainers(std::string from, std::string to) const override;
  std::vector<Thread> getAllThreads() const override;
  void removeThreads(std::vector<std::string> ids) const override;
  void replaceThread(const Thread &thread) const override;
  void removeAllThreads() const override;
  void replaceReport(const Report &report) const override;
  void removeReports(const std::vector<std::string> &ids) const override;
  void removeAllReports() const override;
  std::vector<Report> getAllReports() const override;
  void setPersistStorageItem(std::string key, std::string item) const override;
  void removePersistStorageItem(std::string key) const override;
  std::string getPersistStorageItem(std::string key) const override;
  void replaceUser(const UserInfo &user_info) const override;
  void removeUsers(const std::vector<std::string> &ids) const override;
  void removeAllUsers() const override;
  std::vector<UserInfo> getAllUsers() const override;
  void beginTransaction() const override;
  void commitTransaction() const override;
  void rollbackTransaction() const override;
  std::vector<OlmPersistSession> getOlmPersistSessionsData() const override;
  std::optional<std::string> getOlmPersistAccountData() const override;
  void storeOlmPersistData(crypto::Persist persist) const override;
  void setNotifyToken(std::string token) const override;
  void clearNotifyToken() const override;
  void setCurrentUserID(std::string userID) const override;
  std::string getCurrentUserID() const override;
  void setMetadata(std::string entry_name, std::string data) const override;
  void clearMetadata(std::string entry_name) const override;
  std::string getMetadata(std::string entry_name) const override;

#ifdef EMSCRIPTEN
  std::vector<WebThread> getAllThreadsWeb() const override;
  void replaceThreadWeb(const WebThread &thread) const override;
#else
  static void clearSensitiveData();
  static void initialize(std::string &databasePath);
  void createMainCompaction(std::string backupID) const override;
#endif
};

} // namespace comm
