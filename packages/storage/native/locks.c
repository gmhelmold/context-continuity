/* A deliberately small Node-API bridge. No paths, timers, helpers or retries.
 * The TypeScript resource owner opens private descriptors and owns their lifetime. */
#include <node_api.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <sys/mount.h>
#else
#include <sys/vfs.h>
#endif

static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, "E_CAPABILITY", message); return NULL;
}
static int descriptor(napi_env env, napi_callback_info info, int *fd) {
  size_t argc = 1; napi_value argv[1]; double value;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_double(env, argv[0], &value) != napi_ok || !(value >= 0 && value <= 2147483647) ||
      (double)(int)value != value) { fail(env, "invalid private lock descriptor"); return 0; }
  *fd = (int)value; return 1;
}
static napi_value boolean_result(napi_env env, int value) {
  napi_value result; if (napi_get_boolean(env, value, &result) != napi_ok) return fail(env, "lock result unavailable");
  return result;
}
static napi_value local_profile(napi_env env, napi_callback_info info) {
  int fd; struct statfs fs;
  if (!descriptor(env, info, &fd)) return NULL;
  if (fstatfs(fd, &fs) != 0) return fail(env, "filesystem classification unavailable");
#if defined(__APPLE__)
  return boolean_result(env, (fs.f_flags & MNT_LOCAL) != 0);
#else
  /* Explicit local filesystem profile; unknown/network filesystems fail closed. */
  unsigned long type = (unsigned long)fs.f_type;
  return boolean_result(env, type == 0xef53UL || type == 0x58465342UL || type == 0x9123683eUL ||
    type == 0x01021994UL || type == 0x794c7630UL);
#endif
}
static napi_value try_lock(napi_env env, napi_callback_info info) {
  int fd; struct stat st;
  if (!descriptor(env, info, &fd)) return NULL;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_uid != geteuid() ||
      (st.st_mode & 07777) != 0600 || st.st_nlink != 1) return fail(env, "invalid private lock file");
  int flags = fcntl(fd, F_GETFD);
  if (flags < 0 || fcntl(fd, F_SETFD, flags | FD_CLOEXEC) != 0) return fail(env, "close-on-exec unavailable");
  if (flock(fd, LOCK_EX | LOCK_NB) == 0) return boolean_result(env, 1);
  if (errno == EWOULDBLOCK || errno == EAGAIN) return boolean_result(env, 0);
  return fail(env, "operating system lock unavailable");
}
static napi_value unlock(napi_env env, napi_callback_info info) {
  int fd;
  if (!descriptor(env, info, &fd)) return NULL;
  if (flock(fd, LOCK_UN) != 0) return fail(env, "operating system unlock failed");
  return boolean_result(env, 1);
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"localProfile", NULL, local_profile, NULL, NULL, NULL, napi_default, NULL},
    {"tryLock", NULL, try_lock, NULL, NULL, NULL, napi_default, NULL},
    {"unlock", NULL, unlock, NULL, NULL, NULL, napi_default, NULL}
  };
  if (napi_define_properties(env, exports, 3, methods) != napi_ok) return fail(env, "lock module unavailable");
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
