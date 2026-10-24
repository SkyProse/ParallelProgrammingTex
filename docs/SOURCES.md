# Источники и границы актуальности

Дата проверки: **2026-10-24**. Архив: `SkyProse/ParallelProgrammingTex`, commit `1c53d6eb08a7d0041a6f54728b6ba90a59507454`, 19 февраля 2020 года. Все ссылки на исходное пособие закреплены на этом commit. Live-документация может измениться после даты проверки; runtime capabilities проверяются отдельно.

## Происхождение пособия

[Описание оригинала](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/description.tex) указывает Соснина В. В., Балакшина П. В., Шилко Д. С. и Университет ИТМО, 2020 год. Эти сведения сохранены. Новый companion и учебные модели не приписываются авторам оригинала и не объявляются новым официальным изданием университета.

| Сцена | Закреплённая опора | Связь с новой сценой |
|---|---|---|
| Развилка времени | [deadlockExample.cpp](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/listings/deadlockExample.cpp) | Идея противоположного порядка locks; новый конечный автомат не использует исходный таймер-наблюдатель |
| Контракт гонки | [raceConditionalExample1.cpp](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/listings/raceConditionalExample1.cpp), [вариант old_a](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/listings/raceConditionalExample2.cpp) | Различие совместного состояния и снимка; браузерная SC-модель двух увеличений объявлена отдельно |
| Микроскоп памяти | [falseSharingExample.cpp](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/listings/falseSharingExample.cpp) | Однобайтовые соседние поля; явная модель адресов и когерентности |
| Эстафета CAS | [lockFreeQueueEnqueue.cpp](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/listings/lockFreeQueueEnqueue.cpp) | Strong вставка next и weak помощь tail; только ограниченный append-only |
| Ткацкий станок GPU | [section3_4.tex](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/section3_4.tex) | Историческая иерархия OpenCL, новая реализация через WGSL/WebGPU |
| Обсерватория ускорения | [section7.tex](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/section7.tex), [Амдал](https://github.com/SkyProse/ParallelProgrammingTex/blob/1c53d6eb08a7d0041a6f54728b6ba90a59507454/section2_2.tex) | Серии времени и неопределённость; теоретическое ускорение отделено от наблюдаемого |

## Язык, память и корректность

- [C++ working draft, intro.races](https://eel.is/c++draft/intro.races): конфликтующие обращения, синхронизация и undefined behavior. Этот документ ограничивает то, что можно утверждать о реальном C++; SC-визуализация не отменяет язык.
- [C++ working draft, atomic operations](https://eel.is/c++draft/atomics.types.generic): strong/weak compare-exchange, `expected`, спонтанный отказ weak. Документ не доказывает корректность данной реализации очереди автоматически.
- [Linux kernel documentation: False Sharing](https://www.kernel.org/doc/html/latest/kernel-hacking/false-sharing.html): совместная линия, write/read и write/write случаи. Материал даёт практический контекст, но не превращает счётчики симулятора в PMU.

## OpenMP: статус именно на дату аудита

- [Официальный список спецификаций](https://www.openmp.org/specifications/): финальная **6.0**, а также **6.1 TR15 Public Comment Draft**.
- [Объявление 6.0](https://www.openmp.org/home-news/openmp-arb-releases-openmp-6-0-for-easier-programming/): выпуск 14 ноября 2024 года.
- [Объявление TR15](https://www.openmp.org/home-news/public-comment-draft-6-1/): 9 июля 2026 года; упоминание ожидаемого ноябрьского релиза не является подтверждением уже вышедшей 6.1.
- [GCC GOMP](https://gcc.gnu.org/projects/gomp/), [Clang OpenMP Support](https://clang.llvm.org/docs/OpenMPSupport.html): матрицы реализации. Поддержку проверяют для функции, языка, версии runtime и host/device цели.
- [LLVM command-line reference](https://openmp.llvm.org/CommandLineArgumentReference.html): значение `-fopenmp` и отличие offloading-specific опций.
- [Intel oneAPI `-fiopenmp`](https://www.intel.com/content/www/us/en/docs/dpcpp-cpp-compiler/developer-guide-reference/2025-0/fiopenmp-qiopenmp.html): отдельная реализация и флаг; он не приравнивается к `-fopenmp`.
- [MSVC OpenMP options](https://learn.microsoft.com/en-us/cpp/build/reference/openmp-enable-openmp-2-0-support): `/openmp`, `/openmp:experimental`, `/openmp:llvm` имеют разную область поддержки. Название runtime не означает полную реализацию новой спецификации.

## Браузерная графика и вычисления

- [WGSL Candidate Recommendation Draft, 21 октября 2026](https://www.w3.org/TR/2026/CRD-WGSL-20261021/): точная датированная редакция языка, built-ins, группы и правила синхронизации. Это нормативный контекст языка, а не таблица всех работающих браузеров.
- [MDN: GPUSupportedFeatures](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures): проверка optional возможностей; поддержка устройства определяется фактически.
- [MDN: WebGL2RenderingContext](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext): графический путь WebGL 2. Он не является WebGPU compute fallback.
- [MDN: OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas): отделение рисования от основного потока. Оно не гарантирует отсутствия конкуренции за железо во время benchmark.
- [Chrome: HTML-in-Canvas origin trial](https://developer.chrome.com/blog/html-in-canvas-origin-trial): экспериментальный интерфейс. Основные подписи и управление проекта не требуют его доступности.

Для buffer views, immediate address space, subgroup ID и управления размером подгрупп приложение сохраняет отдельную диагностику. Нельзя выводить их доступность из даты этой страницы, наличия `navigator.gpu` или успешного запуска другого шейдера.

## Статистика

[NIST: Confidence Limits for the Mean](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm) даёт формулу Student t интервала для среднего и правильное толкование 95% покрытия. В проекте последовательные timings рассматриваются как исследовательские наблюдения с возможной зависимостью. Интервал не заменяет контроль среды и не служит автоматическим тестом универсального превосходства backend.

## Как поддерживать этот реестр

При изменении сильного утверждения сначала определить, принадлежит ли оно архиву, спецификации, реализации браузера или измерению. Для архива сохранить immutable ссылку; для документации обновить дату и источник; для измерения сохранить его среду и сырые наблюдения. Новую draft-спецификацию не переводить в статус final по календарному ожиданию. Не переносить утверждение об одном renderer на другой compute backend.

## Integration inputs and native API checks (2026-10-24)

- English source: `s70c3/ParallelProgrammingTexEn`, commit `9e68958eb5885e0ad8e948570d49e096ad2366ee`.
- Russian source: `shilko2013/ParallelProgrammingTex`, commit `53535f92db505a5d0442dca5a3918fe3ea78189a`.
- Existing theatre: `SkyProse/ParallelProgrammingTex`, commit `2a18af19fb696cb7c6780115bc4caf8cbf622807`.
- [Linux man-pages: pthread_create](https://man7.org/linux/man-pages/man3/pthread_create.3.html): start-routine type, argument lifetime and zero/nonzero result convention.
- [Linux man-pages: pthread_join](https://man7.org/linux/man-pages/man3/pthread_join.3.html): joining, result retrieval and lifetime restrictions. Linux diagnostics are not generalized into portable guarantees for invalid operations.
- [Linux man-pages: sem_init](https://man7.org/linux/man-pages/man3/sem_init.3.html): `pshared` and shared-memory requirements.
- [Intel IPP](https://www.intel.com/content/www/us/en/developer/tools/oneapi/ipp.html): product/documentation entry point, not a guarantee that historical API spellings are current.
- [Intel VTune Profiler](https://www.intel.com/content/www/us/en/developer/tools/oneapi/vtune-profiler.html): current product entry point for the historical profiling chapter.

The Open Group specification pages were not accessible to the auditing browser; the retrieved native-interface references above are the Linux man-pages project documentation, not a claim to have fetched those specification pages.
