// A separate native experiment. Browser timings and native OpenMP timings have different scopes.
// The archival examples in listings/ are deliberately not modified by this companion.
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <omp.h>

#ifndef _OPENMP
#error "Compile this companion with OpenMP enabled (-fopenmp)."
#endif
#ifndef CT_BUILD_FLAGS
#define CT_BUILD_FLAGS "not recorded; see your build command"
#endif

using Clock = std::chrono::steady_clock;
constexpr std::size_t MAX_SIZE = 1048576;
constexpr std::uint64_t MAX_ITERATIONS = 20000000;
struct Config { std::size_t size = 262144; int repetitions = 7, threads = 2; std::uint32_t seed = 0x00c0ffee; bool falseSharing = false; std::uint64_t iterations = 500000; std::size_t lineBytes = 64; };

std::string quoted(const std::string& value) {
  std::ostringstream out; out << '"';
  for (unsigned char c : value) { if (c == '"' || c == '\\') out << '\\' << c; else if (c == '\n') out << "\\n"; else if (c < 32) out << '?'; else out << c; }
  out << '"'; return out.str();
}
std::uint64_t number(const std::string& value, const std::string& name, std::uint64_t min, std::uint64_t max) {
  if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos) throw std::invalid_argument(name + " must be an unsigned integer");
  const auto result = std::stoull(value);
  if (result < min || result > max) throw std::invalid_argument(name + " exceeds the permitted limit");
  return result;
}
Config parse(int argc, char** argv) {
  Config config;
  for (int i = 1; i < argc; i++) {
    const std::string name = argv[i];
    if (name == "--false-sharing") { config.falseSharing = true; continue; }
    if (i + 1 >= argc) throw std::invalid_argument("Missing value for " + name);
    const std::string value = argv[++i];
    if (name == "--size") config.size = number(value, "size", 1, MAX_SIZE);
    else if (name == "--repetitions") config.repetitions = static_cast<int>(number(value, "repetitions", 3, 31));
    else if (name == "--threads") config.threads = static_cast<int>(number(value, "threads", 1, 8));
    else if (name == "--seed") config.seed = static_cast<std::uint32_t>(number(value, "seed", 0, 0xffffffffu));
    else if (name == "--iterations") config.iterations = number(value, "iterations", 1, MAX_ITERATIONS);
    else if (name == "--line-bytes") { config.lineBytes = number(value, "line bytes", 32, 256); if ((config.lineBytes & (config.lineBytes - 1)) != 0) throw std::invalid_argument("line bytes must be 32, 64, 128, or 256"); }
    else throw std::invalid_argument("Unknown option: " + name);
  }
  return config;
}
std::uint32_t mixValue(std::uint32_t value, std::uint32_t index) {
  std::uint32_t mixed = value ^ ((index + 1u) * 0x9e3779b9u);
  mixed = (mixed ^ (mixed >> 16u)) * 0x85ebca6bu;
  mixed = (mixed ^ (mixed >> 13u)) * 0xc2b2ae35u;
  return mixed ^ (mixed >> 16u);
}
std::vector<std::uint32_t> seeded(std::size_t size, std::uint32_t seed) {
  std::vector<std::uint32_t> values(size);
  for (auto& value : values) { seed ^= seed << 13u; seed ^= seed >> 17u; seed ^= seed << 5u; value = seed; }
  return values;
}
std::uint32_t checksum(const std::vector<std::uint32_t>& values) {
  std::uint32_t hash = 0x811c9dc5u;
  for (auto value : values) hash = (hash ^ value) * 0x01000193u;
  return hash;
}
std::uint32_t kernel(const std::vector<std::uint32_t>& input, std::vector<std::uint32_t>& output, bool parallel, int threads, int& observedThreads) {
  std::uint32_t sum = 0;
  if (parallel) {
    #pragma omp parallel num_threads(threads) reduction(+:sum)
    {
      #pragma omp single
      observedThreads = omp_get_num_threads();
      #pragma omp for schedule(static)
      for (std::size_t i = 0; i < input.size(); i++) { output[i] = mixValue(input[i], static_cast<std::uint32_t>(i)); sum += output[i]; }
    }
  } else {
    observedThreads = 1;
    for (std::size_t i = 0; i < input.size(); i++) { output[i] = mixValue(input[i], static_cast<std::uint32_t>(i)); sum += output[i]; }
  }
  return sum;
}
double milliseconds(Clock::time_point from) { return std::chrono::duration<double, std::milli>(Clock::now() - from).count(); }
void budget(Clock::time_point start) { if (milliseconds(start) > 90000) throw std::runtime_error("Native benchmark exceeded its 90 second total budget"); }

