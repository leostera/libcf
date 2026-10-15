addToLibrary({
  cf_host_get: (id, ptr, length) => {
    Module["cfHost"].get(id, HEAPU8.slice(ptr, ptr + length));
  },
  cf_host_fetch: (id, ptr, length) => {
    Module["cfHost"].fetch(id, HEAPU8.slice(ptr, ptr + length));
  },
  cf_host_background: (id, keyPtr, keyLength, valuePtr, valueLength) => {
    Module["cfHost"].background(
      id,
      HEAPU8.slice(keyPtr, keyPtr + keyLength),
      HEAPU8.slice(valuePtr, valuePtr + valueLength),
    );
  },
  cf_host_emit: (id, ptr, length, status) => {
    Module["cfHost"].emit(id, HEAPU8.slice(ptr, ptr + length), status);
  },
});
