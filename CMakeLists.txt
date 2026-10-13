cmake_minimum_required(VERSION 3.24)
project(libcf VERSION 0.1.0 LANGUAGES CXX)

add_library(libcf INTERFACE)
add_library(libcf::libcf ALIAS libcf)
target_include_directories(libcf INTERFACE
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(libcf INTERFACE cxx_std_20)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)
install(TARGETS libcf EXPORT libcfTargets)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(FILES lib/runtime.mjs lib/emscripten-host.js DESTINATION ${CMAKE_INSTALL_DATADIR}/libcf)
install(FILES src/worker.cpp DESTINATION ${CMAKE_INSTALL_DATADIR}/libcf/src)
install(EXPORT libcfTargets
  FILE libcfTargets.cmake
  NAMESPACE libcf::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/libcf)
configure_package_config_file(cmake/libcfConfig.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/libcfConfig.cmake
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/libcf)
write_basic_package_version_file(${CMAKE_CURRENT_BINARY_DIR}/libcfConfigVersion.cmake
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion)
install(FILES
  ${CMAKE_CURRENT_BINARY_DIR}/libcfConfig.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/libcfConfigVersion.cmake
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/libcf)

include(CTest)
option(LIBCF_SANITIZERS "Enable address/undefined-behavior sanitizers for native tests" OFF)
if(LIBCF_SANITIZERS AND NOT EMSCRIPTEN)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()
if(BUILD_TESTING AND NOT EMSCRIPTEN)
  add_executable(libcf-native-test tests/native/core.cpp)
  target_link_libraries(libcf-native-test PRIVATE libcf::libcf)
  add_test(NAME libcf-native-test COMMAND libcf-native-test)
  add_executable(libcf-storage-test tests/native/storage.cpp)
  target_link_libraries(libcf-storage-test PRIVATE libcf::libcf)
  add_test(NAME libcf-storage-test COMMAND libcf-storage-test)
endif()