std::string stats(const std::vector<double>& values) {
  static const double t[] = {0, 12.7062047364, 4.3026527297, 3.1824463053, 2.7764451052, 2.5705818356, 2.4469118511, 2.3646242516, 2.3060041352, 2.2621571629, 2.2281388520, 2.2009851601, 2.1788128297, 2.1603686565, 2.1447866879, 2.1314495456, 2.1199052992, 2.1098155778, 2.1009220402, 2.0930240544, 2.0859634473, 2.0796138447, 2.0738730679, 2.0686576104, 2.0638985616, 2.0595385528, 2.0555294386, 2.0518305165, 2.0484071418, 2.0452296421, 2.0422724563};
  double mean = 0, m2 = 0;
  for (std::size_t i = 0; i < values.size(); i++) { double delta = values[i] - mean; mean += delta / (i + 1); m2 += delta * (values[i] - mean); }
  auto sorted = values; std::sort(sorted.begin(), sorted.end());
  const auto n = values.size();
  const double deviation = std::sqrt(std::max(0.0, m2 / (n - 1)));
  const double half = t[n - 1] * deviation / std::sqrt(static_cast<double>(n));
  const double median = n % 2 ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  std::ostringstream out; out << std::setprecision(15);
  out << "{\"n\":" << n << ",\"mean\":" << mean << ",\"median\":" << median << ",\"stddev\":" << deviation << ",\"min\":" << sorted.front() << ",\"max\":" << sorted.back() << ",\"ci95\":[" << mean - half << ',' << mean + half << "],\"ciMethod\":\"Student-t interval for the sample mean; exploratory, assumes independent observations\"}";
  return out.str();
}
template <typename T> std::string arrayJSON(const std::vector<T>& values) {
  std::ostringstream out; out << std::setprecision(15) << '[';
  for (std::size_t i = 0; i < values.size(); i++) { if (i) out << ','; out << values[i]; }
  out << ']'; return out.str();
}

std::string kernelRows(const Config& config, int& observedThreads, Clock::time_point wholeStart) {
  const auto input = seeded(config.size, config.seed);
  std::vector<std::uint32_t> expected(config.size), output(config.size);
  int ignored = 1;
  std::uint32_t expectedSum = 0, expectedChecksum = 0;
  bool referenceReady = false;
  std::ostringstream rows; rows << std::setprecision(15) << '[';
  for (bool parallel : {false, true}) {
    std::vector<double> samples;
    double cold = 0;
    std::uint32_t sum = 0;
    for (int repetition = -1; repetition < config.repetitions; repetition++) {
      budget(wholeStart);
      const auto start = Clock::now();
      sum = kernel(input, output, parallel, config.threads, observedThreads);
      const double elapsed = milliseconds(start);
      if (!referenceReady) { expectedSum = kernel(input, expected, false, 1, ignored); expectedChecksum = checksum(expected); referenceReady = true; }
      if (sum != expectedSum || output != expected) throw std::runtime_error("Native output equality check failed");
      if (repetition < 0) cold = elapsed; else samples.push_back(elapsed);
    }
    if (parallel) rows << ',';
    rows << "{\"size\":" << config.size << ",\"backend\":" << quoted(parallel ? "openmp" : "native-serial") << ",\"status\":\"ok\",\"workerCount\":" << observedThreads << ",\"coldMs\":" << cold
      << ",\"samples\":" << arrayJSON(samples) << ",\"summary\":" << stats(samples)
      << ",\"timingScope\":\"native wall compute time with preallocated input/output; allocation, input generation, process startup and correctness validation excluded\",\"correctness\":{\"verified\":true,\"checks\":" << config.repetitions + 1 << ",\"sum\":" << sum << ",\"expectedSum\":" << expectedSum << ",\"checksum\":" << checksum(output) << ",\"expectedChecksum\":" << expectedChecksum << "}}";
  }
  rows << ']'; return rows.str();
}

class Counters {
  std::byte* storage;
  std::size_t count, stride;
public:
  Counters(std::size_t count_, std::size_t stride_) : count(count_), stride(stride_) {
    storage = static_cast<std::byte*>(::operator new[](count * stride, std::align_val_t(256)));
    for (std::size_t i = 0; i < count; i++) new (storage + i * stride) std::atomic<std::uint64_t>(0);
  }
  Counters(const Counters&) = delete;
  std::atomic<std::uint64_t>& at(std::size_t i) { return *reinterpret_cast<std::atomic<std::uint64_t>*>(storage + i * stride); }
  ~Counters() { for (std::size_t i = 0; i < count; i++) at(i).~atomic(); ::operator delete[](storage, std::align_val_t(256)); }
};

