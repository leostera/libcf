#include <string>

// Spike ABI: numeric request IDs are owned by the JS adapter, never reused while
// an operation is pending. Pointer arguments are borrowed only for the call.
extern "C" {
void cf_host_get(int id, const char* key, int length);
void cf_host_fetch(int id, const char* path, int length);
void cf_host_background(int id, const char* key, int key_length, const char* value,
                        int value_length);
void cf_host_emit(int id, const char* bytes, int length, int status);

int cf_add(int a, int b) { return a + b; }

void cf_get(int id, const char* key, int length) { cf_host_get(id, key, length); }

void cf_fetch_asset(int id, const char* path, int length) { cf_host_fetch(id, path, length); }

void cf_resume(int id, const char* value, int length, int status) {
  if (status != 200) {
    constexpr char missing[] = "not found";
    constexpr char failed[] = "binding error";
    if (status == 404) {
      cf_host_emit(id, missing, sizeof(missing) - 1, status);
    } else {
      cf_host_emit(id, failed, sizeof(failed) - 1, status);
    }
    return;
  }
  std::string output = "C++[";
  output.append(value, length);
  output += ']';
  cf_host_emit(id, output.data(), static_cast<int>(output.size()), status);
}

void cf_background_write(int id, const char* key, int key_length, const char* value,
                         int value_length) {
  cf_host_background(id, key, key_length, value, value_length);
}

// One chunk per ReadableStream pull: avoid allocating a full response in JS.
void cf_stream_chunk(int id, int index) {
  std::string chunk = "chunk-" + std::to_string(index) + "\n";
  cf_host_emit(id, chunk.data(), static_cast<int>(chunk.size()), 200);
}
}
