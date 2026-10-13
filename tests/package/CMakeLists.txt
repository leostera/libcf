cmake_minimum_required(VERSION 3.24)
project(libcf-consumer LANGUAGES CXX)
find_package(cf 0.1 CONFIG REQUIRED)
add_executable(libcf-consumer main.cpp)
target_link_libraries(libcf-consumer PRIVATE cf::cf)

enable_testing()
add_test(NAME installed-core COMMAND libcf-consumer)
foreach(standard 20 23)
  add_executable(libcf-headers-${standard} all_headers.cpp)
  target_link_libraries(libcf-headers-${standard} PRIVATE cf::cf)
  target_compile_definitions(libcf-headers-${standard} PRIVATE CF_CONSUMER_STANDARD=${standard})
  set_target_properties(libcf-headers-${standard} PROPERTIES
    CXX_STANDARD ${standard} CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
  add_test(NAME installed-headers-${standard} COMMAND libcf-headers-${standard})
endforeach()

get_target_property(cf_includes cf::cf INTERFACE_INCLUDE_DIRECTORIES)
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/package-paths.txt"
  "${cf_includes}\n${cf_RUNTIME_DIR}\n${cf_WORKER_SOURCE}\n")
