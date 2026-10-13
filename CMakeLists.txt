cmake_minimum_required(VERSION 3.24)
project(cf VERSION 0.1.0 LANGUAGES CXX)

add_library(cf INTERFACE)
add_library(cf::cf ALIAS cf)
target_include_directories(cf INTERFACE
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(cf INTERFACE cxx_std_20)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)
install(TARGETS cf EXPORT cfTargets)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(FILES lib/runtime.mjs lib/header-wire.mjs lib/body.mjs lib/d1.mjs lib/queue.mjs lib/events.mjs lib/sql.mjs lib/durable-storage.mjs lib/durable-object.mjs lib/websocket.mjs lib/r2.mjs lib/cache.mjs lib/service.mjs lib/emscripten-host.js DESTINATION ${CMAKE_INSTALL_DATADIR}/cf)
install(FILES src/worker.cpp DESTINATION ${CMAKE_INSTALL_DATADIR}/cf/src)
install(EXPORT cfTargets
  FILE cfTargets.cmake
  NAMESPACE cf::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cf)
configure_package_config_file(cmake/cfConfig.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/cfConfig.cmake
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cf)
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
  foreach(suite core storage d1 events websocket)
    add_executable(cf-${suite}-test tests/native/${suite}.cpp)
    target_link_libraries(cf-${suite}-test PRIVATE cf::cf)
    add_test(NAME cf-${suite}-test COMMAND cf-${suite}-test)
  endforeach()
endif()