std::string sharingRows(const Config& config, int& observedThreads, Clock::time_point wholeStart) {
  static_assert(sizeof(std::atomic<std::uint64_t>) == 8, "This experiment requires 8-byte uint64 atomics");
  if (!std::atomic<std::uint64_t>{}.is_lock_free()) throw std::runtime_error("The false-sharing experiment requires lock-free uint64 atomics on this platform");
  std::ostringstream rows; rows << std::setprecision(15) << '[';
  for (bool padded : {false, true}) {
    const auto stride = padded ? config.lineBytes : sizeof(std::atomic<std::uint64_t>);
    Counters counters(config.threads, stride);
    std::vector<double> samples;
    std::vector<std::uint64_t> finalCounts(config.threads), offsets(config.threads);
    for (int i = 0; i < config.threads; i++) offsets[i] = i * stride;
    double cold = 0;
    for (int repetition = -1; repetition < config.repetitions; repetition++) {
      budget(wholeStart);
      for (int i = 0; i < config.threads; i++) counters.at(i).store(0, std::memory_order_relaxed);
      const auto start = Clock::now();
      #pragma omp parallel num_threads(config.threads)
      {
        const int thread = omp_get_thread_num();
        #pragma omp single
        observedThreads = omp_get_num_threads();
        for (std::uint64_t iteration = 0; iteration < config.iterations; iteration++) counters.at(thread).fetch_add(1, std::memory_order_relaxed);
      }
      const double elapsed = milliseconds(start);
      for (int i = 0; i < config.threads; i++) {
        finalCounts[i] = counters.at(i).load(std::memory_order_relaxed);
        if (finalCounts[i] != config.iterations) throw std::runtime_error("Counter check failed: requested OpenMP threads may be unavailable");
      }
      if (repetition < 0) cold = elapsed; else samples.push_back(elapsed);
    }
    if (padded) rows << ',';
    rows << "{\"size\":" << config.iterations << ",\"backend\":\"native-false-sharing\",\"status\":\"ok\",\"workerCount\":" << observedThreads
      << ",\"coldMs\":" << cold << ",\"samples\":" << arrayJSON(samples) << ",\"summary\":" << stats(samples)
      << ",\"layout\":{\"name\":" << quoted(padded ? "padded" : "packed") << ",\"strideBytes\":" << stride << ",\"assumedLineBytes\":" << config.lineBytes << ",\"baseAlignmentBytes\":256,\"offsetBytes\":" << arrayJSON(offsets) << '}'
      << ",\"timingScope\":\"native wall time for independent relaxed atomic counters; includes OpenMP region entry/exit; excludes allocation, reset and verification\",\"correctness\":{\"verified\":true,\"checks\":" << config.repetitions + 1 << ",\"counters\":" << arrayJSON(finalCounts) << ",\"expectedPerCounter\":" << config.iterations << "}}";
  }
  rows << ']'; return rows.str();
}

int main(int argc, char** argv) {
  try {
    const auto config = parse(argc, argv);
    omp_set_dynamic(0);
    const auto start = Clock::now();
    int observedThreads = 1;
    const std::string rows = config.falseSharing ? sharingRows(config, observedThreads, start) : kernelRows(config, observedThreads, start);
    budget(start);
    const std::time_t now = std::time(nullptr);
    std::ostringstream date; date << std::put_time(std::gmtime(&now), "%Y-%m-%dT%H:%M:%SZ");
    std::cout << std::setprecision(15)
      << "{\"schemaVersion\":1,\"kind\":\"measured\",\"experiment\":" << quoted(config.falseSharing ? "native-false-sharing" : "u32-mix-reduce-v1") << ",\"createdAt\":" << quoted(date.str())
      << ",\"environment\":{\"execution\":\"native\",\"runtime\":\"C++17/OpenMP\",\"compiler\":" << quoted(__VERSION__) << ",\"buildFlags\":" << quoted(CT_BUILD_FLAGS) << ",\"openmp\":" << _OPENMP << ",\"threadsRequested\":" << config.threads << ",\"threadsObserved\":" << observedThreads << ",\"hardwareConcurrency\":" << std::thread::hardware_concurrency() << ",\"affinityControlled\":false}"
      << ",\"protocol\":{\"seed\":" << config.seed << ",\"repetitions\":" << config.repetitions << ",\"cold\":\"first kernel/region run; process startup and allocations excluded\",\"warm\":\"later runs on preallocated arrays\",\"maxDurationMs\":90000,\"notes\":[\"Separate native process: not directly equivalent to browser end-to-end timings.\",\"Sequential timings are exploratory; CI assumes independent samples.\",\"Cache line bytes are a user supplied assumption, not detected hardware.\",\"No PMU data or physical cache invalidation trace is collected.\",\"Thread affinity and CPU frequency are not controlled by this runner.\"]},\"elapsedMs\":" << milliseconds(start) << ",\"rows\":" << rows << "}\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << "Benchmark error: " << error.what() << '\n'; return 1; }
}
