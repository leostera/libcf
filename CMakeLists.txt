cmake_minimum_required(VERSION 3.24)
project(cf VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)

add_library(cf INTERFACE)
add_library(cf::cf ALIAS cf)
target_include_directories(cf INTERFACE
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>)
target_compile_features(cf INTERFACE cxx_std_20)

include(CMakePackageConfigHelpers)
install(TARGETS cf EXPORT cfTargets)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(FILES lib/runtime.mjs lib/header-wire.mjs lib/body.mjs lib/email.mjs lib/rate-limit.mjs lib/analytics.mjs lib/metadata.mjs lib/worker-loader.mjs lib/subtle-crypto.mjs lib/http-client.mjs lib/pipeline.mjs lib/timer.mjs lib/json.mjs lib/workflow.mjs lib/images.mjs lib/d1.mjs lib/queue.mjs lib/events.mjs lib/sql.mjs lib/durable-storage.mjs lib/durable-object.mjs lib/websocket.mjs lib/r2.mjs lib/cache.mjs lib/service.mjs lib/emscripten-host.js DESTINATION ${CMAKE_INSTALL_DATADIR}/cf)
install(FILES src/worker.cpp DESTINATION ${CMAKE_INSTALL_DATADIR}/cf/src)
install(EXPORT cfTargets
  FILE cfTargets.cmake
  NAMESPACE cf::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cf)
configure_package_config_file(cmake/cfConfig.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/cfConfig.cmake
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cf
  PATH_VARS CMAKE_INSTALL_DATADIR)
write_basic_package_version_file(${CMAKE_CURRENT_BINARY_DIR}/cfConfigVersion.cmake
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion)
install(FILES
  ${CMAKE_CURRENT_BINARY_DIR}/cfConfig.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/cfConfigVersion.cmake
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cf)

include(CTest)
option(LIBCF_SANITIZERS "Enable address/undefined-behavior sanitizers for native tests" OFF)
if(LIBCF_SANITIZERS AND NOT EMSCRIPTEN)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()
if(BUILD_TESTING AND NOT EMSCRIPTEN)
  foreach(suite core storage d1 events websocket email rate_limit analytics metadata worker_loader subtle_crypto http_client pipeline timer workflow images clock wire_limits)
    add_executable(cf-${suite}-test tests/native/${suite}.cpp)
    target_link_libraries(cf-${suite}-test PRIVATE cf::cf)
    add_test(NAME cf-${suite}-test COMMAND cf-${suite}-test)
  endforeach()
endif()
