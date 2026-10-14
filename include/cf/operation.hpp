#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include "cf/async.hpp"

namespace cf {

using Bytes = std::vector<std::uint8_t>;

// Version 1 of the C++/JS operation protocol. Numeric values are shared with
// lib/runtime.mjs; add new values, never silently reinterpret existing ones.
enum class Operation : std::uint32_t {
  KvGetText = 1,
  KvPut = 2,
  KvDelete = 3,
  KvList = 4,
  KvGetBytes = 5,
  KvGetMetadata = 6,
  D1Run = 16,
  D1All = 17,
  D1Exec = 18,
  D1First = 19,
  D1Batch = 20,
  R2Get = 32,
  R2Head = 33,
  R2Put = 34,
  R2Delete = 35,
  R2List = 36,
  CacheMatch = 48,
  CachePut = 49,
  CacheDelete = 50,
  ServiceFetch = 64,
  DurableSql = 80,
  DurableSqlBatch = 81,
  DurableSetAlarm = 82,
  DurableFetch = 96,
  QueueSendText = 112,
  QueueSendBytes = 113,
  RateLimit = 128,
  AnalyticsWriteDataPoint = 144,
  VersionMetadataGet = 160,
  SecretsStoreGet = 176,
  WorkerLoaderFetch = 192,
  CryptoDigest = 208,
  HttpFetch = 224,
  PipelineSend = 240,
  Sleep = 256,
  WorkflowCreate = 272,
  WorkflowStateGet = 273,
  WorkflowDelete = 274,
  WorkflowSendEvent = 275,
  ImageInfoGet = 288,
  RpcCallJson = 304,
  AiRunJson = 320,
  ServiceTcpExchange = 336,
  VectorizeQuery = 352,
  DispatchFetch = 368,
  MediaFramePng = 384,
  AiSearchKeywordQuery = 400,
  StreamVideoList = 416,
  StreamVideoDetails = 417,
  BrowserScreenshotHtmlPng = 432,
  AgentMemoryListCreatingProfile = 448,
  ContainerInspect = 464,
  FlagshipBooleanDetails = 480,
  ArtifactsRepositoryInfo = 496,
  AnalyticsSqlQuery = 512,
  AiGatewayUrl = 528,
  LegacySitesGet = 544,
};

struct OperationCall {
  Operation method;
  std::string binding;
  std::string key;
  Bytes body;
  std::string options;
};

enum class ReplyKind : std::uint8_t { Value, Missing };

struct OperationReply {
  ReplyKind kind;
  Bytes bytes;
};

class BindingRuntime {
 public:
  using Completion = std::function<void(Result<OperationReply>)>;
  using Start = std::function<void(OperationCall, Completion)>;
  using Resume = AsyncResult<OperationReply>::Resume;

  BindingRuntime(Start start, Resume resume)
      : start_(std::move(start)), resume_(std::move(resume)) {}

  template <typename T, typename Decode>
  [[nodiscard]] AsyncResult<T> call(OperationCall call, Decode decode) const {
    return AsyncResult<T>(
        [start = start_, call = std::move(call), decode = std::move(decode)](
            typename AsyncResult<T>::Completion finish) mutable {
          start(std::move(call), [finish = std::move(finish), decode = std::move(decode)](
                                      Result<OperationReply> result) mutable {
            if (!result) {
              finish(Result<T>::failure(result.error()));
              return;
            }
            finish(decode(std::move(result.value())));
          });
        }, resume_);
  }

 private:
  Start start_;
  Resume resume_;
};

}  // namespace cf
