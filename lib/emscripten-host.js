addToLibrary({
  libcf_host_var: (id, namePtr, nameLength, outputPtr, capacity) => {
    return Module["libcfHost"].var(
      id,
      HEAPU8.slice(namePtr, namePtr + nameLength),
      outputPtr,
      capacity,
      HEAPU8,
    );
  },
  libcf_host_finish: (id, status, headerPtr, headerLength, bodyPtr, length) => {
    // A view, not a copy: finish constructs the Response synchronously, and the
    // Fetch Response constructor copies BufferSource bodies before returning.
    Module["libcfHost"].finish(
      id,
      status,
      HEAPU8.subarray(bodyPtr, bodyPtr + length),
      HEAPU8.subarray(headerPtr, headerPtr + headerLength),
    );
  },
  libcf_host_fetch: (operation, invocation, pathPtr, length) => {
    Module["libcfHost"].fetch(operation, invocation, HEAPU8.slice(pathPtr, pathPtr + length));
  },
  libcf_host_digest: (ticket, invocation, algorithm, inputPtr, inputLength) => {
    // A view: Web Crypto copies its input before digest() returns.
    Module["libcfHost"].digest(ticket, invocation, algorithm, HEAPU8.subarray(inputPtr, inputPtr + inputLength));
  },
  libcf_host_now: () => Date.now(),
  libcf_host_random: (ptr, length) => {
    HEAPU8.set(crypto.getRandomValues(new Uint8Array(length)), ptr);
  },
  libcf_host_background: (
    id,
    kind,
    targetPtr,
    targetLength,
    keyPtr,
    keyLength,
    valuePtr,
    valueLength,
  ) => {
    Module["libcfHost"].background(
      id,
      kind,
      HEAPU8.slice(targetPtr, targetPtr + targetLength),
      HEAPU8.slice(keyPtr, keyPtr + keyLength),
      HEAPU8.slice(valuePtr, valuePtr + valueLength),
    );
  },
  libcf_host_stream_begin: (id, status, headerPtr, headerLength) => {
    Module["libcfHost"].streamBegin(id, status, HEAPU8.subarray(headerPtr, headerPtr + headerLength));
  },
  libcf_host_stream_emit: (id, ptr, length, done) => {
    Module["libcfHost"].streamEmit(id, HEAPU8.slice(ptr, ptr + length), done);
  },
  libcf_host_operation: (
    operation,
    invocation,
    method,
    bindingPtr,
    bindingLength,
    keyPtr,
    keyLength,
    bodyPtr,
    bodyLength,
    optionsPtr,
    optionsLength,
  ) => {
    Module["libcfHost"].operation(
      operation,
      invocation,
      method,
      HEAPU8.slice(bindingPtr, bindingPtr + bindingLength),
      HEAPU8.slice(keyPtr, keyPtr + keyLength),
      // A view: operation() copies it (or hands it to an API that copies
      // synchronously) before returning to Wasm.
      HEAPU8.subarray(bodyPtr, bodyPtr + bodyLength),
      HEAPU8.slice(optionsPtr, optionsPtr + optionsLength),
    );
  },
});
