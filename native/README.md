# Native measurements for Concurrency Theatre

This optional companion runs **native C++17 and OpenMP**, separately from the browser. It leaves the historical textbook listings unchanged. An OpenMP-capable `g++` is required. Run from the repository root:

```sh
bash native/run.sh --size 262144 --threads 4 --repetitions 7 --seed 12648430 > native-kernel.json
bash native/run.sh --false-sharing --iterations 500000 --threads 4 --line-bytes 64 --repetitions 7 > native-memory.json
```

The runner compiles into a temporary directory, executes, and removes its binary. Output is measurement JSON schema version 1. Import the JSON into the browser's measurement view; it must retain its **native/imported** provenance. Press Ctrl+C to stop a native run. Browser cancellation cannot cancel this separate process.

## Integer kernel

The browser and native runner implement `u32-mix-reduce-v1`: xorshift32 input from an explicit seed, a fixed integer transform using each element's global index, and an unsigned reduction modulo 2^32. Full output equality and the sum are checked on the cold run and every measured warm run. The output also records a non-cryptographic checksum. Validation is outside the timed scope.

Browser timing includes output allocation, Worker copies/messages, or GPU upload and readback. Native timing uses preallocated arrays and measures the compute region only. **Do not combine these into an unlabeled fastest-backend ranking.** A first measured run is recorded separately as `coldMs`; it is not a promise of empty hardware caches or a fresh browser process. The reference is generated after the first kernel measurement to avoid deliberately warming that first run. Then 3–31 warm samples produce a mean, median, sample SD, and exploratory 95% Student-t interval for the mean. Sequential samples may be correlated. Process start, compilation, allocations, and input generation are excluded from native timings.

## False sharing experiment

Each OpenMP thread increments its own lock-free `atomic<uint64_t>` using relaxed ordering. This avoids a language-level data race and prevents the compiler from eliminating the loop. Two layouts are measured: packed counters and counters separated by the requested stride. The allocation is aligned to 256 bytes; actual offsets and stride are recorded.

`--line-bytes` accepts 32, 64, 128, or 256. It is an **explicit assumption**, not hardware detection. The experiment measures the effect of placement on this machine under current conditions. It does not observe coherence messages or prove that all timing differences are caused by false sharing. Atomic instruction cost, thread scheduling, core placement, thermal state, and frequency also matter. This runner does not control affinity or frequency. A single-thread run is a useful control. Repeat experiments with alternative strides and controlled affinity when investigating hardware.

Limits: 1–1,048,576 kernel elements, 1–8 threads, 3–31 warm repetitions, at most 20,000,000 increments per thread. The runner checks a 90 second overall budget between bounded runs. Inputs are validated before execution; failing correctness checks terminate without producing a successful JSON report.

## Verification

```sh
node --test --test-isolation=none --test-reporter=spec web/tests/compute*.test.js tests/native*.test.js
```

Tests compile the C++ runner in a temporary directory and compare native serial/OpenMP results with the browser kernel, including a non-divisible input length. They also verify packed/padded counters and reject unbounded requests. GPU execution is separately exercised in browser QA; a Node test does not establish GPU availability.
