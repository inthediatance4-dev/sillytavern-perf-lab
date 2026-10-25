#include <errno.h>
#include <node_api.h>
#include <sys/file.h>

/* Non-blocking exclusive flock on an already-open descriptor.
 * The lock dies with the process, including SIGKILL, because the kernel
 * releases it when this file description is closed.
 */
static napi_value FlockExclusiveNb(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    int32_t fd = -1;
    napi_get_value_int32(env, argv[0], &fd);
    int rc;
    do {
        rc = flock(fd, LOCK_EX | LOCK_NB);
    } while (rc != 0 && errno == EINTR);
    if (rc == 0) {
        napi_value undef;
        napi_get_undefined(env, &undef);
        return undef;
    }
    const char *name = (errno == EWOULDBLOCK || errno == EAGAIN) ? "EAGAIN" : "EIO";
    napi_value code;
    napi_value msg;
    napi_value error;
    napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &code);
    napi_create_string_utf8(env, "flock failed", NAPI_AUTO_LENGTH, &msg);
    napi_create_error(env, code, msg, &error);
    napi_set_named_property(env, error, "code", code);
    napi_throw(env, error);
    return NULL;
}

NAPI_MODULE_INIT() {
    napi_value fn;
    napi_create_function(env, "flockExclusiveNb", NAPI_AUTO_LENGTH, FlockExclusiveNb, NULL, &fn);
    napi_set_named_property(env, exports, "flockExclusiveNb", fn);
    return exports;
}
