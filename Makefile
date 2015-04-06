TARGET := bin/vectorize.browser.js
SRCS := $(wildcard *.js)
TEST_TARGET := tests/tests.html
TEST_TEMPLATE := tests/tests.tpl
TEST_FILES := $(wildcard tests/*.js) 
TEST_STRINGS := $(patsubst %,<script src="../%"></script>,$(TEST_FILES))
BENCH_TARGET := benchmarks/benchmarks.html
BENCH_TEMPLATE := benchmarks/benchmarks.tpl
BENCH_FILES := $(filter-out benchmarks.js, $(wildcard benchmarks/*.js))
BENCH_STRINGS := $(patsubst %,<script src="../%"></script>,$(BENCH_FILES))

all: $(TARGET) $(BENCH_TARGET) $(TEST_TARGET)

$(TARGET): $(SRCS)
	@mkdir -p $(@D)
	browserify --debug $^ -o $@

$(BENCH_TARGET): $(BENCH_FILES) $(BENCH_TEMPLATE)
	@mkdir -p $(@D)
	sed 's%$$(BENCHMARKS)%$(BENCH_STRINGS)%' $(BENCH_TEMPLATE) > $@

$(TEST_TARGET): $(TEST_FILES) $(TEST_TEMPLATE)
	@mkdir -p $(@D)
	sed 's%$$(TESTS)%$(TEST_STRINGS)%' $(TEST_TEMPLATE) > $@

clean:
	rm -Rf bin/ $(TEST_TARGET) $(BENCH_TARGET)

debug:
	@echo "Sources: $(SRCS)"
	@echo "Test Files: $(TEST_FILES)"
	@echo "Test Strings: $(TEST_STRINGS)"

.PHONY: all
