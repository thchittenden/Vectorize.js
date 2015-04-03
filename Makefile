TARGET := bin/vectorize.browser.js
TEST_TARGET := tests.html
TEST_TEMPLATE := tests.tpl
TEST_FILES := $(wildcard tests/*.js) $(wildcard benchmarks/*.js)
TEST_STRINGS := $(patsubst %,<script src="%"></script>,$(TEST_FILES))
SRCS := $(wildcard *.js)

all: $(TARGET) $(TEST_TARGET)

$(TARGET): $(SRCS)
	@mkdir -p $(@D)
	browserify --debug $^ -o $@

$(TEST_TARGET): $(TEST_FILES) $(TEST_TEMPLATE)
	@mkdir -p $(@D)
	sed 's%$$(TESTS)%$(TEST_STRINGS)%' $(TEST_TEMPLATE) > $@

clean:
	rm -Rf bin/ $(TEST_TARGET)

debug:
	@echo "Sources: $(SRCS)"
	@echo "Test Files: $(TEST_FILES)"
	@echo "Test Strings: $(TEST_STRINGS)"

