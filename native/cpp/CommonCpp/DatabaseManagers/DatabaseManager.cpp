#include "DatabaseManager.h"
#include "../Notifications/BackgroundDataStorage/NotificationsCryptoModule.h"
#include "../Tools/CommSecureStore.h"
#include "Logger.h"
#include "PlatformSpecificTools.h"
#include "SQLiteQueryExecutor.h"

namespace comm {

std::once_flag DatabaseManager::initialized;

typedef const std::string DatabaseManagerStatus;
DatabaseManagerStatus DB_MANAGER_WORKABLE = "WORKABLE";
DatabaseManagerStatus DB_MANAGER_FIRST_FAILURE = "FIRST_FAILURE";
DatabaseManagerStatus DB_MANAGER_SECOND_FAILURE = "SECOND_FAILURE";
DatabaseManagerStatus DB_OPERATIONS_FAILURE = "DB_OPERATIONS_FAILURE";

const std::string DATABASE_MANAGER_STATUS_KEY = "DATABASE_MANAGER_STATUS";

const DatabaseQueryExecutor &DatabaseManager::getQueryExecutor() {
  //  TODO: conditionally create desired type of db manager
  //  maybe basing on some preprocessor flag
  thread_local SQLiteQueryExecutor instance;

  // creating an instance means that migration code was executed
  // and finished without error and database is workable
  std::call_once(DatabaseManager::initialized, []() {
    DatabaseManager::indicateQueryExecutorCreation();
  });
  return instance;
}

void DatabaseManager::clearSensitiveData() {
  CommSecureStore::set(CommSecureStore::userID, "");
  CommSecureStore::set(CommSecureStore::deviceID, "");
  CommSecureStore::set(CommSecureStore::commServicesAccessToken, "");
  SQLiteQueryExecutor::clearSensitiveData();
  PlatformSpecificTools::removeBackupDirectory();
  NotificationsCryptoModule::clearSensitiveData();
  DatabaseManager::setDatabaseStatusAsWorkable();
}

void DatabaseManager::initializeQueryExecutor(std::string &databasePath) {
  try {
    SQLiteQueryExecutor::initialize(databasePath);
    DatabaseManager::getQueryExecutor();
    DatabaseManager::indicateQueryExecutorCreation();
    Logger::log("Database manager initialized");
  } catch (...) {
    folly::Optional<std::string> databaseManagerStatus =
        CommSecureStore::get(DATABASE_MANAGER_STATUS_KEY);
    if (!databaseManagerStatus.hasValue() ||
        databaseManagerStatus.value() == DB_MANAGER_WORKABLE) {
      CommSecureStore::set(
          DATABASE_MANAGER_STATUS_KEY, DB_MANAGER_FIRST_FAILURE);
      Logger::log("Database manager initialization issue, terminating app");
      throw;
    }
    if (databaseManagerStatus.value() == DB_MANAGER_FIRST_FAILURE) {
      CommSecureStore::set(
          DATABASE_MANAGER_STATUS_KEY, DB_MANAGER_SECOND_FAILURE);
      Logger::log(
          "Database manager initialization issue, app proceeding, but "
          "database needs to be deleted");
      return;
    }
  }
}

void DatabaseManager::setDatabaseStatusAsWorkable() {
  CommSecureStore::set(DATABASE_MANAGER_STATUS_KEY, DB_MANAGER_WORKABLE);
}

void DatabaseManager::indicateQueryExecutorCreation() {
  folly::Optional<std::string> databaseManagerStatus =
      CommSecureStore::get(DATABASE_MANAGER_STATUS_KEY);
  if (!databaseManagerStatus.hasValue() ||
      databaseManagerStatus.value() != DB_OPERATIONS_FAILURE) {
    // creating query executor means that schema was created without error,
    // but this doesn't imply that schema has a proper structure,
    // and operation will not crash, this case should not be overridden
    CommSecureStore::set(DATABASE_MANAGER_STATUS_KEY, DB_MANAGER_WORKABLE);
  }
}

bool DatabaseManager::checkIfDatabaseNeedsDeletion() {
  folly::Optional<std::string> databaseManagerStatus =
      CommSecureStore::get(DATABASE_MANAGER_STATUS_KEY);
  return databaseManagerStatus.hasValue() &&
      (databaseManagerStatus.value() == DB_MANAGER_SECOND_FAILURE ||
       databaseManagerStatus.value() == DB_OPERATIONS_FAILURE);
}

void DatabaseManager::reportDBOperationsFailure() {
  CommSecureStore::set(DATABASE_MANAGER_STATUS_KEY, DB_OPERATIONS_FAILURE);
}

} // namespace comm
