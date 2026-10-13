addToLibrary({
  libcf_host_var: (id, namePtr, nameLength, outputPtr, capacity) => {
    return Module['libcfHost'].var(id, HEAPU8.slice(namePtr, namePtr + nameLength),
                                   outputPtr, capacity, HEAPU8);
  },
  libcf_host_header: (id, namePtr, nameLength, valuePtr, valueLength) => {
    Module['libcfHost'].header(id,
      HEAPU8.slice(namePtr, namePtr + nameLength),
      HEAPU8.slice(valuePtr, valuePtr + valueLength));
  },
  libcf_host_finish: (id, status, bodyPtr, length) => {
    Module['libcfHost'].finish(id, status, HEAPU8.slice(bodyPtr, bodyPtr + length));
  },
  libcf_host_fetch: (operation, invocation, pathPtr, length) => {
    Module['libcfHost'].fetch(operation, invocation, HEAPU8.slice(pathPtr, pathPtr + length));
  },
  libcf_host_random: (ptr, length) => {
    HEAPU8.set(crypto.getRandomValues(new Uint8Array(length)), ptr);
  },
  libcf_host_background: (id, kind, targetPtr, targetLength, keyPtr, keyLength, valuePtr, valueLength) => {
    Module['libcfHost'].background(id, kind,
      HEAPU8.slice(targetPtr, targetPtr + targetLength),
      HEAPU8.slice(keyPtr, keyPtr + keyLength),
      HEAPU8.slice(valuePtr, valuePtr + valueLength));
  },
  libcf_host_stream_begin: (id, status) => {
    Module['libcfHost'].streamBegin(id, status);
  },
  libcf_host_stream_emit: (id, ptr, length, done) => {
    Module['libcfHost'].streamEmit(id, HEAPU8.slice(ptr, ptr + length), done);
  },
});
