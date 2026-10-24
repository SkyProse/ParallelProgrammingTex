/* Corrected teaching counterpart to the archived WithPosix.c, 2026-10-24.
 * Each worker owns a disjoint half-open interval. No shared accumulator.
 * This validates a computation; it is not a performance benchmark. */
#include <errno.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { uint32_t *array; size_t begin, end; } Task;
static void *add_ten(void *argument) {
    Task *task = argument;
    for (size_t i = task->begin; i < task->end; ++i) task->array[i] += 10u;
    return NULL;
}
static int number(const char *text, size_t maximum, size_t *out) {
    if (!text || !*text) return 0;
    for (const char *p = text; *p; ++p) if (*p < '0' || *p > '9') return 0;
    errno = 0;
    char *end;
    unsigned long long value = strtoull(text, &end, 10);
    if (errno || *end || value > maximum) return 0;
    *out = (size_t)value;
    return 1;
}
int main(int argc, char **argv) {
    size_t size = 10, count = 2;
    if (argc != 3 || !number(argv[1], 10000000, &size) ||
        !number(argv[2], 256, &count) || count == 0) {
        fputs("Usage: pthreads-add SIZE(0..10000000) THREADS(1..256)\n", stderr);
        return EXIT_FAILURE;
    }
    uint32_t *array = calloc(size ? size : 1, sizeof(*array));
    pthread_t *threads = calloc(count, sizeof(*threads));
    Task *tasks = calloc(count, sizeof(*tasks));
    if (!array || !threads || !tasks) {
        fputs("Allocation failed\n", stderr);
        free(array); free(threads); free(tasks);
        return EXIT_FAILURE;
    }
    for (size_t i = 0; i < size; ++i) array[i] = (uint32_t)i;
    size_t created = 0, begin = 0;
    int failed = 0;
    for (size_t t = 0; t < count; ++t) {
        size_t length = size / count + (t < size % count ? 1 : 0);
        tasks[t] = (Task){array, begin, begin + length};
        begin += length;
        int error = pthread_create(&threads[t], NULL, add_ten, &tasks[t]);
        if (error != 0) {
            fprintf(stderr, "pthread_create: %s\n", strerror(error));
            failed = 1;
            break;
        }
        ++created;
    }
    for (size_t t = 0; t < created; ++t) {
        int error = pthread_join(threads[t], NULL);
        if (error != 0) {
            fprintf(stderr, "pthread_join: %s\n", strerror(error));
            /* A worker may still use the allocations: let process exit clean them. */
            return EXIT_FAILURE;
        }
    }
    uint64_t sum = 0;
    if (!failed) {
        for (size_t i = 0; i < size; ++i) {
            if (array[i] != (uint32_t)i + 10u) failed = 1;
            sum += array[i];
        }
    }
    if (!failed) printf("{\"verified\":true,\"size\":%zu,\"threads\":%zu,\"sum\":%" PRIu64 "}\n", size, count, sum);
    free(array); free(threads); free(tasks);
    return failed ? EXIT_FAILURE : EXIT_SUCCESS;
}
